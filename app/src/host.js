// Signing from inside the Polkadot App (the Host) with the Product SDK 0.39.0.
// Follows the polkadot-products-devnet skill (references/app-sdk.md, "Flujo completo"). Browser only.
import { createChainClient } from '@parity/product-sdk/chain';
import { createContract, createContractRuntimeFromClient } from '@parity/product-sdk/contracts';
import { isInsideContainer, requestResourceAllocation } from '@parity/product-sdk/host';
import { SignerManager } from '@parity/product-sdk/wallet';
import { devnet_asset_hub } from '@parity/product-sdk-descriptors/devnet-asset-hub';
import { Remesa } from './chain.js';

// Each role gets its own Product account, so one phone can play both without mixing addresses.
export const HOST_INDEX = { abuelita: 0, nieta: 1 };

/// "remesa.dot", "remesa.dot.li", "remesa.app.dot.li", "remesa.dev-dot.li", "remesa.app.dev-dot.li" -> "remesa.dot".
export function productIdFromHost(hostname) {
  const m = hostname.toLowerCase().match(/^([a-z0-9-]+)\.(?:app\.)?(?:dot|dot\.li|dev-dot\.li)$/);
  return m ? `${m[1]}.dot` : null;
}

const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

export const inHost = () => withTimeout(isInsideContainer().catch(() => false), 3000, false);

/// Connects the role's Product account and asks the Host for PGAS. The Host shows up to three permission prompts.
export async function connectHost(remesa, role) {
  const productId = productIdFromHost(location.hostname);
  if (!productId) throw new Error(`No reconozco el dominio ${location.hostname}`);
  const index = HOST_INDEX[role];
  const client = await createChainClient({ chains: { assetHub: devnet_asset_hub } });
  const runtime = createContractRuntimeFromClient(client.raw.assetHub, devnet_asset_hub, { at: 'best' });
  const manager = new SignerManager({ dappName: productId, ss58Prefix: 42, hostTimeout: 30_000, maxRetries: 1, persistence: null });
  const connected = await manager.connect();
  if (!connected.ok) throw connected.error;
  const account = await manager.getProductAccount(productId, index);
  if (!account.ok) throw account.error;
  const me = account.value;
  const contract = createContract(runtime, remesa, Remesa.abi, { defaultOrigin: me.address, defaultSigner: me.getSigner() });
  const gas = await requestResourceAllocation([{ tag: 'SmartContractAllowance', value: { tag: 'Index', value: index } }]);
  return { me, contract, gas: gas.ok ? gas.value[0] : 'NotAvailable' };
}

// The contract error name (e.g. "UnknownKey") when the SDK decoded it, else the dispatch error type.
const revertName = (e) => e?.decoded?.errorName ?? e?.type ?? e?.message ?? String(e);

/// Simulate first (free, gives the revert reason), then sign on the phone. One signature at a time.
export async function hostSend(h, functionName, args) {
  const fn = h.contract[functionName];
  const preview = await fn.query(...args, { origin: h.me.address });
  if (!preview.success) throw new Error(revertName(preview.value));
  const sent = await fn.tx(...args, { waitFor: 'best-block', timeoutMs: 300_000 });
  if (!sent.ok) throw new Error(revertName(sent.error));
  if (!sent.value.ok) throw new Error(`${functionName} falló en la cadena`);
  return sent.value.txHash;
}

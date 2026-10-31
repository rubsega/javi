// Local chain for the offline demo and the tests: Ganache + deploy MockUSD and Remesa.
import ganache from 'ganache';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MockUSD, Remesa, ROLES, DEMO } from '../src/chain.js';

export const LOCAL_CHAIN_ID = 1337;

export async function startLocalChain(port = 8545) {
  const server = ganache.server({
    wallet: { deterministic: true, totalAccounts: 8 },
    chain: { chainId: LOCAL_CHAIN_ID },
    logging: { quiet: true },
  });
  await server.listen(port);
  const pks = Object.values(await server.provider.getInitialAccounts()).map((a) => a.secretKey);
  const rpc = `http://127.0.0.1:${port}`;

  // The four demo roles use pks[1..4]; abuelita (pks[1]) deploys and is the reporter, like on testnet. The rest are spare for tests.
  const chain = { id: LOCAL_CHAIN_ID, name: 'Local', nativeCurrency: { name: 'PAS', symbol: 'PAS', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
  const deployer = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(pks[1]) });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const deploy = async (c, args) => {
    const hash = await deployer.deployContract({ abi: c.abi, bytecode: c.bytecode, args });
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
  };
  const usd = await deploy(MockUSD, []);
  const remesa = await deploy(Remesa, [usd, DEMO.referenceRate]);

  const cfg = {
    mode: 'local',
    rpc,
    chainId: LOCAL_CHAIN_ID,
    usd,
    remesa,
    keys: Object.fromEntries(ROLES.map((r, i) => [r, pks[i + 1]])),
  };
  return { server, cfg, pks, deployer, pub };
}

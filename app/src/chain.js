// Chain access shared by the browser app, the local demo script and the tests.
import { createPublicClient, createWalletClient, decodeErrorResult, defineChain, http, parseEther, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import contracts from './contracts.json' with { type: 'json' };

export const { MockUSD, Remesa } = contracts;
export const RATE_SCALE = 1_000_000n;
export const STATUS = ['None', 'Reserved', 'Assigned', 'Paid', 'Confirmed', 'Disputed', 'Expired'];
export const ROLES = ['abuelita', 'cajeroUS', 'cajeroMX', 'nieta'];

export const TESTNET = {
  rpc: 'https://eth-rpc-testnet.polkadot.io',
  chainId: 420420417,
  explorer: 'https://blockscout-testnet.polkadot.io',
};

// Demo actors' parameters, used by setupDemo.
export const DEMO = {
  referenceRate: 17_000_000n, // 17.00 MXN per USD; the reporter can update it with setReferenceRate
  us: { rate: 995_000n, maxAmount: parseUnits('500', 18), collateral: parseUnits('2000', 18), bankInfo: 'Chelsea · Zelle: chelsea@remesa.demo' },
  mx: { rate: 16_830_000n, maxAmount: parseUnits('500', 18), collateral: parseUnits('2000', 18), bankInfo: 'Rubén · Banco MX (SPEI)' },
  nieta: { nickname: 'maria', clabe: '012180001234567897' },
};

export function connect(cfg) {
  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.chainId === TESTNET.chainId ? 'Polkadot Hub TestNet' : 'Local',
    nativeCurrency: { name: 'PAS', symbol: 'PAS', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpc] } },
  });
  const transport = http(cfg.rpc, { timeout: 30_000 });
  const pub = createPublicClient({ chain, transport, pollingInterval: 1_000 });
  const accounts = Object.fromEntries(ROLES.map((r) => [r, privateKeyToAccount(cfg.keys[r])]));
  const wallets = Object.fromEntries(ROLES.map((r) => [r, createWalletClient({ chain, transport, account: accounts[r] })]));
  return { cfg, pub, accounts, wallets, addr: Object.fromEntries(ROLES.map((r) => [r, accounts[r].address])) };
}

// Simulate first (free, gives the revert reason), then sign and wait for the block. Gas is never set by hand.
export async function send(c, role, contract, functionName, args = []) {
  const { address, abi } = contract === 'usd' ? { address: c.cfg.usd, abi: MockUSD.abi } : { address: c.cfg.remesa, abi: Remesa.abi };
  const { request } = await c.pub.simulateContract({ address, abi, functionName, args, account: c.accounts[role] });
  const hash = await c.wallets[role].writeContract(request);
  const receipt = await c.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}

const read = (c, functionName, args = []) => c.pub.readContract({ address: c.cfg.remesa, abi: Remesa.abi, functionName, args });
const readUsd = (c, functionName, args = []) => c.pub.readContract({ address: c.cfg.usd, abi: MockUSD.abi, functionName, args });

const ERRORS_ABI = [...Remesa.abi, ...MockUSD.abi].filter((x) => x.type === 'error');

/// Contract error name (e.g. "UnknownKey") from a viem error; Ganache only returns the raw selector.
export function errorText(e) {
  for (let x = e; x; x = x.cause) {
    if (x.data?.errorName) return x.data.errorName;
    const hex = typeof x.data === 'string' ? x.data : x.data?.data;
    if (typeof hex === 'string' && hex.length >= 10) {
      try {
        return decodeErrorResult({ abi: ERRORS_ABI, data: hex }).errorName;
      } catch {}
    }
  }
  return e?.shortMessage ?? e?.message ?? String(e);
}

const CASHIER_FIELDS = ['kind', 'registered', 'active', 'rate', 'maxAmount', 'collateral', 'locked', 'withdrawAmount', 'withdrawAt', 'successCount', 'failCount', 'bankInfo'];
const TRANSFER_FIELDS = ['sender', 'recipient', 'cashierUS', 'cashierMX', 'amountUSD', 'usdtAmount', 'amountMXN', 'deadline', 'paidAt', 'status', 'folio'];
const zip = (fields, values) => Object.fromEntries(fields.map((f, i) => [f, values[i]]));

export async function getCashier(c, address) {
  return zip(CASHIER_FIELDS, await read(c, 'cashiers', [address]));
}

export async function getTransfer(c, id) {
  const t = zip(TRANSFER_FIELDS, await read(c, 'transfers', [id]));
  return { id, ...t, statusName: STATUS[t.status] };
}

export const quote = async (c, amountUSD) => {
  const [us, mx, usdtAmount, amountMXN] = await read(c, 'quote', [amountUSD]);
  return { us, mx, usdtAmount, amountMXN };
};
export const resolveKey = (c, key) => read(c, 'resolveKey', [key]);
export const clabeOf = (c, address) => read(c, 'clabeOf', [address]);

/// Everything the three screens need, in one poll.
export async function readState(c, { lastN = 10 } = {}) {
  const [referenceRate, maxSpreadBps, nextId, mxnBalance, clabe, us, mx, block] = await Promise.all([
    read(c, 'referenceRate'),
    read(c, 'maxSpreadBps'),
    read(c, 'nextId'),
    read(c, 'mxnBalance', [c.addr.nieta]),
    read(c, 'clabeOf', [c.addr.nieta]),
    getCashier(c, c.addr.cajeroUS),
    getCashier(c, c.addr.cajeroMX),
    c.pub.getBlock(),
  ]);
  const ids = [];
  for (let i = nextId; i > 0n && ids.length < lastN; i--) ids.push(i);
  const transfers = await Promise.all(ids.map((id) => getTransfer(c, id)));
  return { referenceRate, maxSpreadBps, nextId, mxnBalance, clabe, us, mx, transfers, now: block.timestamp };
}

export async function readBalances(c) {
  const rows = await Promise.all(
    ROLES.map(async (r) => ({
      role: r,
      address: c.addr[r],
      pas: await c.pub.getBalance({ address: c.addr[r] }),
      usd: await readUsd(c, 'balanceOf', [c.addr[r]]),
    })),
  );
  return rows;
}

/// Tx hash of the event that moved transfer `id` into a state, for receipts and explorer links.
export async function findEventTx(c, eventName, id) {
  const latest = await c.pub.getBlockNumber();
  const fromBlock = latest > 10_000n ? latest - 10_000n : 0n;
  const logs = await c.pub.getContractEvents({ address: c.cfg.remesa, abi: Remesa.abi, eventName, args: { id }, fromBlock });
  return logs.at(-1)?.transactionHash;
}

/// abuelita deploys both contracts, so she is the reporter that approves cashiers.
export async function deployDemo(c, log = console.log) {
  const deploy = async (name, contract, args) => {
    log(`Desplegando ${name}…`);
    const hash = await c.wallets.abuelita.deployContract({ abi: contract.abi, bytecode: contract.bytecode, args });
    const receipt = await c.pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${name} deploy failed (${hash})`);
    log(`${name}: ${receipt.contractAddress}`);
    return receipt.contractAddress;
  };
  const usd = await deploy('MockUSD', MockUSD, []);
  const remesa = await deploy('Remesa', Remesa, [usd, DEMO.referenceRate]);
  return { usd, remesa };
}

/// Idempotent: registers and funds both cashiers and the recipient's key. Safe to run twice.
export async function setupDemo(c, log = console.log) {
  if (c.cfg.chainId === TESTNET.chainId) {
    // shortcut: abuelita is the only faucet-funded account and tops up the rest; on a fresh testnet run fund her first.
    for (const r of ['cajeroUS', 'cajeroMX', 'nieta']) {
      const bal = await c.pub.getBalance({ address: c.addr[r] });
      if (bal < parseEther('1')) {
        log(`Enviando 2 PAS a ${r}…`);
        const hash = await c.wallets.abuelita.sendTransaction({ to: c.addr[r], value: parseEther('2') });
        await c.pub.waitForTransactionReceipt({ hash });
      }
    }
  }
  for (const [role, p, kind] of [['cajeroUS', DEMO.us, 0], ['cajeroMX', DEMO.mx, 1]]) {
    if (!(await read(c, 'approved', [c.addr[role]]))) {
      log(`Aprobando ${role}…`);
      await send(c, 'abuelita', 'remesa', 'approveCashier', [c.addr[role], true]);
    }
    const cashier = await getCashier(c, c.addr[role]);
    if (!cashier.registered) {
      log(`Registrando ${role}…`);
      await send(c, role, 'remesa', 'registerCashier', [kind, p.rate, p.maxAmount, p.bankInfo]);
    }
    if (cashier.collateral < p.collateral) {
      const missing = p.collateral - cashier.collateral;
      log(`${role}: acuñando y depositando ${formatUnits(missing, 18)} mUSD de garantía…`);
      await send(c, role, 'usd', 'mint', [c.addr[role], missing]);
      await send(c, role, 'usd', 'approve', [c.cfg.remesa, missing]);
      await send(c, role, 'remesa', 'depositCollateral', [missing]);
    }
  }
  if ((await resolveKey(c, DEMO.nieta.nickname)) !== c.addr.nieta) {
    log('Registrando la clave de la nieta…');
    await send(c, 'nieta', 'remesa', 'registerKey', [DEMO.nieta.nickname, DEMO.nieta.clabe]);
  }
  log('Demo lista ✔');
}

/// SPEI "clave de rastreo"-like folio (simulated).
export function makeFolio(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replaceAll('-', '');
  const rand = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  return `SIM${ymd}${rand}`;
}

export const fmtUSD = (v) => Number(formatUnits(v, 18)).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const fmtMXN = (v) => Number(formatUnits(v, 18)).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) + ' MXN';
export const fmtRate = (v) => (Number(v) / Number(RATE_SCALE)).toFixed(4);
export { parseUnits, formatUnits };

// One command for the testnet demo: demo accounts, contracts, cashiers ready, then the cashier robot
// (banks are simulated, so nobody needs to tap the cashier screens). Testnet-only keys live in .demo-keys.json (gitignored).
import fs from 'node:fs';
import { parseEther } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { connect, cashierTick, deployDemo, setupDemo, errorText, formatUnits, Remesa, ROLES, TESTNET } from '../src/chain.js';

const KEYS = new URL('../.demo-keys.json', import.meta.url);
const ADDRS = new URL('../public/testnet.json', import.meta.url);
const MIN_PAS = parseEther('15'); // deploy + 2 PAS to each of the other three roles, with room to spare

if (!fs.existsSync(KEYS)) fs.writeFileSync(KEYS, JSON.stringify(Object.fromEntries(ROLES.map((r) => [r, generatePrivateKey()])), null, 2));
const keys = JSON.parse(fs.readFileSync(KEYS, 'utf8'));
let { usd, remesa } = JSON.parse(fs.readFileSync(ADDRS, 'utf8'));
let c = connect({ ...TESTNET, usd, remesa, keys });

// Our abuelita must be the reporter (she approves the cashiers); otherwise these contracts are someone else's.
const reporter = await c.pub
  .readContract({ address: remesa, abi: Remesa.abi, functionName: 'reporter' })
  .catch(() => null);
if (reporter !== c.addr.abuelita) {
  const pas = await c.pub.getBalance({ address: c.addr.abuelita });
  if (pas < MIN_PAS) {
    console.log(`Manda 20 PAS desde tu MetaMask a la abuelita de la demo y vuelve a correr "pnpm cajeros":\n  ${c.addr.abuelita}\n(saldo actual: ${formatUnits(pas, 18)} PAS)`);
    process.exit(1);
  }
  ({ usd, remesa } = await deployDemo(c));
  fs.writeFileSync(ADDRS, JSON.stringify({ usd, remesa }, null, 2) + '\n');
  console.log('Direcciones nuevas guardadas en public/testnet.json: hay que hacer pnpm build y volver a publicar.');
  c = connect({ ...TESTNET, usd, remesa, keys });
}
await setupDemo(c);

console.log(`Robot cajero activo (US ${c.addr.cajeroUS}, MX ${c.addr.cajeroMX}). Ctrl+C para terminar.`);
for (;;) {
  await cashierTick(c).catch((e) => console.error('Sin conexión con la red:', errorText(e)));
  await new Promise((r) => setTimeout(r, 3000));
}

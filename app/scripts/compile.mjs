// Compiles ../contracts/*.sol with solc 0.8.28 (optimizer off, like Remix) into src/contracts.json.
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.resolve(root, '../contracts');
const files = ['MockUSD.sol', 'Remesa.sol'];
const sources = Object.fromEntries(files.map((f) => [f, { content: fs.readFileSync(path.join(dir, f), 'utf8') }]));

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: false },
    // shortcut: shanghai so Ganache (local demo) can run it; Remix compiles its own bytecode for the testnet.
    evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};
const findImports = (p) => {
  try {
    return { contents: fs.readFileSync(path.join(root, 'node_modules', p), 'utf8') };
  } catch {
    return { error: `not found: ${p}` };
  }
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}

const result = {};
for (const f of files) {
  const name = f.replace('.sol', '');
  const c = out.contracts[f][name];
  const size = c.evm.deployedBytecode.object.length / 2;
  console.log(`${name}: runtime ${size} bytes`);
  if (size > 24576) throw new Error(`${name} exceeds 24,576 bytes`);
  result[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}
fs.writeFileSync(path.join(root, 'src/contracts.json'), JSON.stringify(result));

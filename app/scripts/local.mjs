// One command offline demo: local chain + contracts + cashiers ready + Vite dev server.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { startLocalChain } from './ganache.mjs';
import { connect, setupDemo } from '../src/chain.js';

const { cfg } = await startLocalChain();
console.log(`Cadena local en ${cfg.rpc} (chainId ${cfg.chainId})`);
console.log(`MockUSD ${cfg.usd}\nRemesa  ${cfg.remesa}`);
await setupDemo(connect(cfg));

// Ganache's deterministic keys are public knowledge; this file only ever points at the local chain.
fs.writeFileSync(path.resolve(import.meta.dirname, '../public/local.json'), JSON.stringify(cfg, null, 2));

const vite = await createServer({ root: path.resolve(import.meta.dirname, '..') });
await vite.listen();
vite.printUrls();
console.log('Abre la URL de arriba. Ctrl+C para terminar (la cadena local se borra).');

// Stale local.json would point the app at a chain that no longer exists.
process.on('SIGINT', () => {
  fs.rmSync(path.resolve(import.meta.dirname, '../public/local.json'), { force: true });
  process.exit(0);
});

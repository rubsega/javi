import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalChain } from '../scripts/ganache.mjs';
import { connect, setupDemo, send, getTransfer, cashierTick, parseUnits, DEMO } from '../src/chain.js';

let server, c;

before(async () => {
  let cfg;
  ({ server, cfg } = await startLocalChain(8547));
  c = connect(cfg);
  await setupDemo(c, () => {});
});

after(() => server.close());

test('cashierTick moves a reservation to Assigned, then to Paid, then does nothing', async () => {
  await send(c, 'abuelita', 'remesa', 'reserve', [DEMO.nieta.nickname, parseUnits('100', 18)]);
  await cashierTick(c, () => {});
  assert.equal((await getTransfer(c, 1n)).statusName, 'Assigned');
  await cashierTick(c, () => {});
  const paid = await getTransfer(c, 1n);
  assert.equal(paid.statusName, 'Paid');
  assert.match(paid.folio, /^SIM\d{20}$/);
  await cashierTick(c, () => {});
  assert.equal((await getTransfer(c, 1n)).statusName, 'Paid');
});

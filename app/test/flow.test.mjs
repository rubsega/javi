import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalChain } from '../scripts/ganache.mjs';
import { connect, setupDemo, send, getTransfer, getCashier, quote, readState, errorText, parseUnits, DEMO } from '../src/chain.js';

let server, c, spare, pks;
const usd = (v) => parseUnits(v, 18);
const skip = async (seconds) => {
  await c.pub.request({ method: 'evm_increaseTime', params: [seconds] });
  await c.pub.request({ method: 'evm_mine', params: [] });
};
const revertName = async (p) => {
  try {
    await p;
  } catch (e) {
    return errorText(e);
  }
  assert.fail('expected revert');
};

before(async () => {
  ({ server, cfg: globalThis.cfg, pks } = await startLocalChain(8546));
  c = connect(globalThis.cfg);
  await setupDemo(c, () => {});
  await setupDemo(c, () => {}); // idempotent
  // spare = same roles but "cajeroMX" is a second MX cashier with a worse (still valid) rate
  spare = connect({ ...globalThis.cfg, keys: { ...globalThis.cfg.keys, cajeroMX: pks[5] } });
  await send(c, 'abuelita', 'remesa', 'approveCashier', [spare.addr.cajeroMX, true]);
  await send(spare, 'cajeroMX', 'remesa', 'registerCashier', [1, 16_800_000n, usd('500'), 'Banco 2']);
  await send(spare, 'cajeroMX', 'usd', 'mint', [spare.addr.cajeroMX, usd('1000')]);
  await send(spare, 'cajeroMX', 'usd', 'approve', [spare.cfg.remesa, usd('1000')]);
  await send(spare, 'cajeroMX', 'remesa', 'depositCollateral', [usd('1000')]);
});

after(() => server.close());

test('happy path: 100 USD -> MXN with the right decimals and collateral moves', async () => {
  const q = await quote(c, usd('100'));
  assert.equal(q.us, c.addr.cajeroUS);
  assert.equal(q.mx, c.addr.cajeroMX); // 16.83 beats 16.80
  assert.equal(q.usdtAmount, usd('99.5'));
  assert.equal(q.amountMXN, usd('1674.585'));

  await send(c, 'abuelita', 'remesa', 'reserve', ['maria', usd('100')]);
  const id = (await readState(c)).nextId;
  let t = await getTransfer(c, id);
  assert.equal(t.statusName, 'Reserved');
  assert.equal((await getCashier(c, c.addr.cajeroUS)).locked, usd('99.5'));

  assert.equal(await revertName(send(c, 'abuelita', 'remesa', 'createTransfer', [id])), 'NotAllowed');
  await send(c, 'cajeroUS', 'remesa', 'createTransfer', [id]);
  t = await getTransfer(c, id);
  assert.equal(t.statusName, 'Assigned');
  assert.equal(t.amountMXN, usd('1674.585'));

  await send(c, 'cajeroMX', 'remesa', 'markPaid', [id, 'SIM20261031000000000001']);
  assert.equal((await readState(c)).mxnBalance, usd('1674.585'));

  await send(c, 'nieta', 'remesa', 'confirm', [id]);
  t = await getTransfer(c, id);
  assert.equal(t.statusName, 'Confirmed');
  const us = await getCashier(c, c.addr.cajeroUS);
  const mx = await getCashier(c, c.addr.cajeroMX);
  assert.equal(us.collateral, DEMO.us.collateral - usd('99.5'));
  assert.equal(us.locked, 0n);
  assert.equal(mx.collateral, DEMO.mx.collateral + usd('99.5'));
  assert.equal(mx.locked, 0n);
  assert.equal(mx.successCount, 1);
});

test('reservation expires and unlocks the US cashier', async () => {
  await send(c, 'abuelita', 'remesa', 'reserve', ['012180001234567897', usd('50')]); // CLABE also resolves
  const id = (await readState(c)).nextId;
  assert.equal(await revertName(send(c, 'abuelita', 'remesa', 'expireReservation', [id])), 'TooEarly');
  await skip(16 * 60);
  assert.equal(await revertName(send(c, 'cajeroUS', 'remesa', 'createTransfer', [id])), 'TooLate');
  await send(c, 'abuelita', 'remesa', 'expireReservation', [id]);
  assert.equal((await getTransfer(c, id)).statusName, 'Expired');
  assert.equal((await getCashier(c, c.addr.cajeroUS)).locked, 0n);
});

test('MX cashier that does not pay in time is replaced and loses reputation', async () => {
  await send(c, 'abuelita', 'remesa', 'reserve', ['maria', usd('100')]);
  const id = (await readState(c)).nextId;
  await send(c, 'cajeroUS', 'remesa', 'createTransfer', [id]);
  await skip(16 * 60);
  await send(c, 'abuelita', 'remesa', 'reassignOnTimeout', [id]);
  const t = await getTransfer(c, id);
  assert.equal(t.cashierMX, spare.addr.cajeroMX);
  assert.equal(t.amountMXN, usd('1671.6')); // 99.5 * 16.80
  const old = await getCashier(c, c.addr.cajeroMX);
  assert.equal(old.failCount, 1);
  assert.equal(old.locked, 0n);
  assert.equal((await getCashier(c, spare.addr.cajeroMX)).locked, usd('99.5'));

  await send(spare, 'cajeroMX', 'remesa', 'markPaid', [id, 'SIM2']);
  assert.equal(await revertName(send(c, 'abuelita', 'remesa', 'dispute', [id])), 'NotAllowed');
  await send(c, 'nieta', 'remesa', 'dispute', [id]);
  assert.equal((await getTransfer(c, id)).statusName, 'Disputed');
  assert.equal((await getCashier(c, spare.addr.cajeroMX)).locked, usd('99.5')); // frozen
});

test('guards: unknown key, spread cap, open reservation limit', async () => {
  assert.equal(await revertName(send(c, 'abuelita', 'remesa', 'reserve', ['nadie', usd('10')])), 'UnknownKey');

  // a quote below reference * (1 - 1.5%) = 16.745 is skipped
  await send(c, 'cajeroMX', 'remesa', 'setQuote', [16_000_000n, usd('500')]);
  assert.equal((await quote(c, usd('100'))).mx, spare.addr.cajeroMX);
  await send(c, 'cajeroMX', 'remesa', 'setQuote', [DEMO.mx.rate, usd('500')]);

  for (let i = 0; i < 3; i++) await send(c, 'abuelita', 'remesa', 'reserve', ['maria', usd('1')]);
  assert.equal(await revertName(send(c, 'abuelita', 'remesa', 'reserve', ['maria', usd('1')])), 'TooManyReservations');
});

test('cashier approval: only the reporter approves, unapproved cannot register, revoked leaves matching', async () => {
  const stranger = connect({ ...globalThis.cfg, keys: { ...globalThis.cfg.keys, cajeroMX: pks[6] } });
  assert.equal(await revertName(send(stranger, 'cajeroMX', 'remesa', 'registerCashier', [1, 17_000_000n, usd('500'), 'X'])), 'NotApproved');
  assert.equal(await revertName(send(c, 'nieta', 'remesa', 'approveCashier', [stranger.addr.cajeroMX, true])), 'NotReporter');

  await send(c, 'abuelita', 'remesa', 'approveCashier', [c.addr.cajeroMX, false]);
  assert.equal((await quote(c, usd('10'))).mx, spare.addr.cajeroMX);
  await send(c, 'abuelita', 'remesa', 'approveCashier', [c.addr.cajeroMX, true]);
  assert.equal((await quote(c, usd('10'))).mx, c.addr.cajeroMX);
});

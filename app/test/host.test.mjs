import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productIdFromHost } from '../src/host.js';

test('productIdFromHost: every gateway form maps to the .dot name', () => {
  for (const h of ['remesa.dot', 'remesa.dot.li', 'remesa.app.dot.li', 'remesa.dev-dot.li', 'Remesa.App.Dev-Dot.li'])
    assert.equal(productIdFromHost(h), 'remesa.dot', h);
  assert.equal(productIdFromHost('localhost'), null);
  assert.equal(productIdFromHost('evil.com'), null);
  assert.equal(productIdFromHost('a.b.dev-dot.li'), null);
});

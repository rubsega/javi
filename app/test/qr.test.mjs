import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { parseRemesaQr, QR_PREFIX, DEMO } from '../src/chain.js';

test('parseRemesaQr: accepts only our prefix and a non-empty key', () => {
  assert.equal(parseRemesaQr(`${QR_PREFIX}${DEMO.nieta.nickname}`), 'maria');
  assert.equal(parseRemesaQr(`${QR_PREFIX}${DEMO.nieta.clabe}`), DEMO.nieta.clabe);
  assert.equal(parseRemesaQr('remesa:  '), null);
  assert.equal(parseRemesaQr('https://example.com'), null);
  assert.equal(parseRemesaQr(null), null);
});

test('the recipient QR decodes back to the key with jsQR', async () => {
  const { default: jsQR } = await import('jsqr');
  const qr = QRCode.create(`${QR_PREFIX}maria`);
  const n = qr.modules.size, scale = 4, margin = 4, size = (n + 2 * margin) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (qr.modules.get(y, x))
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
  assert.equal(parseRemesaQr(jsQR(px, size, size)?.data), 'maria');
});

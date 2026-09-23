const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

test('injectWebMDuration writes exact duration into WebM Segment Info', async () => {
  const root = path.join(__dirname, '../recorder-test-extension');
  const common = await import(url.pathToFileURL(path.join(root, 'common.js')).href);
  assert.equal(typeof common.injectWebMDuration, 'function');

  // Load a real fixture webm
  const rawBuf = fs.readFileSync(path.join(__dirname, 'lab-pause.webm'));
  const originalBlob = new Blob([rawBuf], {type: 'video/webm'});
  const targetMs = 12500; // 12.5 seconds
  const patchedBlob = await common.injectWebMDuration(originalBlob, targetMs);
  assert.ok(patchedBlob);
  assert.equal(patchedBlob.size, originalBlob.size + 11);

  // Validate the EBML byte structure
  const patchedBuf = Buffer.from(await patchedBlob.arrayBuffer());
  const durTag = Buffer.from([0x44, 0x89]);
  const idx = patchedBuf.indexOf(durTag);
  assert.ok(idx > 0, 'Duration tag 0x4489 must be present');
  assert.equal(patchedBuf[idx + 2], 0x88, 'VINT length must be 8 bytes');
  const durVal = patchedBuf.readDoubleBE(idx + 3);
  assert.equal(durVal, targetMs, 'Duration value must match targetMs');

  // Edge cases: non-finite or negative duration returns original untouched
  assert.equal(await common.injectWebMDuration(originalBlob, 0), originalBlob);
  assert.equal(await common.injectWebMDuration(originalBlob, -100), originalBlob);
  assert.equal(await common.injectWebMDuration(null, 1000), null);

  // Non-webm data returns untouched
  const fakeBlob = new Blob([new Uint8Array([1, 2, 3, 4])]);
  assert.equal(await common.injectWebMDuration(fakeBlob, 1000), fakeBlob);
});

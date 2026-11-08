'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const iconPath = path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Assets', 'zhike.ico');
const icon = fs.readFileSync(iconPath);

assert.ok(icon.length > 1024, 'brand icon must contain image payloads');
assert.equal(icon.readUInt16LE(0), 0, 'ICO reserved field must be zero');
assert.equal(icon.readUInt16LE(2), 1, 'ICO type must be icon');
const count = icon.readUInt16LE(4);
assert.equal(count, 9, 'brand icon must provide all supported Windows sizes');

const expectedSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const sizes = [];
for (let index = 0; index < count; index += 1) {
  const offset = 6 + index * 16;
  const width = icon[offset] || 256;
  const height = icon[offset + 1] || 256;
  const bytes = icon.readUInt32LE(offset + 8);
  const dataOffset = icon.readUInt32LE(offset + 12);
  assert.equal(width, height, `entry ${index} must be square`);
  assert.ok(bytes > 0 && dataOffset + bytes <= icon.length, `entry ${index} payload must be in bounds`);
  const png = icon.subarray(dataOffset, dataOffset + bytes);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `entry ${index} must use PNG payloads`);
  sizes.push(width);
}

assert.deepEqual(sizes, expectedSizes);
console.log(`desktop icon contract: ${count} PNG-backed sizes (${sizes.join(', ')}) are valid`);

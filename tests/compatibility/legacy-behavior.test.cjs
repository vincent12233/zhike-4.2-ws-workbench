'use strict';

const assert = require('node:assert/strict');
const { captureLegacyOutputs, compareBehaviorSnapshots } = require('./legacy-output-capture.cjs');
const fixture = require('./legacy-golden-fixtures.json');

const actual = captureLegacyOutputs(fixture);
const comparison = compareBehaviorSnapshots(fixture.expected, actual);

assert.equal(comparison.equal, true, `4.4.24 compatibility snapshot differs:\n${JSON.stringify(comparison.differences, null, 2)}`);
assert.equal(actual.businessRecords.ticketKeys.length, 3, 'golden fixture must retain three independent ticket records');
assert.deepEqual(actual.businessRecords.ticketKeys, fixture.expected.businessRecords.ticketKeys);
assert.deepEqual(actual.homepage.customerIds, fixture.expected.homepage.customerIds);
assert.deepEqual(actual.statistics, fixture.expected.statistics);

console.log('legacy compatibility snapshot: 4.4.24 business outputs match the golden fixture');

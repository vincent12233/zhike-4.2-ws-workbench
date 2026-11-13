'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'app.js'), 'utf8');

assert.match(
  source,
  /const activeCustomers\s*=\s*\(\)\s*=>\s*\{[\s\S]*?const source\s*=\s*Array\.isArray\(state\.customers\)\s*\?\s*state\.customers\s*:\s*\[\][\s\S]*?const value\s*=\s*source\.filter\(c\s*=>\s*c\s*&&\s*typeof c\s*===\s*['"]object['"][\s\S]*?&&\s*!c\.deleted\)/,
  'activeCustomers must ignore malformed customer rows and a transient non-array state before group aggregation',
);

assert.match(source, /function groupSummaryRows\(/, 'group management must keep a dedicated summary path');
assert.match(source, /customer&&typeof customer==='object'/, 'group summary must tolerate malformed rows');
assert.match(source, /const normalizeObjectRows\s*=\s*value\s*=>/, 'shared state hydration must normalize object collections');
assert.match(source, /for\(const record of normalizeObjectRows\(state\.tickets\)\)/, 'malformed ticket rows must not break group business totals');
assert.match(source, /for\(const record of normalizeObjectRows\(state\.deposits\)\)/, 'malformed deposit rows must not break group business totals');
assert.match(source, /summary=Object\.create\(null\)/, 'hostile channel names must not collide with object prototype keys');
assert.match(source, /business summary unavailable; rendering profile-only totals/, 'group page must degrade to profile-only totals if business index recovery is incomplete');
assert.match(source, /skipped malformed customer row/, 'one malformed customer row must not abort group rendering');
assert.match(source, /sourceSummary\.left\+\+/, 'group channel summaries must count left-group customers per configured source');
assert.match(source, /function effectiveCustomerSource\([\s\S]*?if\(broad&&broad!=='群粉'&&broad!=='单导'\)return broad[\s\S]*?if\(channel&&channel!=='群粉'&&channel!=='单导'\)return channel/, 'group-fan subchannels must override the broad source for channel statistics');
assert.match(source, /进退群.*item\.joined.*item\.left/s, 'group page must display per-channel join/leave totals');
assert.match(source, /for\(const configured of \[\.\.\.new Set\(\[\.\.\.sources,\.\.\.groupFanSources\]\)\]\)ensure\(configured\)/, 'configured channels with zero rows must still be visible');
assert.match(source, /function statusSourceSummary\(/, 'status summary must aggregate each configured channel independently');
assert.match(source, /function effectiveCustomerSource\(/, 'status summary must resolve a concrete channel from customer source and channel');
assert.match(source, /function effectiveStatusEventSource\(/, 'status events must retain concrete channel identity');
assert.match(source, /data-home-source=/, 'status cards must carry the concrete channel into the segment filter');
assert.match(source, /data-home-scope=/, 'status cards must distinguish today changes from current totals');
assert.match(source, /const dynamicSource=String\(el\.dataset\.homeSource\|\|''\)\.trim\(\)/, 'segment navigation must honor dynamic channel cards');
assert.match(source, /case'groups':try\{renderGroups\(\);\}catch\(error\)\{[\s\S]*?\}\s*break;case'analytics':renderAnalytics\(\)/, 'successful group rendering must not fall through and overwrite itself with analytics');
assert.doesNotMatch(source, /case'groups':[\s\S]*?break;\}case'analytics'/, 'the groups break must run after both success and error paths');

console.log('group management regression: malformed rows are isolated before rendering');

'use strict';

// Every classic script index.html loads shares one global scope in WebView2.
// None may assume Node at load (for example a bare `module.exports`), and each
// may only publish its own window.Zhike* namespace; private helpers and
// top-level let/const/class bindings must not leak, because a later script
// declaring the same name at top level would then fail to load entirely.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = path.resolve(__dirname, '..', 'resources', 'app');
const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map(match => match[1]);
assert.ok(scripts.length > 30, 'index.html script list');

// Vendored third-party bundle, shipped unmodified.
const vendorGlobals = new Map([['vendor/xlsx/xlsx.js', new Set(['XLSX', 'make_xlsx_lib'])]]);
const failures = [];
for (const relative of scripts) {
  const source = fs.readFileSync(path.join(app, relative), 'utf8');
  const context = vm.createContext({});
  const baseline = new Set(vm.runInContext('Object.getOwnPropertyNames(globalThis)', context));
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', context);
  // UI scripts touch document/window at load and are exercised in a real
  // browser elsewhere; here only Node-only assumptions are a failure.
  try { vm.runInContext(source, context, { filename: relative, timeout: 5000 }); }
  catch (error) {
    const missing = /^(\w+) is not defined$/.exec(String(error.message))?.[1];
    if (['module', 'exports', 'require', 'process', '__dirname', '__filename', 'Buffer', 'global'].includes(missing)) {
      failures.push(`${relative} assumes Node while loading: ${error.message}`);
    }
  }
  const allowed = vendorGlobals.get(relative) || new Set();
  const added = vm.runInContext('Object.getOwnPropertyNames(globalThis)', context)
    .filter(name => !baseline.has(name) && name !== 'window' && name !== 'self');
  const leakedProperties = added.filter(name => !/^Zhike[A-Z]/.test(name) && !name.startsWith('__zhike') && !allowed.has(name));
  if (leakedProperties.length) failures.push(`${relative} leaks globals: ${leakedProperties.join(', ')}`);
  const lexical = [...source.matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1])
    .filter(name => { try { return vm.runInContext(`typeof ${name} !== 'undefined'`, context); } catch { return false; } });
  if (lexical.length) failures.push(`${relative} leaks top-level bindings: ${lexical.join(', ')}`);
}
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`browser script globals: ${scripts.length} index.html scripts make no Node-only assumptions and expose only their namespaces`);

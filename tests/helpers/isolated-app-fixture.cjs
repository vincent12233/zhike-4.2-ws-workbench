'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Copy executable source/assets only. Never traverse the developer workspace's
// user data, login profiles, logs or bundled runtime when creating a test app.
function copyIsolatedAppFixture(source, destination) {
  const root = path.resolve(source);
  const folders = new Set(['assets', 'migrations', 'modules', 'vendor']);
  const extensions = new Set(['.cjs', '.mjs', '.js', '.css', '.html', '.md']);
  fs.cpSync(root, destination, {
    recursive: true,
    filter(file) {
      const relative = path.relative(root, file);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (folders.has(parts[0])) return true;
      return parts.length === 1 && (extensions.has(path.extname(file)) || parts[0] === 'package.json');
    },
  });
}

module.exports = { copyIsolatedAppFixture };

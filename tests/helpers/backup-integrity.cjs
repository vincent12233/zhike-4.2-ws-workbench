'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createBackupManifest(filePaths) {
  const files = (Array.isArray(filePaths) ? filePaths : [])
    .filter(filePath => fs.existsSync(filePath))
    .map(filePath => {
      const stat = fs.statSync(filePath);
      return { path: filePath, bytes: stat.size, sha256: sha256File(filePath) };
    });
  return { createdAt: new Date().toISOString(), files };
}

module.exports = { createBackupManifest, sha256File };

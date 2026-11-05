'use strict';
const { DatabaseSync, backup } = require('node:sqlite');
const { existsSync, renameSync, unlinkSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
async function migrate(sourcePath, targetPath) {
  if (existsSync(targetPath)) return;
  const temporary = targetPath + '.migration-' + randomUUID();
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(source, temporary);
    const check = new DatabaseSync(temporary, { readOnly: true });
    try {
      const result = check.prepare('PRAGMA integrity_check').all();
      if (result.length !== 1 || Object.values(result[0])[0] !== 'ok') throw new Error('迁移数据库完整性检查失败');
      check.prepare('SELECT json FROM app_state LIMIT 1').get();
    } finally { check.close(); }
    if (existsSync(targetPath)) throw new Error('迁移目标已存在，停止覆盖');
    renameSync(temporary, targetPath);
  } finally {
    source.close();
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
migrate(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

function safeId(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('accountId is required');
  const normalized = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'account';
  if (normalized === raw && raw.length <= 64) return normalized;
  const suffix = createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 10);
  return `${normalized}-${suffix}`;
}

export class ProfileStore {
  constructor(root = process.env.ZHIKE_PROFILE_ROOT || '/profiles') {
    this.root = root;
  }

  async ensure(accountId) {
    const directory = join(this.root, safeId(accountId));
    await mkdir(directory, { recursive: true });
    return directory;
  }

  async readCheckpoint(accountId) {
    const directory = await this.ensure(accountId);
    try {
      const checkpoint = JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8'));
      if (checkpoint?.accountId && checkpoint.accountId !== String(accountId).trim()) throw new Error('checkpoint account mismatch');
      return checkpoint;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeCheckpoint(accountId, checkpoint) {
    const directory = await this.ensure(accountId);
    if (checkpoint?.accountId && checkpoint.accountId !== String(accountId).trim()) throw new Error('checkpoint account mismatch');
    const persisted = { ...(checkpoint || {}), accountId: String(accountId).trim(), updatedAt: checkpoint?.updatedAt || new Date().toISOString() };
    const target = join(directory, 'checkpoint.json');
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(persisted), 'utf8');
    await rename(temporary, target);
    return target;
  }
}

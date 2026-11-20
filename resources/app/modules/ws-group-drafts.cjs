'use strict';

const groupJid = /^[a-z0-9._-]{1,235}@g\.us$/;
const draftId = /^[a-zA-Z0-9_-]{1,80}$/;
const pageSize = 50;

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

function readDraft(row) {
  return {
    id: row.id, accountId: row.account_id, message: row.message_text,
    status: row.status, createdAt: row.created_at, cancelledAt: row.cancelled_at,
    targets: JSON.parse(row.targets_json).map(group => ({ ...group, status: row.status })),
  };
}

function list(db, accountId, query, offset) {
  if (query.length > 240 || !Number.isSafeInteger(offset) || offset < 0) fail(400, 'DRAFT_SEARCH_INVALID', '群组搜索条件无效。');
  const groups = db.prepare(`SELECT group_jid AS groupJid,group_name AS name FROM ws_group_catalog
    WHERE account_id=? AND status='active' AND substr(group_jid,-5)='@g.us'
      AND length(group_jid) BETWEEN 6 AND 240 AND substr(group_jid,1,length(group_jid)-5) NOT GLOB '*[^a-z0-9._-]*'
      AND discovery_source <> 'stage3-mock'
      AND (instr(lower(group_name),lower(?))>0 OR instr(group_jid,lower(?))>0)
    ORDER BY group_name COLLATE NOCASE,group_jid LIMIT ? OFFSET ?`).all(accountId, query, query, pageSize + 1, offset);
  const drafts = db.prepare(`SELECT * FROM ws_group_drafts WHERE account_id=?
    ORDER BY created_at DESC,id LIMIT 30`).all(accountId).map(readDraft);
  return { accountId, groups: groups.slice(0, pageSize), nextOffset: groups.length > pageSize ? offset + pageSize : null, drafts, sendAvailable: false };
}

function change(db, accountId, body) {
  if (!draftId.test(body?.id || '') || typeof body.id !== 'string') fail(400, 'DRAFT_ID_INVALID', '草稿编号无效。');
  if (!['create', 'cancel'].includes(body.action)) fail(422, 'GROUP_SEND_UNAVAILABLE', '真实群组发送尚未验证，只能保存或取消本地草稿。');
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT * FROM ws_group_drafts WHERE account_id=? AND id=?').get(accountId, body.id);
    if (body.action === 'cancel') {
      if (!existing) fail(404, 'DRAFT_NOT_FOUND', '当前账号没有此草稿。');
      if (existing.status === 'DRAFT') db.prepare("UPDATE ws_group_drafts SET status='CANCELLED',cancelled_at=? WHERE account_id=? AND id=? AND status='DRAFT'").run(new Date().toISOString(), accountId, body.id);
    } else {
      const { message, targets } = body;
      if (typeof message !== 'string' || !message.trim() || message.length > 4000 || !Array.isArray(targets) || targets.length < 1 || targets.length > 100 ||
          targets.some(id => typeof id !== 'string' || !groupJid.test(id)) || new Set(targets).size !== targets.length) {
        fail(400, 'DRAFT_CONTENT_INVALID', '请填写 1 至 4000 个字符，并选择 1 至 100 个不同的有效群组。');
      }
      const ids = [...targets].sort();
      if (existing) {
        const previous = JSON.parse(existing.targets_json).map(target => target.groupJid);
        if (message !== existing.message_text || JSON.stringify(ids) !== JSON.stringify(previous)) fail(409, 'DRAFT_CONFLICT', '该草稿编号已绑定其他内容。');
      } else {
        const getGroup = db.prepare("SELECT group_jid AS groupJid,group_name AS name FROM ws_group_catalog WHERE account_id=? AND group_jid=? AND status='active' AND discovery_source <> 'stage3-mock'");
        const selected = ids.map(id => {
          const group = getGroup.get(accountId, id);
          if (!group) fail(409, 'DRAFT_GROUP_UNAVAILABLE', '所选群组已失效或不属于当前账号，请刷新群组目录。');
          return group;
        });
        db.prepare("INSERT INTO ws_group_drafts(account_id,id,message_text,targets_json,status,created_at) VALUES(?,?,?,?,'DRAFT',?)")
          .run(accountId, body.id, message, JSON.stringify(selected), new Date().toISOString());
      }
    }
    const row = db.prepare('SELECT * FROM ws_group_drafts WHERE account_id=? AND id=?').get(accountId, body.id);
    db.exec('COMMIT');
    return { draft: readDraft(row), sendAvailable: false };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

// Drafts are inert historical snapshots. Restoring one never authorizes its
// targets, recreates a catalog entry, or queues a transport operation.
function validateBackup(items, accountId, workspaceMode) {
  if (!Array.isArray(items)) fail(400, 'DRAFT_BACKUP_INVALID', 'WS 备份中的 groupDrafts 不是有效数组。');
  if (items.length && workspaceMode !== 'dedicated') fail(409, 'DRAFT_BACKUP_SCOPE', '群组草稿只能恢复到原专用账号。');
  const seen = new Set();
  const validTime = value => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  return items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !draftId.test(item.id) || seen.has(item.id) ||
        item.accountId !== accountId || typeof item.message !== 'string' || !item.message.trim() || item.message.length > 4000 ||
        !['DRAFT', 'CANCELLED'].includes(item.status) || !validTime(item.createdAt) ||
        (item.status === 'DRAFT' ? item.cancelledAt != null : !validTime(item.cancelledAt)) ||
        !Array.isArray(item.targets) || item.targets.length < 1 || item.targets.length > 100 ||
        item.targets.some(target => !target || typeof target.groupJid !== 'string' || !groupJid.test(target.groupJid) ||
          typeof target.name !== 'string' || target.name.length > 240 || target.status !== item.status) ||
        new Set(item.targets.map(target => target.groupJid)).size !== item.targets.length) {
      fail(400, 'DRAFT_BACKUP_INVALID', '群组草稿备份的账号、内容、状态、时间或确切群标识无效，未执行恢复。');
    }
    seen.add(item.id);
    return { ...item, cancelledAt: item.cancelledAt ?? null,
      targets: item.targets.map(({ groupJid, name }) => ({ groupJid, name })).sort((a, b) => a.groupJid < b.groupJid ? -1 : a.groupJid > b.groupJid ? 1 : 0) };
  });
}

function restoreBackup(db, accountId, items) {
  if (!db.isTransaction) throw new Error('Group draft restore requires the account import transaction.');
  const result = { mode: 'merge', received: items.length, inserted: 0, cancelled: 0, unchanged: 0, sendAvailable: false };
  const select = db.prepare('SELECT * FROM ws_group_drafts WHERE account_id=? AND id=?');
  const insert = db.prepare('INSERT INTO ws_group_drafts(account_id,id,message_text,targets_json,status,created_at,cancelled_at) VALUES(?,?,?,?,?,?,?)');
  const cancel = db.prepare("UPDATE ws_group_drafts SET status='CANCELLED',cancelled_at=? WHERE account_id=? AND id=? AND status='DRAFT'");
  for (const item of items) {
    const previous = select.get(accountId, item.id);
    if (!previous) {
      insert.run(accountId, item.id, item.message, JSON.stringify(item.targets), item.status, item.createdAt, item.cancelledAt);
      result.inserted += 1;
      continue;
    }
    const ids = targets => JSON.stringify(targets.map(target => target.groupJid).sort());
    if (previous.message_text !== item.message || ids(JSON.parse(previous.targets_json)) !== ids(item.targets)) {
      fail(409, 'DRAFT_BACKUP_CONFLICT', '现有草稿编号已绑定不同正文或群标识，该账号恢复已全部回滚。');
    }
    // A stale backup cannot revive a cancellation or erase newer local drafts.
    if (previous.status === 'DRAFT' && item.status === 'CANCELLED') {
      cancel.run(item.cancelledAt, accountId, item.id);
      result.cancelled += 1;
    } else result.unchanged += 1;
  }
  return result;
}

module.exports = { list, change, readDraft, validateBackup, restoreBackup };

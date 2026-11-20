'use strict';

/**
 * WS account-purpose eligibility only. This module does not authorize a user,
 * verify a native session/group identity, enable a worker, or grant platform
 * capabilities. Callers must enforce those independent checks before acting.
 *
 * `account` MUST be a row obtained from the authoritative account lookup, or a
 * DTO confirmed by that lookup. Never pass an account object from an HTTP body,
 * renderer request or captured page. A missing lookup result must remain null.
 * Only old trusted rows/DTOs without either mode field default to ordinary.
 *
 * `conversationType` is the result of the caller's trusted identity/evidence
 * classification, not a requested destination type, title, CRM label or claim
 * of group access. This module cannot prove those facts from a type string.
 *
 * Historical storage keeps its original encoding. `vip_group` is accepted only
 * as a legacy spelling of the ordinary WhatsApp group conversation kind; it
 * grants no special business rights. History/export remain purpose-neutral.
 */

const ACCOUNT_MODES = new Set(['ordinary', 'dedicated']);
const RULES = Object.freeze({
  'collect-direct-messages': Object.freeze({ mode: 'ordinary', kind: 'direct' }),
  'analyze-direct': Object.freeze({ mode: 'ordinary', kind: 'direct' }),
  'sync-direct-crm': Object.freeze({ mode: 'ordinary', kind: 'direct' }),
  'send-direct': Object.freeze({ mode: 'ordinary', kind: 'direct' }),
  // Eligibility does not connect a group-body ingestion or sending adapter.
  'collect-group-messages': Object.freeze({ mode: 'dedicated', kind: 'group' }),
  'configure-group-monitor': Object.freeze({ mode: 'dedicated' }),
  'monitor-group': Object.freeze({ mode: 'dedicated', kind: 'group' }),
  'auto-create-group-member': Object.freeze({ mode: 'dedicated', kind: 'group', exclusion: true }),
  // Safe stopping and observed directory metadata work for either purpose.
  'disable-group-monitor': Object.freeze({}),
  'discover-groups': Object.freeze({}),
  'read-history': Object.freeze({}),
  'export-history': Object.freeze({}),
  // Global configuration has no account-purpose dependency. API authentication
  // and configuration permissions are still the caller's responsibility.
  'contact-exclusion-config': Object.freeze({ scope: 'global' }),
});
const OPERATIONS = Object.freeze(Object.keys(RULES));

function conversationKind(value) {
  if (value === 'direct') return 'direct';
  if (value === 'group' || value === 'vip_group') return 'group';
  return 'unknown';
}

function accountPurpose(account) {
  if (!account || typeof account !== 'object' || Array.isArray(account)
      || !Object.hasOwn(account, 'id') || typeof account.id !== 'string' || !account.id.trim()) {
    return { mode: null, code: 'WS_WORKSPACE_ACCOUNT_UNKNOWN' };
  }
  const modes = ['workspace_mode', 'workspaceMode'].filter(key => Object.hasOwn(account, key)).map(key => account[key]);
  if (modes.some(mode => !ACCOUNT_MODES.has(mode))) return { mode: null, code: 'WS_WORKSPACE_MODE_INVALID' };
  if (modes.length === 2 && modes[0] !== modes[1]) return { mode: null, code: 'WS_WORKSPACE_MODE_CONFLICT' };
  return { mode: modes[0] ?? 'ordinary', code: '' };
}

/**
 * @param {{account?: object|null, operation?: string, conversationType?: string}} input
 * @returns {{eligible: boolean, code: string, scope: 'account'|'global', workspaceMode: string|null,
 *   conversationKind: 'direct'|'group'|'unknown', requiresContactExclusion: boolean}}
 * `eligible: true` means only that the operation fits the account purpose.
 * `requiresContactExclusion` is a mandatory downstream prerequisite, never an
 * assertion that an identity was checked or that creation is already allowed.
 * There is deliberately no eligible group-send operation or capability result.
 */
function decideWsWorkspaceOperation(input = {}) {
  const request = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const kind = conversationKind(request.conversationType);
  const result = { eligible: false, code: '', scope: 'account', workspaceMode: null,
    conversationKind: kind, requiresContactExclusion: false };
  const decide = (code, extra = {}) => Object.freeze({ ...result, ...extra, code });
  if (typeof request.operation !== 'string' || !Object.hasOwn(RULES, request.operation)) {
    return decide('WS_WORKSPACE_OPERATION_UNSUPPORTED');
  }
  const rule = RULES[request.operation];
  if (rule.scope === 'global') return decide('WS_WORKSPACE_ELIGIBLE', { eligible: true, scope: 'global' });
  const purpose = accountPurpose(request.account);
  if (purpose.code) return decide(purpose.code);
  result.workspaceMode = purpose.mode;
  if (rule.mode && purpose.mode !== rule.mode) return decide('WS_WORKSPACE_MODE_MISMATCH');
  if (rule.kind && kind === 'unknown') return decide('WS_WORKSPACE_CONVERSATION_TYPE_UNCONFIRMED');
  if (rule.kind && kind !== rule.kind) return decide('WS_WORKSPACE_CONVERSATION_TYPE_MISMATCH');
  return decide('WS_WORKSPACE_ELIGIBLE', { eligible: true, requiresContactExclusion: rule.exclusion === true });
}

module.exports = Object.freeze({ OPERATIONS, decideWsWorkspaceOperation });

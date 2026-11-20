'use strict';

// Read the durable membership authority and optional observed member details
// without backfilling tables or inferring identities from names/phone numbers.
const parse = value => { try { const data = JSON.parse(value || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } };
const statuses = Object.freeze({ '在群': 'active', '已退群': 'left', '被移除': 'removed', '未关联客户': 'unknown', '状态未知': 'unknown' });
const { normalizeExclusionIdentity, createExclusionEngine } = require('./ws-contact-exclusion-core.cjs');

function queryMembers(db, { accountId, groupJid = '', limit = 1000, allowMock = false }) {
  const rows = db.prepare(`WITH member_keys AS (
      SELECT group_jid,member_jid FROM ws_group_members
        WHERE account_id=$accountId AND ($groupJid='' OR group_jid=$groupJid)
      UNION
      SELECT group_jid,member_jid FROM customer_group_memberships
        WHERE account_id=$accountId AND ($groupJid='' OR group_jid=$groupJid)
    )
    SELECT k.group_jid,k.member_jid,m.id AS member_id,m.member_phone,m.display_name,m.role,m.status,
      m.first_seen_at,m.last_seen_at,m.source,m.evidence_json,m.manual_locked,m.data_json,m.created_at,m.updated_at,
      r.id AS relation_id,r.member_phone AS relation_phone,r.customer_id AS relation_customer_id,
      r.status AS relation_status,r.first_joined_at,r.last_event_at,r.last_event_key,r.confidence,
      r.manual_locked AS relation_locked,r.review_reason,r.data_json AS relation_data,
      r.created_at AS relation_created_at,r.updated_at AS relation_updated_at,
      COALESCE(NULLIF(g.group_name,''),r.group_name,'') AS group_name,
      c.id AS trusted_customer_id,c.name AS customer_name,o.id AS observed_customer_id,o.name AS observed_customer_name,
      o.phone_normalized AS observed_customer_phone,o.data_json AS observed_customer_data,e.source AS event_source
    FROM member_keys k
    LEFT JOIN ws_group_members m ON m.account_id=$accountId AND m.group_jid=k.group_jid AND m.member_jid=k.member_jid
    LEFT JOIN customer_group_memberships r ON r.account_id=$accountId AND r.group_jid=k.group_jid AND r.member_jid=k.member_jid
    LEFT JOIN ws_group_catalog g ON g.account_id=$accountId AND g.group_jid=k.group_jid
    LEFT JOIN customers c ON c.id=r.customer_id AND c.deleted=0
      AND NOT EXISTS (SELECT 1 FROM crm_identity_conflicts conflict
        WHERE c.phone_normalized<>'' AND conflict.canonical_phone=c.phone_normalized AND conflict.status='open')
    LEFT JOIN ws_group_membership_events e ON e.id=r.last_event_id AND e.account_id=$accountId
      AND e.group_jid=k.group_jid AND e.member_jid=k.member_jid
    LEFT JOIN customers o ON m.source='ws-native-observation' AND json_valid(m.data_json)
      AND o.id=json_extract(m.data_json,'$.observedCustomerId') AND o.deleted=0
      AND NOT EXISTS (SELECT 1 FROM crm_identity_conflicts conflict
        WHERE o.phone_normalized<>'' AND conflict.canonical_phone=o.phone_normalized AND conflict.status='open')
    ORDER BY COALESCE(r.updated_at,m.updated_at) DESC,k.group_jid,k.member_jid LIMIT $limit
  `).all({ $accountId: accountId, $groupJid: groupJid, $limit: limit });
  const exclusions = createExclusionEngine({ db });
  const excluded = new Map();
  const isExcluded = value => {
    const identity = normalizeExclusionIdentity(value);
    if (!identity) return false;
    const key = identity.kind + ':' + identity.value;
    if (!excluded.has(key)) excluded.set(key, Boolean(exclusions.findRule(identity)));
    return excluded.get(key);
  };
  return rows.map(row => {
    const hasRelation = Boolean(row.relation_id);
    const relationData = parse(row.relation_data);
    const memberData = parse(row.data_json);
    const manualLocked = Boolean(hasRelation ? row.relation_locked : row.manual_locked);
    const trusted = hasRelation && row.trusted_customer_id && ['在群', '已退群', '被移除'].includes(row.relation_status) &&
      (!row.review_reason || (manualLocked && row.review_reason === 'manual-lock')) &&
      (manualLocked || row.confidence >= 0.6) && (allowMock || relationData.origin !== 'stage3-isolated-mock');
    const observedOnly = !hasRelation && row.source === 'ws-native-observation';
    let observedCustomer = observedOnly && row.observed_customer_id;
    if (observedCustomer) {
      const customer = parse(row.observed_customer_data);
      const identities = [row.member_jid, row.member_phone, row.observed_customer_phone, customer.phone, customer.rawPhone,
        customer.wsExternalId, customer.wsParticipantId, customer.wsContactId];
      for (const key of ['phones', 'phoneNumbers', 'legacyPhones', 'wsExternalIds', 'wsParticipantIds', 'wsContactIds']) {
        if (Array.isArray(customer[key])) identities.push(...customer[key]);
      }
      if (identities.some(isExcluded)) {
        observedCustomer = '';
        memberData.observationMatch = 'excluded';
        memberData.observationReviewReason = 'contact-excluded';
      }
    }
    if (observedOnly) memberData.observedCustomerId = observedCustomer || '';
    const customerId = trusted ? row.trusted_customer_id : observedCustomer || '';
    return {
      id: row.member_id || row.relation_id,
      accountId, groupJid: row.group_jid, groupName: row.group_name,
      memberJid: row.member_jid, memberPhone: hasRelation ? row.relation_phone : row.member_phone || '',
      displayName: row.display_name || '', role: row.role || 'unknown',
      status: hasRelation ? statuses[row.relation_status] || 'unknown' : row.status || 'unknown',
      observedOnly,
      firstSeenAt: hasRelation ? row.first_joined_at || row.relation_created_at : row.first_seen_at || '',
      lastSeenAt: hasRelation ? row.last_event_at || row.relation_updated_at : row.last_seen_at || '',
      source: hasRelation ? row.event_source || relationData.origin || 'membership-ledger' : row.source || 'member-record',
      manualLocked, customerId, customerName: trusted ? row.customer_name || '' : observedCustomer ? row.observed_customer_name || '' : '',
      customerLinkStatus: customerId ? 'linked' : row.relation_customer_id ? 'unverified' : 'unlinked',
      reviewReason: hasRelation ? row.review_reason || '' : memberData.observationReviewReason || '',
      evidence: hasRelation ? { lastEventKey: row.last_event_key || '', confidence: row.confidence } : parse(row.evidence_json),
      correlationId: String((hasRelation ? relationData : memberData).correlationId || ''),
      data: { ...(hasRelation ? relationData : memberData), customerId },
      createdAt: hasRelation ? row.relation_created_at : row.created_at,
      updatedAt: hasRelation ? row.relation_updated_at : row.updated_at,
    };
  });
}

module.exports = { queryMembers };

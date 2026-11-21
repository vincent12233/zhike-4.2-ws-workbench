(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeIdentityConflicts = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §9 customer identity: conflict detection and possible-duplicate hints.
  //
  // Rules:
  // - Only reliable evidence is used: a standardised phone number or a real
  //   WhatsApp identity (…@c.us / …@s.whatsapp.net / …@lid, or a bare phone-like
  //   id). Names, nicknames, avatars and fuzzy similarity are never evidence.
  // - Nothing is merged or deleted. Conflicts are reported so a human decides.
  // - Deleted customers are ignored; duplicate rows with the same id count once.
  const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
  const list = value => Array.isArray(value) ? value : [];
  const PLACEHOLDER = /^(?:unknown|anonymous|undefined|null|n\/a|none|-|—|0)$/i;

  function normalizedPhone(value) {
    const digits = text(value).replace(/\D/g, '').replace(/^00/, '');
    if (digits.length < 8 || digits.length > 15) return '';
    return digits.replace(/^91(?=\d{10}$)/, '');
  }

  function reliableIdentities(customer) {
    const found = new Set();
    for (const key of ['wsExternalId', 'wsParticipantId', 'wsContactId']) {
      most: for (const value of [customer?.[key]]) {
        const identity = text(value);
        if (!identity || PLACEHOLDER.test(identity)) continue most;
        if (/^[a-z0-9._-]+@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(identity)) found.add(identity.toLowerCase());
        else if (/^\d{8,15}$/.test(identity)) found.add(identity);
      }
    }
    for (const key of ['wsExternalIds', 'wsParticipantIds', 'wsContactIds']) {
      for (const value of list(customer?.[key])) {
        const identity = text(value);
        if (!identity || PLACEHOLDER.test(identity)) continue;
        if (/^[a-z0-9._-]+@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(identity)) found.add(identity.toLowerCase());
        else if (/^\d{8,15}$/.test(identity)) found.add(identity);
      }
    }
    return [...found];
  }

  const vipKey = customer => text(customer?.vipNumber || customer?.vipId || customer?.vipCode).toUpperCase();

  function scanIdentityConflicts(customers) {
    const rows = list(customers).filter(customer => customer && typeof customer === 'object' && customer.deleted !== true);
    const seenIds = new Set();
    const unique = [];
    for (const customer of rows) {
      const id = text(customer.id);
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      unique.push(customer);
    }
    const byPhone = new Map(), byVip = new Map(), byIdentity = new Map();
    const invalidPhones = [];
    for (const customer of unique) {
      const phone = normalizedPhone(customer.phone || customer.rawPhone);
      if (phone) {
        if (!byPhone.has(phone)) byPhone.set(phone, []);
        byPhone.get(phone).push(customer);
      } else if (text(customer.phone || customer.rawPhone)) {
        // A stored number that cannot be standardised needs a human look.
        invalidPhones.push(customer);
      }
      const vip = vipKey(customer);
      if (vip) {
        if (!byVip.has(vip)) byVip.set(vip, []);
        byVip.get(vip).push(customer);
      }
      for (const identity of reliableIdentities(customer)) {
        if (!byIdentity.has(identity)) byIdentity.set(identity, []);
        const bucket = byIdentity.get(identity);
        if (!bucket.includes(customer)) bucket.push(customer);
      }
    }
    const duplicatePhones = [...byPhone.entries()].filter(([, group]) => group.length > 1);
    const duplicateVips = [...byVip.entries()].filter(([, group]) => group.length > 1);
    const identityConflicts = [...byIdentity.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([identity, group]) => ({ identity, customers: group }));
    return {
      duplicates: duplicatePhones.flatMap(([, group]) => group),
      duplicatePhoneGroups: duplicatePhones.map(([phone, group]) => ({ phone, customers: group })),
      vipDuplicates: duplicateVips.flatMap(([, group]) => group),
      vipDuplicateGroups: duplicateVips.map(([vip, group]) => ({ vip, customers: group })),
      identityConflicts,
      identityConflictCustomers: identityConflicts.flatMap(item => item.customers),
      invalid: invalidPhones,
      summary: {
        duplicatePhoneGroups: duplicatePhones.length,
        duplicateVipGroups: duplicateVips.length,
        identityConflicts: identityConflicts.length,
        invalidPhones: invalidPhones.length,
        customers: unique.length,
        pendingConfirmation: duplicatePhones.length + duplicateVips.length + identityConflicts.length,
      },
    };
  }

  return { scanIdentityConflicts, normalizedPhone, reliableIdentities };
});

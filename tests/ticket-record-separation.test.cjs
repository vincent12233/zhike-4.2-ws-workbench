'use strict';

const assert = require('node:assert/strict');
const core = require('../resources/app/modules/ticket-record-core.js');

const legacyBuy = core.normalizeTicketRecord({ customerId: 'C1', product: 'AAPL', direction: '买入', date: '2026-11-01' });
const legacySell = core.normalizeTicketRecord({ customerId: 'C1', product: 'AAPL', direction: '卖出', date: '2026-11-08' });
assert.equal(legacyBuy.buyDate, '2026-11-01');
assert.equal(legacyBuy.sellDate, '');
assert.equal(legacySell.buyDate, '');
assert.equal(legacySell.sellDate, '2026-11-08');
assert.equal(core.effectiveTicketDate(legacyBuy), '2026-11-01');
assert.equal(core.effectiveTicketDate(legacySell), '2026-11-08');

const buyKey = core.ticketRecordKey(legacyBuy);
const sellKey = core.ticketRecordKey(legacySell);
assert.notEqual(buyKey, sellKey, 'same customer and stock must keep buy and sell records separate');

const sameBuyDifferentDate = core.normalizeTicketRecord({ customerId: 'C1', product: 'AAPL', direction: '买入', date: '2026-11-02' });
assert.notEqual(buyKey, core.ticketRecordKey(sameBuyDifferentDate), 'same direction with a different trade date must remain a separate record');

const explicitDates = core.normalizeTicketRecord({ customerId: 'C1', product: 'AAPL', direction: '买入', buyDate: '2026-11-03', sellDate: '' });
assert.equal(explicitDates.date, '2026-11-03');
assert.equal(core.ticketRecordKey(explicitDates), core.ticketRecordKey({ ...explicitDates, date: '2026-11-03' }));

console.log('ticket record separation: buy/sell dates and same-customer trade records stay independent');

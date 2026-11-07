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

const otherStock = core.normalizeTicketRecord({ customerId: 'C1', product: 'TSLA', direction: '买入', date: '2026-11-01' });
assert.notEqual(buyKey, core.ticketRecordKey(otherStock), 'same customer/date/direction with a different stock must remain a separate record');

const legacyStockField = core.normalizeTicketRecord({ customerId: 'C1', stock_code: 'TSLA', direction: '买入', date: '2026-11-01' });
assert.equal(legacyStockField.product, 'TSLA', 'legacy stock_code fields must be promoted to the canonical product field');
assert.notEqual(buyKey, core.ticketRecordKey(legacyStockField), 'legacy stock fields must participate in ticket identity');

assert.deepEqual(core.ticketProducts('AAPL, TSLA'), ['AAPL', 'TSLA'], 'comma-separated stocks must expand into independent ticket products');
assert.deepEqual(core.ticketProducts('AAPL、TSLA；NVDA'), ['AAPL', 'TSLA', 'NVDA'], 'Chinese separators must expand into independent ticket products');
assert.deepEqual(core.ticketProducts('AAPL TSLA'), ['AAPL', 'TSLA'], 'code-like whitespace-separated stocks must expand into independent ticket products');
assert.equal(core.expandTicketRecord({ id: 'T1', customerId: 'C1', product: 'AAPL,TSLA', direction: '买入', date: '2026-11-01' }).length, 2, 'one multi-stock input must become two records');

const explicitDates = core.normalizeTicketRecord({ customerId: 'C1', product: 'AAPL', direction: '买入', buyDate: '2026-11-03', sellDate: '' });
assert.equal(explicitDates.date, '2026-11-03');
assert.equal(core.ticketRecordKey(explicitDates), core.ticketRecordKey({ ...explicitDates, date: '2026-11-03' }));
assert.equal(core.normalizeDate('06/11/2026'), '2026-11-06');
assert.equal(core.normalizeDate('20261106'), '2026-11-06');
assert.equal(core.normalizeDate('46332'), '2026-11-06');

console.log('ticket record separation: buy/sell dates and same-customer trade records stay independent');

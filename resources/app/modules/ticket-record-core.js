'use strict';

(() => {
  function normalizeDate(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const text = raw.normalize('NFKC').replace(/[年./月]/g, '-').replace(/日/g, '').replace(/[Tt].*$/, '').replace(/\s+/g, '');
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match && /^\d{8}$/.test(text)) match = [text, text.slice(0, 4), text.slice(4, 6), text.slice(6, 8)];
    if (!match) return '';
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function normalizeDirection(value) {
    const text = String(value ?? '').trim().toLocaleLowerCase();
    if (/^(买入|购买|购入|买|buy|b)$/.test(text)) return '买入';
    if (/^(卖出|卖|sell|s)$/.test(text)) return '卖出';
    if (/^(关注|观察|持有|watch|hold|h)$/.test(text)) return '关注';
    return String(value ?? '').trim() || '关注';
  }

  function normalizeTicketRecord(record = {}) {
    const direction = normalizeDirection(record.direction);
    const legacyDate = normalizeDate(record.date);
    let buyDate = normalizeDate(record.buyDate || record.purchaseDate || record.buy_time);
    let sellDate = normalizeDate(record.sellDate || record.saleDate || record.sell_time);
    if (direction === '买入' && !buyDate) buyDate = legacyDate;
    if (direction === '卖出' && !sellDate) sellDate = legacyDate;
    const date = direction === '买入' ? (buyDate || legacyDate) : direction === '卖出' ? (sellDate || legacyDate) : (legacyDate || buyDate || sellDate);
    return { ...record, direction, date, buyDate, sellDate };
  }

  function effectiveTicketDate(record = {}) {
    const normalized = normalizeTicketRecord(record);
    return normalized.direction === '买入' ? normalized.buyDate || normalized.date : normalized.direction === '卖出' ? normalized.sellDate || normalized.date : normalized.date || normalized.buyDate || normalized.sellDate;
  }

  function ticketRecordKey(record = {}) {
    const normalized = normalizeTicketRecord(record);
    const clean = value => String(value ?? '').trim().toLocaleLowerCase();
    const owner = clean(normalized.customerId || normalized.customer || normalized.phone);
    return [owner, effectiveTicketDate(normalized), clean(normalized.product || '未指定'), clean(normalized.direction), clean(normalized.note)].join('|');
  }

  const api = { normalizeDate, normalizeDirection, normalizeTicketRecord, effectiveTicketDate, ticketRecordKey };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.ZhikeTicketRecords = api;
})();

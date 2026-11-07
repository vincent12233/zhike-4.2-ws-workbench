'use strict';

(() => {
  function normalizeDate(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const text = raw.normalize('NFKC').replace(/[年./月]/g, '-').replace(/日/g, '').replace(/[Tt].*$/, '').replace(/\s+/g, '');
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match && /^\d{8}$/.test(text)) match = [text, text.slice(0, 4), text.slice(4, 6), text.slice(6, 8)];
    let year, month, day;
    if (match) {
      year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
    } else {
      // Excel/CSV exports frequently use day-month-year. When both values
      // are <= 12, follow the import UI's day-month order.
      const dmy = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
      if (dmy) {
        const first = Number(dmy[1]), second = Number(dmy[2]);
        year = Number(dmy[3]);
        day = first > 12 ? first : (second > 12 ? second : first);
        month = first > 12 ? second : (second > 12 ? first : second);
      } else if (/^\d{1,6}(?:\.0+)?$/.test(text)) {
        const serial = Math.trunc(Number(text));
        if (serial >= 1 && serial <= 2958465) {
          const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
          year = date.getUTCFullYear(); month = date.getUTCMonth() + 1; day = date.getUTCDate();
        }
      }
    }
    if (![year, month, day].every(Number.isFinite)) return '';
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

  function normalizeProduct(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  }

  function productValue(record = {}) {
    const candidates = [record.product, record.productCode, record.stockCode, record.stock_code, record.stock, record.symbol, record.securityCode, record.code, record.ticketProduct];
    return normalizeProduct(candidates.find(value => normalizeProduct(value)) || '');
  }

  function ticketProducts(value) {
    const values = Array.isArray(value) ? value : [value];
    const result = [];
    for (const item of values) {
      const text = normalizeProduct(item);
      if (!text) continue;
      // Product names may contain spaces, so only explicit list separators
      // split a cell into independent ticket records.
      let parts = text.split(/[\r\n,，、;；|/\\+]+/).map(normalizeProduct).filter(Boolean);
      // Accept whitespace-separated ticker symbols as a list only when every
      // token is code-like; ordinary product names with spaces stay intact.
      if (parts.length === 1 && /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\s+){1,}[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) parts = text.split(/\s+/).map(normalizeProduct);
      for (const part of parts) {
        if (!result.some(existing => existing.toLocaleLowerCase() === part.toLocaleLowerCase())) result.push(part);
      }
    }
    return result;
  }

  function normalizeTicketRecord(record = {}) {
    const direction = normalizeDirection(record.direction);
    const product = productValue(record);
    const legacyDate = normalizeDate(record.date);
    let buyDate = normalizeDate(record.buyDate || record.purchaseDate || record.buy_time);
    let sellDate = normalizeDate(record.sellDate || record.saleDate || record.sell_time);
    if (direction === '买入' && !buyDate) buyDate = legacyDate;
    if (direction === '卖出' && !sellDate) sellDate = legacyDate;
    const date = direction === '买入' ? (buyDate || legacyDate) : direction === '卖出' ? (sellDate || legacyDate) : (legacyDate || buyDate || sellDate);
    return { ...record, product, direction, date, buyDate, sellDate };
  }

  function expandTicketRecord(record = {}) {
    const normalized = normalizeTicketRecord(record);
    const products = ticketProducts(normalized.product);
    if (products.length <= 1) return [normalized];
    return products.map((product, index) => ({
      ...normalized,
      product,
      id: index === 0 || normalized.id == null ? normalized.id : `${normalized.id}-P${index + 1}`,
    }));
  }

  function effectiveTicketDate(record = {}) {
    const normalized = normalizeTicketRecord(record);
    return normalized.direction === '买入' ? normalized.buyDate || normalized.date : normalized.direction === '卖出' ? normalized.sellDate || normalized.date : normalized.date || normalized.buyDate || normalized.sellDate;
  }

  function ticketRecordKey(record = {}) {
    const normalized = normalizeTicketRecord(record);
    const clean = value => String(value ?? '').trim().toLocaleLowerCase();
    const owner = clean(normalized.customerId || normalized.customer || normalized.phone);
    return [owner, effectiveTicketDate(normalized), clean(productValue(normalized) || '未指定'), clean(normalized.direction), clean(normalized.note)].join('|');
  }

  const api = { normalizeDate, normalizeDirection, normalizeProduct, ticketProducts, normalizeTicketRecord, expandTicketRecord, effectiveTicketDate, ticketRecordKey };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.ZhikeTicketRecords = api;
})();

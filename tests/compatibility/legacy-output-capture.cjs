'use strict';

const core = require('../../resources/app/modules/ticket-record-core.js');

function captureLegacyOutputs(fixture) {
  const inputs = fixture.inputs || {};
  const customers = (inputs.customers || []).filter(customer => !customer.deleted);
  const records = (inputs.businessRecords || []).flatMap(record => core.expandTicketRecord(record));
  const ticketKeys = records.map(record => core.ticketRecordKey(record)).sort();
  const imports = (inputs.importRows || []).map(row => ({
    customerName: String(row['客户名称'] || row.name || '').trim(),
    product: String(row['股票代码'] || row.product || row.stockCode || '').trim(),
    registeredDate: core.normalizeDate(row['登记日期'] || row.registeredDate || row.date),
    channel: String(row['渠道'] || row.channel || '').trim(),
    status: String(row['状态'] || row.status || '').trim(),
  }));
  return {
    homepage: {
      customerIds: customers.map(customer => String(customer.id)).sort(),
      activeCustomerCount: customers.length,
    },
    businessRecords: { ticketKeys },
    imports,
    statistics: {
      customerCount: customers.length,
      businessRecordCount: records.length,
      buyCount: records.filter(record => record.direction === '买入').length,
      sellCount: records.filter(record => record.direction === '卖出').length,
    },
  };
}

function compareBehaviorSnapshots(expected, actual) {
  const differences = [];
  const walk = (left, right, path = '$') => {
    if (Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) differences.push(`${path}.length expected ${left.length} got ${right.length}`);
      const count = Math.max(left.length, right.length);
      for (let index = 0; index < count; index += 1) walk(left[index], right[index], `${path}[${index}]`);
      return;
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of [...keys].sort()) walk(left[key], right[key], `${path}.${key}`);
      return;
    }
    differences.push(`${path} expected ${JSON.stringify(left)} got ${JSON.stringify(right)}`);
  };
  walk(expected, actual);
  return { equal: differences.length === 0, differences };
}

module.exports = { captureLegacyOutputs, compareBehaviorSnapshots };

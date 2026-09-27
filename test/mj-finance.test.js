const assert = require('node:assert/strict');
const { normalizeFee, createPayment, createExpense, summarizeFinance } = require('../qayd-finance');

function test(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}

test('ينشئ أتعاب مرحلة مرتبطة بالملف ويمنع المتبقي السالب', () => {
  const fee = normalizeFee({ caseId: 'stage-1', legalFileId: 'file-1', total: 1000, paid: 1200, notes: 'اتفاق المرحلة' });
  assert.equal(fee.case_id, 'stage-1');
  assert.equal(fee.legal_file_id, 'file-1');
  assert.equal(fee.scope, 'stage');
  assert.equal(fee.remaining, 0);
});

test('ينشئ دفعة ومصروفًا يحملان سياق المرحلة والملف', () => {
  const payment = createPayment({ recordId: 'stage-1', legalFileId: 'file-1', stageId: 'stage-1', amount: 300, date: '2026-09-27', note: 'دفعة أولى', remoteId: 'pay-1' });
  const expense = createExpense({ recordId: 'stage-1', legalFileId: 'file-1', stageId: 'stage-1', amount: 80, date: '2026-09-27', category: 'رسوم إعلان', remoteId: 'exp-1' });
  assert.deepEqual({ case_id: payment.case_id, legal_file_id: payment.legal_file_id, stage_id: payment.stage_id, scope: payment.scope }, { case_id: 'stage-1', legal_file_id: 'file-1', stage_id: 'stage-1', scope: 'stage' });
  assert.deepEqual({ case_id: expense.case_id, legal_file_id: expense.legal_file_id, stage_id: expense.stage_id, scope: expense.scope }, { case_id: 'stage-1', legal_file_id: 'file-1', stage_id: 'stage-1', scope: 'stage' });
});

test('يلخص أتعاب الملف من مراحله ويحسب المصروف وصافي الربح', () => {
  const summary = summarizeFinance({
    fileId: 'file-1', stageIds: ['stage-1', 'stage-2'],
    fees: [{ case_id: 'stage-1', legal_file_id: 'file-1', total: 1000 }, { case_id: 'stage-2', legal_file_id: 'file-1', total: 500 }],
    payments: [{ case_id: 'stage-1', legal_file_id: 'file-1', amount: 700 }, { case_id: 'stage-2', legal_file_id: 'file-1', amount: 200 }],
    expenses: [{ case_id: 'stage-1', legal_file_id: 'file-1', amount: 100 }, { case_id: 'stage-2', legal_file_id: 'file-1', amount: 50 }]
  });
  assert.deepEqual(summary, { totalFees: 1500, collected: 900, remaining: 600, expenses: 150, profit: 750 });
});

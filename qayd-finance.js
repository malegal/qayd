(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QaydFinance = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function number(value) { return Math.max(0, Number(value) || 0); }
  function scopeFor(stageId, legalFileId) { return stageId && stageId !== legalFileId ? 'stage' : 'file'; }
  function normalizeFee({ caseId, legalFileId, stageId = caseId, total = 0, paid = 0, notes = '', updatedAt = new Date().toISOString() } = {}) {
    const normalizedTotal = number(total);
    const normalizedPaid = number(paid);
    return {
      case_id: caseId,
      legal_file_id: legalFileId || null,
      stage_id: stageId || null,
      scope: scopeFor(stageId, legalFileId),
      total: normalizedTotal,
      paid: normalizedPaid,
      remaining: Math.max(0, normalizedTotal - normalizedPaid),
      notes: String(notes || ''),
      updated_at: updatedAt
    };
  }
  function createPayment({ recordId, legalFileId, stageId = recordId, amount, date, note = '', remoteId, transactionId } = {}) {
    return {
      case_id: recordId,
      legal_file_id: legalFileId || null,
      stage_id: stageId || null,
      scope: scopeFor(stageId, legalFileId),
      amount: number(amount),
      date,
      note: String(note || ''),
      remote_id: remoteId,
      transaction_id: transactionId || null
    };
  }
  function createExpense({ recordId, legalFileId, stageId = recordId, amount, date, category = '', description = '', remoteId, transactionId } = {}) {
    return {
      office_id: null,
      owner_id: legalFileId || recordId,
      case_id: recordId,
      legal_file_id: legalFileId || null,
      stage_id: stageId || null,
      scope: scopeFor(stageId, legalFileId),
      amount: number(amount),
      date,
      category: String(category || 'مصروف'),
      description: String(description || ''),
      remote_id: remoteId,
      transaction_id: transactionId || null
    };
  }
  function belongsTo(record, ids, fileId) {
    return !!record && (ids.has(record.case_id) || (fileId && record.legal_file_id === fileId && record.scope === 'file'));
  }
  function summarizeFinance({ fileId, stageIds = [], fees = [], payments = [], expenses = [] } = {}) {
    const ids = new Set(stageIds.filter(Boolean));
    if (fileId) ids.add(fileId);
    const relevantFees = fees.filter(row => belongsTo(row, ids, fileId));
    const relevantPayments = payments.filter(row => belongsTo(row, ids, fileId));
    const relevantExpenses = expenses.filter(row => belongsTo(row, ids, fileId));
    const totalFees = relevantFees.reduce((sum, row) => sum + number(row.total), 0);
    const collected = relevantPayments.reduce((sum, row) => sum + number(row.amount), 0);
    const expensesTotal = relevantExpenses.reduce((sum, row) => sum + number(row.amount), 0);
    return { totalFees, collected, remaining: Math.max(0, totalFees - collected), expenses: expensesTotal, profit: collected - expensesTotal };
  }
  return { normalizeFee, createPayment, createExpense, summarizeFinance };
});

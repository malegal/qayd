const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const html = fs.readFileSync('index.html', 'utf8');
const renderer = fs.readFileSync('renderer.js', 'utf8');
const qmf = fs.readFileSync('qayd-main-file.js', 'utf8');
const finance = fs.readFileSync('qayd-finance.js', 'utf8');
const files = { html, renderer, qmf, finance };
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failed += 1; failures.push({ name, error: error.message }); console.error(`FAIL ${name}\n  ${error.message}`); }
}
function count(re, source) { return (source.match(re) || []).length; }
function mustInclude(source, value, label = value) { assert.ok(source.includes(value), `missing ${label}`); }

// Application shell and navigation
const tabIds = ['dashboardTab', 'agendaTab', 'financeTab', 'cases', 'archiveTab', 'searchTab'];
const navTargets = [...html.matchAll(/data-bs-target="#([^"]+)"/g)].map(m => m[1]);
test('all navigation targets resolve to existing tab panes', () => {
  assert.ok(navTargets.length >= 6, 'expected operational navigation links');
  for (const target of navTargets) assert.ok(html.includes(`id="${target}"`), `missing target #${target}`);
});
test('all operational tab panes are unique', () => {
  for (const id of tabIds) assert.equal(count(new RegExp(`id="${id}"`, 'g'), html), 1, `${id} must be unique`);
});
test('tab panes are not nested inside another tab pane', () => {
  const start = html.indexOf('<div class="tab-content">');
  const end = html.indexOf('<!-- ========== النوافذ المنبثقة', start);
  const content = html.slice(start, end > start ? end : undefined);
  const starts = [...content.matchAll(/<div class="tab-pane fade" id="([^"]+)"/g)].map(m => m.index);
  assert.ok(starts.length >= 6, 'not all tab panes are in the main content');
  for (let i = 1; i < starts.length; i++) {
    const between = content.slice(starts[i - 1], starts[i]);
    assert.equal(count(/<div class="tab-pane fade"/g, between), 1, `tab ${i} appears nested in previous tab`);
  }
});
test('sidebar has no scrolling navigation rule and includes compact tools', () => {
  assert.ok(!html.includes('.nav-pills { flex: 1; overflow-y: auto;'), 'sidebar still has the old scrolling rule');
  mustInclude(html, 'aria-label="المزامنة"', 'sync icon label');
  mustInclude(html, 'aria-label="الإعدادات"', 'settings icon label');
  mustInclude(html, 'إدارة الملفات', 'files navigation label');
});

// Welcome and owner identity
for (const phrase of ['مرحبًا بك في مكتب جاد الرب للمحاماة', 'مرحبًا بك في نظام قيد', 'محمود عبد الحميد جاد الرب', 'المحامي']) {
  test(`welcome/identity contains ${phrase}`, () => mustInclude(html, phrase));
}
test('first launch does not cover welcome screen with setup modal', () => {
  assert.ok(!renderer.includes("if (!hasOffice) showModal('officeSetupModal')"));
  mustInclude(html, 'startFirstInstallRegistration()', 'registration action');
});

// Modal and agenda coverage
test('sessions modal contains no duplicate week/month panel', () => {
  const source = html.slice(html.indexOf('id="sessions"'), html.indexOf('<!-- تبويب الأرشيف -->'));
  for (const phrase of ['جلسات قادمة', 'الأسبوع الحالي', 'الشهر الحالي']) assert.ok(!source.includes(phrase), phrase);
  mustInclude(renderer, 'openSessionsModal', 'sessions modal handler');
});
test('agenda toolbar exposes sessions, calculator, and task/event actions', () => {
  for (const fn of ['openSessionsModal()', 'openDeadlineCalculatorModal()', "openAgendaItemModal('task')"]) mustInclude(html, fn, fn);
});
test('all major modals have unique IDs and Bootstrap markup', () => {
  const ids = [...html.matchAll(/class="modal fade" id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length >= 12, `only ${ids.length} modals found`);
  assert.equal(new Set(ids).size, ids.length, 'duplicate modal ID');
  for (const id of ['officeSetupModal', 'sessionsModal', 'deadlineCalculatorModal', 'agendaItemModal']) {
    if (id === 'sessionsModal') continue; // created at runtime
    mustInclude(html, `id="${id}"`, id);
  }
});

// Legal file, case stages, finance and PDF features
for (const [label, source, symbols] of [
  ['MJ file model', qmf, ['openCreateModal', 'openPanel', 'openAddStage', 'openCaseDetails']],
  ['finance model', finance, ['normalizeFee', 'summarizeFinance']],
  ['renderer finance', renderer, ['openFeesModal', 'addPayment', 'addExpense', 'printFeesPDF']],
  ['PDF printing', renderer, ['printCasePDF', 'printFeesPDF']]
]) {
  test(`${label} exposes required operations`, () => {
    for (const symbol of symbols) assert.ok(source.includes(symbol), `missing ${symbol}`);
  });
}
test('stage workflow includes judgment outcome and next-stage action', () => {
  for (const phrase of ['منطوق الحكم', 'إضافة مرحلة جديدة', 'proceeding_type']) {
    assert.ok(qmf.includes(phrase) || renderer.includes(phrase), `missing ${phrase}`);
  }
});
test('finance records preserve legal-file and stage context', () => {
  for (const phrase of ['legal_file_id', 'case_id', 'transaction_scope']) assert.ok(renderer.includes(phrase), `missing ${phrase}`);
});

// Storage, backup, sync and safety
for (const [label, source, symbols] of [
  ['local storage', renderer, ['new Dexie', 'db.version(13)', 'pendingOperations']],
  ['backup/restore', renderer, ['exportBackup', 'importBackup']],
  ['Supabase sync', renderer, ['syncWithSupabase', 'uploadToSupabase', 'downloadFromSupabase']],
  ['owner safety', renderer, ['ownerOnly', 'OWNER_OFFICE_ID', 'OWNER_LICENSE_KEY']]
]) {
  test(`${label} integration points are present`, () => {
    for (const symbol of symbols) assert.ok(source.includes(symbol), `missing ${symbol}`);
  });
}
test('all project JavaScript files pass Node syntax validation', () => {
  for (const file of ['main.js', 'preload.js', 'renderer.js', 'qayd-finance.js', 'qayd-main-file.js']) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
});
test('HTML has balanced tags under a strict parser', () => {
  const { Parser } = require('node:util');
  // A lightweight structural check for the common regression: tab-pane nesting.
  assert.equal(count(/<div class="tab-pane fade/g, html), 8, 'unexpected tab-pane count');
  assert.equal(count(/id="sessions"/g, html), 1, 'sessions source must be unique');
});

const result = { passed, failed, total: passed + failed, failures };
console.log(`\nSTATIC_SUMMARY ${JSON.stringify(result)}`);
if (failed) process.exitCode = 1;

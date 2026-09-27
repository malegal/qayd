/*
 * Functional test for the file-management productivity upgrade (FMPro):
 *   2. table/card view + column sorting
 *   3. advanced filters
 *   5. next-session column + overdue highlighting
 *   4. bulk selection + CSV export
 *   6. unified smart search (palette)
 *   9. keyboard shortcuts (Ctrl+K / Enter)
 *  12. overdue dashboard
 * Extracts the real FMPro block from renderer.js and runs it in jsdom.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); }
catch (e) { console.log('SKIP fm-pro-functional: jsdom not installed'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
const start = renderer.indexOf('window.loadCasesList =');
const end = renderer.indexOf('function escapeHtml(');
assert.ok(start > -1 && end > start, 'could not locate FMPro block');
const snippet = renderer.slice(start, end);

function makeCollection(rows) {
  return {
    rows,
    toArray: async () => rows.slice(),
    filter(fn) { return makeCollection(rows.filter(fn)); },
    where(field) { return { equals(val) { return makeCollection(rows.filter(r => r[field] === val)); } }; },
    async get(id) { return rows.find(r => r.id === id); },
    async update(id, patch) { const r = rows.find(x => x.id === id); if (r) Object.assign(r, patch); },
    async add(o) { rows.push(o); return o.id; }
  };
}

const BODY = `
  <div class="tab-pane fade active show" id="cases">
    <div class="fm-overdue-dashboard" id="fmOverdueDashboard"></div>
    <input id="caseSearchInput">
    <select id="serviceFilter"><option value=""></option><option value="judicial">j</option><option value="main_file">m</option></select>
    <select id="fmFilterCategory"><option value=""></option><option value="judicial">j</option><option value="professional">p</option></select>
    <select id="fmFilterStatus"><option value=""></option><option value="in_progress">ip</option></select>
    <select id="courtFilter"><option value=""></option><option>محكمة القاهرة</option></select>
    <input id="fmFilterResponsible">
    <input id="fmFilterDateFrom" type="date">
    <input id="fmFilterDateTo" type="date">
    <select id="fmPresetSelect"></select>
    <div class="fm-bulk-bar" id="fmBulkBar" style="display:none"><strong id="fmBulkCount">0</strong></div>
    <span id="fmFilterCount" style="display:none"></span>
    <button id="fmFiltersToggleBtn"></button>
    <button id="fmViewCardsBtn"></button>
    <button id="fmViewTableBtn"></button>
    <button id="fmBulkToggleBtn"></button>
    <div id="casesListContainer"></div>
    <div class="fm-palette-results" id="fmPaletteResults"></div>
    <input id="fmPaletteInput">
  </div>`;

function setup(seed) {
  const dom = new JSDOM('<!DOCTYPE html><body>' + BODY + '</body>', { runScripts: 'outside-only', url: 'https://localhost/' });
  const { window } = dom;
  const db = {
    cases: makeCollection(seed.cases || []),
    legalFiles: makeCollection(seed.legalFiles || []),
    officeFiles: makeCollection(seed.officeFiles || []),
    sessions: makeCollection(seed.sessions || []),
    pendingOperations: makeCollection([])
  };
  window.db = db;
  window.currentOfficeId = 'OFFICE-1';
  window.escapeHtml = s => (s == null ? '' : String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])));
  window.professionalTypeLabel = t => t;
  window.QMF = { openDetails: id => { window.__opened = ['main_file', id]; }, editMainFile: id => { window.__edited = id; }, deleteMainFile: id => { window.__deleted = id; } };
  window.openCaseDetails = id => { window.__opened = ['judicial', id]; return Promise.resolve(); };
  window.selectProfessionalFile = id => { window.__opened = ['professional', id]; };
  window.showModal = id => { window.__modal = id; };
  window.hideModal = id => { window.__hidden = id; };
  window.showTab = id => { window.__tab = id; };
  window.Swal = { fire: async () => ({ isConfirmed: true, value: 'SavedFilter' }) };
  window.Blob = function (parts) { this.parts = parts; };
  window.Blob.prototype.text = async function () { return this.parts.join(''); };
  window.__capturedBlob = null;
  window.URL.createObjectURL = b => { window.__capturedBlob = b; return 'blob:test'; };
  window.URL.revokeObjectURL = () => {};
  window.eval('var allCasesList = []; var allOfficeRecords = [];');
  window.eval(snippet);
  return { window, db };
}

const today = new Date();
const iso = d => d.toISOString();
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 19); };

const mainFile = { id: 'LF-1', office_id: 'OFFICE-1', file_code: 'MJ-2025-0001', file_type: 'judicial', file_category: 'judicial', title: 'قضية تجارية', client_name: 'أحمد', status: 'in_progress', updated_at: iso(today) };
const stageCase = { id: 'C-1', office_id: 'OFFICE-1', legal_file_id: 'LF-1', case_code: 'C-2025-0001', client_name: 'أحمد', court_name: 'محكمة القاهرة' };
const officeFile = { id: 'OF-1', office_id: 'OFFICE-1', file_code: 'OF-2025-0001', file_type: 'real_estate', title: 'تسجيل عقار', client_name: 'سعيد', status: 'new', updated_at: iso(today) };
const futureSession = { id: 'S-1', office_id: 'OFFICE-1', case_id: 'C-1', session_date: inDays(3), case_status: 'قيد النظر', decision: 'تأجيل', responsible_name: 'محامي أحمد' };
const overdueSession = { id: 'S-2', office_id: 'OFFICE-1', case_id: 'OF-1', session_date: inDays(-10), case_status: 'مؤجلة', followup_date: inDays(-5), required_action: 'تقديم مستند' };

function test(name, fn) { return (async () => { try { await fn(); console.log('PASS ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; } })(); }

(async () => {
  await test('next session + overdue metrics are computed (5)', async () => {
    const { window } = setup({ cases: [stageCase], legalFiles: [mainFile], officeFiles: [officeFile], sessions: [futureSession, overdueSession] });
    await window.loadCasesList();
    const m1 = window.fmState.metrics['LF-1'];
    const m2 = window.fmState.metrics['OF-1'];
    assert.ok(m1.nextSessionDate && m1.nextSessionDate.slice(0, 10) === inDays(3).slice(0, 10), 'main file should expose the next session from its stage');
    assert.equal(m1.overdue, false, 'main file with a future session is not overdue');
    assert.equal(m1.responsible, 'محامي أحمد', 'responsible should come from the latest session');
    assert.equal(m2.overdue, true, 'office file with a past follow-up and no future session is overdue');
  });

  await test('overdue dashboard renders stats (12)', async () => {
    const { window } = setup({ cases: [stageCase], legalFiles: [mainFile], officeFiles: [officeFile], sessions: [futureSession, overdueSession] });
    await window.loadCasesList();
    const html = window.document.getElementById('fmOverdueDashboard').innerHTML;
    assert.ok(html.includes('متابعات متأخرة'), 'dashboard shows overdue card');
    assert.ok(html.includes('إجمالي الملفات'), 'dashboard shows total card');
  });

  await test('table view renders sortable headers and next-session column (2,5)', async () => {
    const { window } = setup({ cases: [stageCase], legalFiles: [mainFile], officeFiles: [officeFile], sessions: [futureSession, overdueSession] });
    await window.loadCasesList();
    window.FMPro.setView('table');
    const html = window.document.getElementById('casesListContainer').innerHTML;
    assert.ok(html.includes('fm-table'), 'table markup rendered');
    assert.ok(html.includes('الجلسة القادمة'), 'next-session column present');
    assert.ok(html.includes("FMPro.sortBy('next_session')"), 'next-session header is sortable');
    assert.ok(html.includes('fm-row-overdue'), 'overdue row highlighted');
    window.FMPro.sortBy('client');
    assert.equal(window.fmState.sortKey, 'client', 'sort key updated on header click');
  });

  await test('advanced filters narrow the list (3)', async () => {
    const { window } = setup({ cases: [stageCase], legalFiles: [mainFile], officeFiles: [officeFile], sessions: [futureSession, overdueSession] });
    await window.loadCasesList();
    window.document.getElementById('fmFilterCategory').value = 'professional';
    window.FMPro.onFilterChange();
    let html = window.document.getElementById('casesListContainer').innerHTML;
    assert.equal((html.match(/case-card-item/g) || []).length, 1, 'category filter keeps only the professional file');
    window.FMPro.clearFilters();
    html = window.document.getElementById('casesListContainer').innerHTML;
    assert.equal((html.match(/case-card-item/g) || []).length, 2, 'clearing filters restores all records');
  });

  await test('saved filter presets persist and apply (3)', async () => {
    const { window } = setup({ cases: [stageCase], legalFiles: [mainFile], officeFiles: [officeFile] });
    await window.loadCasesList();
    window.document.getElementById('fmFilterCategory').value = 'judicial';
    window.FMPro.onFilterChange();
    await window.FMPro.savePreset(); // Swal stubbed to confirm with value 'SavedFilter'
    const stored = JSON.parse(window.localStorage.getItem('fm_filter_presets'));
    assert.equal(stored.length, 1, 'preset stored in localStorage');
    window.FMPro.clearFilters();
    window.FMPro.applyPreset(0);
    assert.equal(window.document.getElementById('fmFilterCategory').value, 'judicial', 'preset restores filter value');
    assert.equal((window.document.getElementById('casesListContainer').innerHTML.match(/case-card-item/g) || []).length, 1, 'preset re-applies filtering');
  });

  await test('bulk selection + CSV export (4)', async () => {
    const { window } = setup({ cases: [stageCase], legalFiles: [mainFile], officeFiles: [officeFile] });
    await window.loadCasesList();
    window.FMPro.toggleBulkMode();
    window.FMPro.selectAllVisible();
    assert.equal(window.document.getElementById('fmBulkCount').textContent, '2', 'both records selected');
    window.FMPro.bulkExport();
    assert.ok(window.__capturedBlob, 'CSV blob created');
    const csv = await window.__capturedBlob.text();
    assert.ok(csv.includes('الكود'), 'CSV has header');
    assert.ok(csv.includes('MJ-2025-0001'), 'CSV contains exported record');
  });

  await test('unified smart search palette returns matches (6)', async () => {
    const { window } = setup({ cases: [stageCase], legalFiles: [mainFile], officeFiles: [officeFile], sessions: [futureSession] });
    await window.loadCasesList();
    await window.FMPro.paletteSearch('أحمد');
    let html = window.document.getElementById('fmPaletteResults').innerHTML;
    assert.ok(html.includes('أحمد'), 'palette shows the matching client');
    await window.FMPro.paletteSearch('zzz-none');
    html = window.document.getElementById('fmPaletteResults').innerHTML;
    assert.ok(html.includes('لا توجد نتائج'), 'palette shows empty state');
  });

  await test('keyboard shortcuts: Ctrl+K opens palette, Enter opens first (9)', async () => {
    const { window } = setup({ cases: [stageCase], legalFiles: [mainFile], officeFiles: [officeFile] });
    await window.loadCasesList();
    window.fmHandleKeydown({ key: 'k', ctrlKey: true, preventDefault() {} });
    assert.equal(window.__modal, 'fmCommandPalette', 'Ctrl+K opens the command palette');
    window.__opened = null;
    window.fmHandleKeydown({ key: 'Enter', target: window.document.body, preventDefault() {} });
    assert.ok(window.__opened, 'Enter opens the first/selected record');
  });

  console.log('\nFM_PRO_FUNCTIONAL_DONE');
})();

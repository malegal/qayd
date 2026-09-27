/*
 * Functional test for file-management list behaviour:
 *   - a case registered as a main file (MJ) must appear ONCE (as main file only)
 *   - the search box filters the rendered list
 *   - clicking a record routes to the correct details opener
 * Extracts the real loadCasesList/filterCasesList from renderer.js and runs them in jsdom.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); }
catch (e) { console.log('SKIP cases-list-functional: jsdom not installed'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');

// slice the two functions of interest
const start = renderer.indexOf('window.loadCasesList =');
const end = renderer.indexOf('function escapeHtml(');
assert.ok(start > -1 && end > start, 'could not locate loadCasesList/filterCasesList');
const snippet = renderer.slice(start, end);

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}\n  ${error.message}`); process.exitCode = 1; }
}

function makeCollection(rows) {
  return {
    rows,
    toArray: async () => rows.slice(),
    filter(fn) { return makeCollection(rows.filter(fn)); },
    where(field) { return { equals(val) { return makeCollection(rows.filter(r => r[field] === val)); } }; },
    async get(id) { return rows.find(r => r.id === id); }
  };
}

function setup(seed) {
  const dom = new JSDOM('<!DOCTYPE html><body><input id="caseSearchInput"><select id="courtFilter"></select><select id="serviceFilter"></select><div id="casesListContainer"></div></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  const db = {
    cases: makeCollection(seed.cases || []),
    legalFiles: makeCollection(seed.legalFiles || []),
    officeFiles: makeCollection(seed.officeFiles || [])
  };
  window.db = db;
  window.currentOfficeId = 'OFFICE-1';
  window.escapeHtml = s => (s == null ? '' : String(s));
  window.professionalTypeLabel = t => t;
  window.QMF = { openDetails: id => { window.__opened = ['main_file', id]; } };
  window.openCaseDetails = id => { window.__opened = ['judicial', id]; };
  window.selectProfessionalFile = id => { window.__opened = ['professional', id]; };
  // declare the globals the snippet expects, then eval the snippet
  window.eval('var allCasesList = []; var allOfficeRecords = [];');
  window.eval(snippet);
  return { window };
}

const mainFile = { id: 'LF-1', office_id: 'OFFICE-1', file_code: 'MJ-2025-0001', file_type: 'judicial', file_category: 'judicial', title: 'قضية تجارية', client_name: 'أحمد', status: 'in_progress' };
const stageCase = { id: 'C-1', office_id: 'OFFICE-1', legal_file_id: 'LF-1', case_code: 'C-2025-0001', client_name: 'أحمد', case_number: '100', case_year: '2025', court_name: 'محكمة القاهرة' };

(async () => {
  await (async () => {
    try {
      const { window } = setup({ cases: [stageCase], legalFiles: [mainFile] });
      await window.loadCasesList();
      const html = window.document.getElementById('casesListContainer').innerHTML;
      const count = (html.match(/case-card-item/g) || []).length;
      assert.equal(count, 1, `expected exactly one rendered record, got ${count}`);
      assert.ok(html.includes('ملف رئيسي'), 'record must be labelled as main file');
      console.log('PASS registered case shows once (as main file)');
    } catch (e) { console.error('FAIL registered case shows once (as main file)\n  ' + e.message); process.exitCode = 1; }
  })();

  await (async () => {
    try {
      const { window } = setup({ cases: [stageCase], legalFiles: [mainFile] });
      await window.loadCasesList();
      // search matches client name
      window.document.getElementById('caseSearchInput').value = 'أحمد';
      window.filterCasesList();
      let html = window.document.getElementById('casesListContainer').innerHTML;
      assert.equal((html.match(/case-card-item/g) || []).length, 1, 'search by client name should keep the record');
      // search that matches nothing
      window.document.getElementById('caseSearchInput').value = 'zzz-no-match';
      window.filterCasesList();
      html = window.document.getElementById('casesListContainer').innerHTML;
      assert.equal((html.match(/case-card-item/g) || []).length, 0, 'no-match search should render nothing');
      console.log('PASS search box filters the file-management list');
    } catch (e) { console.error('FAIL search box filters the file-management list\n  ' + e.message); process.exitCode = 1; }
  })();

  await (async () => {
    try {
      const { window } = setup({ cases: [stageCase], legalFiles: [mainFile] });
      await window.loadCasesList();
      const html = window.document.getElementById('casesListContainer').innerHTML;
      assert.ok(html.includes("QMF.openDetails('LF-1')"), 'main file click must open QMF details');
      console.log('PASS clicking a main file opens its details');
    } catch (e) { console.error('FAIL clicking a main file opens its details\n  ' + e.message); process.exitCode = 1; }
  })();

  await (async () => {
    try {
      const { window } = setup({ cases: [stageCase], legalFiles: [mainFile] });
      await window.loadCasesList();
      // service filter = judicial should still include the main file
      window.document.getElementById('serviceFilter').value = 'judicial';
      window.filterCasesList();
      const html = window.document.getElementById('casesListContainer').innerHTML;
      assert.equal((html.match(/case-card-item/g) || []).length, 1, 'judicial filter should keep the judicial main file');
      console.log('PASS judicial filter keeps judicial main file');
    } catch (e) { console.error('FAIL judicial filter keeps judicial main file\n  ' + e.message); process.exitCode = 1; }
  })();

  console.log('\nCASES_LIST_FUNCTIONAL_DONE');
})();

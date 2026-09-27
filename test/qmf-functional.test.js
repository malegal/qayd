/*
 * Functional test for QMF (main file) new operations:
 *   - editMainFile / saveMainFile (edit mode)
 *   - archiveMainFile
 *   - deleteMainFile
 *   - addSessionForFile / rescheduleFileSession (presence + wiring)
 * Runs the real qayd-main-file.js inside jsdom with a mock db.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); }
catch (e) { console.log('SKIP qmf-functional: jsdom not installed'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..');
const qmfSource = fs.readFileSync(path.join(ROOT, 'qayd-main-file.js'), 'utf8');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}\n  ${error.message}`); process.exitCode = 1; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}\n  ${error.message}`); process.exitCode = 1; }
}

// ---- Minimal in-memory Dexie-like mock -------------------------------------
function makeCollection(rows) {
  return {
    rows,
    toArray: async () => rows.slice(),
    filter(fn) { return makeCollection(rows.filter(fn)); },
    where(field) {
      return {
        equals(val) {
          const matched = rows.filter(r => r[field] === val);
          return {
            toArray: async () => matched.slice(),
            delete: async () => { for (const r of matched) { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1); } },
            count: async () => matched.length
          };
        }
      };
    },
    async delete(id) { const i = rows.findIndex(r => r.id === id); if (i >= 0) rows.splice(i, 1); },
    async update(id, patch) { const r = rows.find(x => x.id === id); if (r) Object.assign(r, patch); return 1; },
    async get(id) { return rows.find(r => r.id === id) || undefined; },
    async add(obj) { rows.push(obj); return obj.id; },
    async put(obj) { const i = rows.findIndex(r => r.id === obj.id); if (i >= 0) rows[i] = obj; else rows.push(obj); return obj.id; }
  };
}

function buildDb(seed) {
  const store = {};
  for (const [k, v] of Object.entries(seed)) store[k] = v.slice();
  const db = {};
  for (const k of ['legalFiles', 'cases', 'sessions', 'fees', 'payments', 'expenses', 'proceedings', 'serviceActions', 'pendingOperations']) {
    store[k] = store[k] || [];
    db[k] = makeCollection(store[k]);
  }
  db._store = store;
  return db;
}

async function boot(seed) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="qmfFilesList"></div></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const db = buildDb(seed);
  window.db = db;
  window.currentOfficeId = 'OFFICE-1';
  window.currentUserRole = 'manager';
  window.currentOfficeName = 'مكتب الاختبار';
  window.escapeHtml = s => String(s == null ? '' : s);
  window.showModal = () => {};
  window.hideModal = () => {};
  window.generateUUID = () => 'uuid-' + Math.random().toString(36).slice(2);
  window.ownerOnly = () => true;
  window.Swal = { fire: async () => ({ isConfirmed: true, value: null }) };
  window.openSessionsModal = () => { window.__sessionsModalOpened = true; };
  window.selectCaseForSession = () => { window.__caseSelected = true; };
  window.openRescheduleModal = () => { window.__rescheduleOpened = true; };
  window.loadCasesList = async () => { window.__casesReloaded = true; };
  // execute the module in the window scope
  window.eval(qmfSource);
  // boot() is deferred to DOMContentLoaded; wait until QMF is exported
  for (let i = 0; i < 50 && !window.QMF; i++) { await new Promise(r => setTimeout(r, 10)); }
  return { window, db };
}

const seedFile = () => ({
  id: 'LF-1', office_id: 'OFFICE-1', file_code: 'MJ-2025-0001', file_type: 'judicial',
  file_category: 'judicial', title: 'قضية تجارية', client_name: 'أحمد', opponent_name: 'شركة',
  status: 'in_progress', created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z'
});
const seedStage = () => ({ id: 'C-1', office_id: 'OFFICE-1', legal_file_id: 'LF-1', stage_kind: 'first_instance', client_name: 'أحمد', opponent_name: 'شركة', case_number: '100', case_year: '2025' });

(async () => {
  await testAsync('QMF exposes the new main-file operations', async () => {
    const { window } = await boot({ legalFiles: [seedFile()], cases: [seedStage()] });
    for (const fn of ['editMainFile', 'archiveMainFile', 'deleteMainFile', 'addSessionForFile', 'rescheduleFileSession']) {
      assert.equal(typeof window.QMF[fn], 'function', `QMF.${fn} missing`);
    }
  });

  await testAsync('archiveMainFile marks the file archived and queues a sync op', async () => {
    const { window, db } = await boot({ legalFiles: [seedFile()], cases: [seedStage()] });
    await window.QMF.archiveMainFile('LF-1');
    const f = db._store.legalFiles.find(x => x.id === 'LF-1');
    assert.equal(f.status, 'archived');
    assert.equal(f.archived, 1);
    assert.ok(db._store.pendingOperations.some(o => o.operation === 'upsert_legal_file'));
  });

  await testAsync('deleteMainFile removes file, stages, sessions and queues delete', async () => {
    const { window, db } = await boot({
      legalFiles: [seedFile()],
      cases: [seedStage()],
      sessions: [{ id: 'S-1', case_id: 'C-1', session_date: '2025-02-01T10:00' }],
      proceedings: [{ id: 'PR-1', legal_file_id: 'LF-1' }],
      serviceActions: [{ id: 'ACT-1', legal_file_id: 'LF-1' }]
    });
    await window.QMF.deleteMainFile('LF-1');
    assert.equal(db._store.legalFiles.length, 0, 'legal file not deleted');
    assert.equal(db._store.cases.length, 0, 'stage not deleted');
    assert.equal(db._store.sessions.length, 0, 'session not deleted');
    assert.equal(db._store.proceedings.length, 0, 'proceeding not deleted');
    assert.equal(db._store.serviceActions.length, 0, 'service action not deleted');
    assert.ok(db._store.pendingOperations.some(o => o.operation === 'delete_legal_file'));
  });

  await testAsync('editMainFile populates the form and saveMainFile updates in place', async () => {
    const { window, db } = await boot({ legalFiles: [seedFile()], cases: [seedStage()] });
    await window.QMF.editMainFile('LF-1');
    assert.equal(window.document.getElementById('qmf_title').value, 'قضية تجارية');
    assert.equal(window.document.getElementById('qmf_client_name').value, 'أحمد');
    // change a field then save
    window.document.getElementById('qmf_title').value = 'قضية تجارية معدّلة';
    await window.QMF.saveMainFile();
    assert.equal(db._store.legalFiles.length, 1, 'edit must not create a new file');
    assert.equal(db._store.legalFiles[0].title, 'قضية تجارية معدّلة');
    // stage client name synced
    assert.equal(db._store.cases[0].client_name, 'أحمد');
  });

  await testAsync('addSessionForFile opens the sessions modal for the current stage', async () => {
    const { window } = await boot({ legalFiles: [seedFile()], cases: [seedStage()] });
    await window.QMF.addSessionForFile('LF-1');
    await new Promise(r => setTimeout(r, 700));
    assert.equal(window.__sessionsModalOpened, true, 'sessions modal not opened');
    assert.equal(window.__caseSelected, true, 'stage not auto-selected');
  });

  await testAsync('rescheduleFileSession opens the reschedule modal for a chosen session', async () => {
    const { window } = await boot({
      legalFiles: [seedFile()], cases: [seedStage()],
      sessions: [{ id: 'S-1', case_id: 'C-1', session_date: '2025-02-01T10:00', case_status: 'جديدة' }]
    });
    // Swal returns the first option key as value
    window.Swal.fire = async opts => ({ isConfirmed: true, value: opts.inputOptions ? Object.keys(opts.inputOptions)[0] : null });
    await window.QMF.rescheduleFileSession('LF-1');
    await new Promise(r => setTimeout(r, 400));
    assert.equal(window.__rescheduleOpened, true, 'reschedule modal not opened');
  });

  console.log('\nQMF_FUNCTIONAL_DONE');
})();

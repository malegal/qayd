/*
 * Functional test for the control-panel & owner-portal upgrades:
 *   - dashboard "أعمال اليوم والمتأخرات" panel (refreshDashboardToday)
 *   - clickable KPI helpers (dashOpenNeedingAction / dashOpenNoNextSession)
 *   - owner-portal "صحة المكتب" panel (refreshOwnerPortal health metrics)
 * Extracts the real functions from renderer.js and runs them in jsdom.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); }
catch (e) { console.log('SKIP dashboard-portal: jsdom not installed'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');

const start = renderer.indexOf('window.refreshDashboardToday =');
const end = renderer.indexOf('window.refreshOwnerPortal =');
assert.ok(start > -1 && end > start, 'could not locate dashboard block');
const dashBlock = renderer.slice(start, end);

const pStart = renderer.indexOf('window.refreshOwnerPortal =');
const pEnd = renderer.indexOf('// إثراء شاشة تفاصيل القضية');
assert.ok(pStart > -1 && pEnd > pStart, 'could not locate owner-portal block');
const portalBlock = renderer.slice(pStart, pEnd);

function makeCollection(rows) {
  return {
    rows,
    toArray: async () => rows.slice(),
    filter(fn) { return makeCollection(rows.filter(fn)); },
    where(field) { return { equals(val) { return makeCollection(rows.filter(r => r[field] === val)); } }; },
    async get(id) { return rows.find(r => r.id === id); },
    async bulkGet(ids) { return ids.map(id => rows.find(r => r.id === id)); },
    async count() { return rows.length; }
  };
}

const OFFICE = 'off-1';
const todayKey = new Date().toISOString().slice(0, 10);
const oldDate = '2020-01-01';

const BODY = `
  <div id="dashTodaySessionsList"></div>
  <div id="dashTodayTasksList"></div>
  <div id="dashTodayFollowupsList"></div>
  <span id="dashTodayOverdueCount">0</span>
  <select id="fmFilterStatus"><option value=""></option><option value="needs_action">na</option></select>
  <div id="portalMembersList"></div><div id="portalTasksList"></div>
  <div id="portalNotificationsList"></div><div id="portalApprovalList"></div>
  <span id="portalOpenTasks">0</span><span id="portalNotifications">0</span>
  <span id="portalApprovalCount">0</span><span id="portalConflictCount">0</span>
  <span id="portalHealthNeedingAction">0</span><span id="portalHealthOverdue">0</span>
  <span id="portalHealthWeek">0</span><span id="portalHealthPending">0</span>
  <span id="portalHealthFees">0</span><span id="portalHealthBadge">—</span>
  <div id="dashboardRecentActivity"></div>`;

const dom = new JSDOM(`<!DOCTYPE html><html><body>${BODY}</body></html>`, { runScripts: 'outside-only' });
const { window } = dom;
global.window = window; global.document = window.document;

// --- mock data ---
const cases = [
  { id: 'c1', office_id: OFFICE, case_code: 'C-1', client_name: 'أحمد', court_name: 'محكمة القاهرة', followup_date: oldDate, archived: 0 },
  { id: 'c2', office_id: OFFICE, case_code: 'C-2', client_name: 'سعيد', archived: 0 }
];
const legalFiles = [
  { id: 'lf1', office_id: OFFICE, file_code: 'MJ-1', title: 'ملف رئيسي', status: 'needs_action', followup_date: oldDate },
  { id: 'lf2', office_id: OFFICE, file_code: 'MJ-2', title: 'ملف مكتمل', status: 'completed' }
];
const sessions = [
  { id: 's1', office_id: OFFICE, case_id: 'c1', session_date: todayKey, session_time: '10:00' },
  { id: 's2', office_id: OFFICE, case_id: 'c2', session_date: todayKey }
];
const tasks = [
  { id: 1, office_id: OFFICE, description: 'مهمة متأخرة', date: oldDate, completed: 0 },
  { id: 2, office_id: OFFICE, description: 'مهمة مكتملة', date: oldDate, completed: 1 }
];
const fees = [ { case_id: 'c1', total: 1000, paid: 400, remaining: 600 } ];
const notes = [ { office_id: OFFICE, content: 'ملاحظة', updated_at: new Date().toISOString() } ];

const db = {
  cases: makeCollection(cases), legalFiles: makeCollection(legalFiles),
  sessions: makeCollection(sessions), tasks: makeCollection(tasks),
  fees: makeCollection(fees), notes: makeCollection(notes),
  officeFiles: makeCollection([]), pendingOperations: makeCollection([])
};

function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
function normalizeLegalFileStatus(s) { const v = String(s || '').trim(); return (!v || v === 'open') ? 'new' : v; }
function showTab() {}
function filterCasesList() {}
const fmState = { overdueOnly: false, noNextOnly: false };
let currentOfficeId = OFFICE;
const supabaseClient = null;
async function loadOwnerReviewData() { return { requests: [], conflicts: [] }; }
function reviewEntityLabel() { return 'كيان'; }
async function updateSyncStatusUI() {}
async function renderNotificationsCenter() {}

const ctx = { db, currentOfficeId, escapeHtml, normalizeLegalFileStatus, showTab, filterCasesList, fmState, supabaseClient, loadOwnerReviewData, reviewEntityLabel, updateSyncStatusUI, renderNotificationsCenter, console };
const runner = new Function('db','currentOfficeId','escapeHtml','normalizeLegalFileStatus','showTab','filterCasesList','fmState','supabaseClient','loadOwnerReviewData','reviewEntityLabel','updateSyncStatusUI','renderNotificationsCenter','console',
  `const window = this; ${dashBlock}\n${portalBlock}\n return { refreshDashboardToday: window.refreshDashboardToday, refreshOwnerPortal: window.refreshOwnerPortal, dashOpenNeedingAction: window.dashOpenNeedingAction, dashOpenNoNextSession: window.dashOpenNoNextSession };`);
const api = runner.call(window, db, currentOfficeId, escapeHtml, normalizeLegalFileStatus, showTab, filterCasesList, fmState, supabaseClient, loadOwnerReviewData, reviewEntityLabel, updateSyncStatusUI, renderNotificationsCenter, console);

(async () => {
  // dashboard today panel
  await api.refreshDashboardToday();
  assert.match(document.getElementById('dashTodaySessionsList').innerHTML, /C-1/, 'today session C-1 shown');
  assert.match(document.getElementById('dashTodaySessionsList').innerHTML, /10:00/, 'session time shown');
  assert.match(document.getElementById('dashTodayTasksList').innerHTML, /مهمة متأخرة/, 'late task shown');
  assert.doesNotMatch(document.getElementById('dashTodayTasksList').innerHTML, /مهمة مكتملة/, 'completed task hidden');
  assert.match(document.getElementById('dashTodayFollowupsList').innerHTML, /MJ-1/, 'overdue followup shown');
  assert.match(document.getElementById('dashTodayOverdueCount').innerText, /2 متأخر/, 'overdue count = 2');
  console.log('PASS dashboard today panel populates sessions/tasks/followups');

  // clickable KPI helpers
  fmState.noNextOnly = false;
  api.dashOpenNeedingAction();
  assert.equal(document.getElementById('fmFilterStatus').value, 'needs_action', 'needing-action sets status filter');
  api.dashOpenNoNextSession();
  assert.equal(fmState.noNextOnly, true, 'no-next-session sets flag');
  assert.equal(document.getElementById('fmFilterStatus').value, '', 'no-next-session clears status filter');
  console.log('PASS clickable KPI helpers wire filters');

  // owner portal health panel
  await api.refreshOwnerPortal();
  assert.equal(String(document.getElementById('portalHealthNeedingAction').innerText), '1', 'needing action = 1');
  assert.equal(String(document.getElementById('portalHealthOverdue').innerText), '2', 'overdue = late task + followup');
  assert.equal(String(document.getElementById('portalHealthWeek').innerText), '2', 'week sessions = 2');
  assert.equal(document.getElementById('portalHealthFees').innerText, '600.00 ج.م', 'remaining fees scoped to office');
  assert.match(document.getElementById('portalHealthBadge').innerText, /متابعة مطلوبة|عاجلة/, 'health badge reflects issues');
  console.log('PASS owner portal health panel computes metrics');

  console.log('DASHBOARD_PORTAL_DONE');
})().catch(err => { console.error(err); process.exit(1); });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const renderer = fs.readFileSync('renderer.js', 'utf8');
const mj = fs.readFileSync('qayd-main-file.js', 'utf8');
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}\n  ${error.message}`); process.exitCode = 1; }
}
test('MJ open-files action is not duplicated in quick actions', () => {
  assert.equal((html.match(/فتح الملفات الرئيسية/g) || []).length, 1);
  assert.ok(!mj.includes('id = \'qmfOpenBtn\''));
});
test('agenda month rows open their linked case through a safe session resolver', () => {
  assert.ok(renderer.includes('window.openAgendaSessionCase = async function(sessionId)'));
  assert.ok(renderer.includes("onclick=\"openAgendaSessionCase('${escapeHtml(s.id)}')\""));
});
test('court filter is populated from entered records', () => {
  assert.ok(renderer.includes('function fmRefreshDynamicCourtFilter()'));
  assert.ok(renderer.includes('fmRefreshDynamicCourtFilter();'));
  assert.ok(renderer.includes("String(record.court_name || '').trim()"));
});
test('MJ form includes complete client and opponent contact fields', () => {
  for (const id of ['qmf_client_email', 'qmf_client_power_number', 'qmf_client_power_year', 'qmf_client_notary', 'qmf_opp_nid', 'qmf_opp_addr', 'qmf_opp_email']) {
    assert.ok(mj.includes(`id="${id}"`), `${id} missing`);
  }
});
test('finance page exposes stage-level fees for MJ stages', () => {
  assert.ok(renderer.includes('أتعاب المرحلة'));
  assert.ok(renderer.includes("openFeesModal('${r.record_id}','${r.legal_file_id}','stage')"));
});
console.log('CASE_WORKFLOWS_DONE');

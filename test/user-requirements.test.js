const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const renderer = fs.readFileSync('renderer.js', 'utf8');
const qmf = fs.readFileSync('qayd-main-file.js', 'utf8');
const main = fs.readFileSync('main.js', 'utf8');
function test(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; } }

test('Electron loads the UI relative to the application directory', () => {
  assert.match(main, /loadFile\(path\.join\(__dirname, ['\"]index\.html/);
});

test('judicial file codes use MJ only and legacy JEL records are not loaded', () => {
  assert.match(renderer, /const MJ_CASE_CODE_RE = \/\^MJ-\[0-9\]\{2\}-\[0-9\]\{5\}-\[A-Z0-9\]\{4\}\$\//);
  assert.match(renderer, /filter\(c => isMJCaseCode\(c\.case_code \|\| c\.main_file_code\)\)/);
  assert.doesNotMatch(renderer, /JELR/);
  assert.doesNotMatch(main, /JELR/);
});

test('judicial type is labelled as a file, not a judicial case', () => {
  assert.match(qmf, /judicial:\s*\{ label: 'ملف قضائي'/);
  assert.doesNotMatch(qmf, /قضية قضائية/);
});

test('year fields are text inputs that accept judicial year notation', () => {
  for (const id of ['case_year']) assert.match(html, new RegExp(`<input[^>]+id="${id}"[^>]*type="text"`));
  for (const id of ['qmf_stage_year', 'qmf_ns_year']) assert.match(qmf, new RegExp(`<input[^>]+id="${id}"[^>]*type="text"`));
});

test('monthly agenda uses a distinct readable Arabic font', () => {
  assert.match(html, /agenda-month-item \{[^}]*font-family:\s*\"Amiri\"/s);
});

test('monthly agenda hides passed sessions unless they need follow-up', () => {
  assert.match(renderer, /monthSessions\s*=\s*sessions\.filter/);
  assert.match(renderer, /if \(dateKey >= todayKey\) return true/);
  assert.match(renderer, /جلسة سابقة بلا موعد لاحق/);
});

test('new stages inherit all parties from the previous stage', () => {
  assert.match(qmf, /caseParties\.where\('case_id'\)/);
  assert.match(qmf, /party_type/);
  assert.match(qmf, /db\.caseParties\.bulkAdd/);
});

test('dashboard active counter counts main files rather than every stage', () => {
  assert.match(renderer, /activeCaseCount\s*=.*activeLegalFiles\.length/);
  assert.match(renderer, /set\('dashActiveCases',\s*activeCaseCount\)/);
});

test('file details start with office code and requested summary order', () => {
  const start = qmf.indexOf('const body = `');
  const end = qmf.indexOf('document.getElementById(\'qmfDetailsBody\')', start);
  const body = qmf.slice(start, end);
  const order = ['رقم الملف في المكتب', 'اسم العميل', 'اسم الخصم', 'عنوان الملف', 'موضوع القضية', 'نوع القضية'];
  let previous = -1;
  for (const label of order) { const index = body.indexOf(label); assert.ok(index > previous, `${label} order`); previous = index; }
});

test('each stage offers edit and delete actions without generic stage wording', () => {
  assert.match(qmf, /QMF\.deleteStage/);
  assert.match(qmf, /حذف المرحلة/);
  assert.doesNotMatch(qmf, /مرحلة سابقة/);
});

test('login notification interval is installed only once', () => {
  assert.match(renderer, /notificationIntervalId/);
});

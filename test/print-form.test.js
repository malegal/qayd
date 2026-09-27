/*
 * Functional/static test for the print + case-form redesign requirements:
 *   B1 vertical sessions in print
 *   B2 no duplicate case_subject / case_status fields
 *   B3 "ملف قضائي" labelling instead of "قضية قضائية"
 *   B4 multi-party print line "العميل: X وآخرون ضد Y وآخرون"
 *   B5 fee receipt sentence (الرسوم والضرائب والدمغات...)
 *   C1..C6 client/opponent full fields, multiple parties, split sections,
 *          "إضافة مرحلة" button, stages dropdown + print labels.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('ok - ' + name); pass += 1; }

// ---------- Print: case report ----------
const pcStart = renderer.indexOf('window.printCasePDF =');
const pcEnd = renderer.indexOf('\n};', pcStart);
const printCase = renderer.slice(pcStart, pcEnd);

ok('B1 printCasePDF renders sessions as a vertical table (one row each)',
  printCase.includes('<table>') && printCase.includes('sessionRows') && printCase.includes('سجل الجلسات'));
ok('B3 printCasePDF title uses "ملف قضائي"',
  printCase.includes('ملف قضائي') && !printCase.includes('قضية قضائية'));
ok('B4 printCasePDF builds the "وآخرون ضد ... وآخرون" party line',
  printCase.includes('وآخرون') && printCase.includes('partiesLine') && printCase.includes('ضد'));
ok('C6 printCasePDF shows a human stage label ("مرحلة ...")',
  printCase.includes('مرحلة ') && printCase.includes('proceedingTypeLabels'));

// ---------- Print: fee receipt ----------
const pfStart = renderer.indexOf('window.printFeesPDF =');
const pfEnd = renderer.indexOf('\n};', pfStart);
const printFees = renderer.slice(pfStart, pfEnd);
ok('B5 fee receipt contains the fees/taxes/stamps sentence',
  printFees.includes('هذه المبالغ تشمل الرسوم و الضرائب و الدمغات و المصاريف الإدارية و التشغيلية و الانتقالات و الأتعاب حسب عقد الاتفاق'));

// ---------- Form: no duplicate fields (B2) ----------
ok('B2 case_subject appears exactly once in the form',
  (html.match(/id="case_subject"/g) || []).length === 1);
ok('B2 case_status appears exactly once in the form',
  (html.match(/id="case_status"/g) || []).length === 1);

// ---------- Form: sections (C4) ----------
ok('C4 form is split into numbered sections',
  html.includes('1) بيانات العملاء') && html.includes('2) بيانات الخصوم') &&
  html.includes('3) بيانات القضية') && html.includes('4) المرحلة'));

// ---------- Form: client fields (C1) ----------
for (const id of ['client_name', 'client_national_id', 'client_phone', 'client_address',
  'client_email', 'client_role', 'client_power_number', 'client_power_year', 'client_notary_office']) {
  ok('C1 client field present: ' + id, html.includes('id="' + id + '"'));
}

// ---------- Form: opponent fields without power of attorney (C2/C3) ----------
for (const id of ['opponent_name', 'opponent_national_id', 'opponent_phone', 'opponent_address', 'opponent_email', 'opponent_role']) {
  ok('C3 opponent field present: ' + id, html.includes('id="' + id + '"'));
}
ok('C3 opponent form has no power-of-attorney field',
  !/id="opponent_power/.test(html));

// ---------- Form: multiple parties ----------
ok('C2 add-client button present', html.includes("addCasePartyRow('client')"));
ok('C3 add-opponent button present', html.includes("addCasePartyRow('opponent')"));
ok('C2/C3 additional party rows support email + address',
  renderer.includes('party-email') && renderer.includes('party-address') &&
  renderer.includes('email: row.querySelector(\'.party-email\')'));

// ---------- Form: stage section (C5/C6) ----------
ok('C6 stage dropdown present', html.includes('id="case_stage"'));
ok('C6 stage dropdown offers أول درجة and استئناف',
  html.includes('>أول درجة</option>') && html.includes('>استئناف</option>'));
ok('C5 "إضافة مرحلة" button present', html.includes('addCaseStageRow()'));
ok('C5 additional-stages host present', html.includes('id="additionalStages"'));
ok('C6 first-session-date field present', html.includes('id="case_first_session_date"'));

// ---------- Renderer: stage helpers ----------
ok('C5 addCaseStageRow is defined', renderer.includes('window.addCaseStageRow = function()'));
ok('C5 collectAdditionalStages is defined', renderer.includes('function collectAdditionalStages()'));
ok('C5 saveNewCase creates extra proceedings from additional stages',
  renderer.includes('collectAdditionalStages()') && renderer.includes('extraStages'));

// ---------- Print labels map ----------
ok('C6 proceedingTypeLabels maps first_instance to أول درجة',
  /proceedingTypeLabels\s*=\s*\{[^}]*first_instance:\s*'أول درجة'/.test(renderer));

console.log('\nPRINT_FORM_DONE', pass);

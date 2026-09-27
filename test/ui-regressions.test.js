const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}\n  ${error.message}`); process.exitCode = 1; }
}

test('tab panes are siblings inside the main tab content', () => {
  const tabContent = html.slice(html.indexOf('<div class="tab-content">'), html.indexOf('</div>\n</div>\n</div>', html.indexOf('<div class="tab-content">')) + 6);
  for (const id of ['financeTab', 'cases', 'archiveTab', 'searchTab']) {
    assert.equal((tabContent.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must be inside the main tab content`);
    assert.equal((tabContent.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  assert.equal((html.match(/id="agendaTab"/g) || []).length, 1);
});

test('sessions modal source has no week or month panel', () => {
  const source = html.slice(html.indexOf('id="sessions"'), html.indexOf('<!-- تبويب الأرشيف -->'));
  assert.ok(!source.includes('جلسات قادمة'));
  assert.ok(!source.includes('الأسبوع الحالي'));
  assert.ok(!source.includes('الشهر الحالي'));
});

test('owner navigation shows all operational areas without sidebar scrolling', () => {
  assert.ok(!html.includes('.nav-pills { flex: 1; overflow-y: auto;'));
  assert.ok(html.includes('aria-label="المزامنة"'));
  assert.ok(html.includes('aria-label="الإعدادات"'));
  assert.ok(html.includes('إدارة الملفات'));
});

test('login is presented as a welcome screen', () => {
  assert.ok(html.includes('مرحبًا بك في مكتب جاد الرب للمحاماة'));
  assert.ok(html.includes('مرحبًا بك في نظام قيد'));
});

test('first launch keeps the welcome screen visible until registration is chosen', () => {
  assert.ok(!html.includes('if (!hasOffice) showModal(\'officeSetupModal\')'));
});

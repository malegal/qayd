const assert = require('node:assert/strict');
const fs = require('node:fs');

const renderer = fs.readFileSync('renderer.js', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const buildFiles = packageJson.build.files.join('\n');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}\n  ${error.message}`); process.exitCode = 1; }
}

test('upcoming sessions and day details use bulk case loading', () => {
  assert.match(renderer, /const caseRows = caseIds\.length \? await db\.cases\.bulkGet\(caseIds\)/);
  assert.match(renderer, /const dayCaseRows = dayCaseIds\.length \? await db\.cases\.bulkGet\(dayCaseIds\)/);
});

test('calendar indexes records by date before rendering days', () => {
  assert.match(renderer, /const sessionsByDate = new Map\(\), eventsByDate = new Map\(\), tasksByDate = new Map\(\)/);
  assert.match(renderer, /sessionsByDate\.get\(dateStr\) \|\| \[\]/);
});

test('basic search loads sessions in one grouped query', () => {
  assert.match(renderer, /db\.sessions\.where\('case_id'\)\.anyOf\(caseIds\)\.toArray\(\)/);
  assert.match(renderer, /sessionsByCase\.get\(String\(c\.id\)\)/);
});

test('non-runtime artifacts are excluded from Electron packaging', () => {
  for (const pattern of ['!screenshots', '!reports', '!test', '!icon-source.png']) assert.match(buildFiles, new RegExp(pattern.replace('!', '\\!')));
  assert.doesNotMatch(buildFiles, /qayd-stages-patch\.js|popup\.html/);
});

console.log('PERFORMANCE_SUMMARY');

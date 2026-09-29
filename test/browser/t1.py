from lib import *
with sync_playwright() as p:
    b, page, logs = launch(p)
    print(page.evaluate(SEED))
    page.evaluate("showTab('agendaTab')")
    page.evaluate("renderCalendar()"); page.wait_for_timeout(500)
    print('month list items:', page.evaluate("document.querySelectorAll('#agendaMonthCases .agenda-month-item').length"))
    page.evaluate("window.__modalLog.length=0")
    page.click('#agendaMonthCases .agenda-month-item >> nth=0'); page.wait_for_timeout(800)
    print('modalLog:', page.evaluate("window.__modalLog"))
    print('active tab:', page.evaluate("document.querySelector('.tab-pane.active')?.id"))
    print('caseDetailContent:', page.evaluate("document.getElementById('caseDetailContent').innerText.slice(0,200)"))
    print('--- logs'); print('\n'.join(l for l in logs if 'error' in l.lower() or 'pageerror' in l)[:1500])
    b.close()

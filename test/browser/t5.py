from lib import *
with sync_playwright() as p:
    b, page, logs = launch(p)
    page.evaluate(SEED)
    page.evaluate("""async()=>{ const now=new Date().toISOString();
      await db.caseParties.bulkAdd([
       {id:'p1',office_id:'office1',case_id:'c1',party_type:'client',name:'أحمد علي',role:'مدعي',phone:'0100',national_id:'29001',email:'a@x.com',address:'أسوان',power_of_attorney_number:'55',power_of_attorney_year:'2024',notary_office:'توثيق أسوان'},
       {id:'p2',office_id:'office1',case_id:'c1',party_type:'opponent',name:'محمد حسن',role:'مدعى عليه',phone:'0122',national_id:'28002',email:'m@x.com',address:'القاهرة'}]);
      await db.financialTransactions.put({id:'t1',office_id:'office1',transaction_type:'income',transaction_scope:'case',case_id:'c1',amount:1000,transaction_date:'2026-09-01',category:'دفعة'});
    }""")
    # --- search tab
    page.evaluate("showTab('searchTab')")
    page.fill('#searchInput','أحمد'); page.evaluate("searchCases()"); page.wait_for_timeout(500)
    print('search cards:', page.evaluate("document.querySelectorAll('#searchResults [onclick]').length"), page.evaluate("document.getElementById('searchResults').innerText.slice(0,120).replace(/\\n/g,' | ')"))
    page.evaluate("window.__modalLog.length=0")
    page.click('#searchResults [onclick] >> nth=0'); page.wait_for_timeout(700)
    print('click result ->', page.evaluate("window.__modalLog"))
    page.evaluate("clearBasicSearch()")
    print('after clear:', repr(page.evaluate("document.getElementById('searchInput').value")), page.evaluate("document.getElementById('searchResults').children.length"))
    # live search
    page.fill('#liveSearchInput','أحمد'); page.evaluate("runLiveSearch('أحمد')"); page.wait_for_timeout(500)
    page.evaluate("window.__modalLog.length=0")
    n=page.evaluate("document.querySelectorAll('#liveSearchResults [onclick]').length"); print('live rows:', n)
    if n:
        page.click('#liveSearchResults [onclick] >> nth=0'); page.wait_for_timeout(700); print('live click ->', page.evaluate("window.__modalLog"))
    # advanced modal
    page.evaluate("openAdvancedSearchModal()"); page.wait_for_timeout(300)
    page.fill('#advancedQuery','سارة'); page.evaluate("runAdvancedSearch()"); page.wait_for_timeout(500)
    print('adv results:', page.evaluate("document.getElementById('advancedSearchSummary').textContent"))
    page.evaluate("window.__modalLog.length=0")
    page.click('#advancedSearchResults .advanced-result-card >> nth=0'); page.wait_for_timeout(700)
    print('adv click ->', page.evaluate("window.__modalLog"))
    page.evaluate("openAdvancedSearchModal()"); page.evaluate("clearAdvancedSearch()")
    print('adv cleared:', repr(page.evaluate("document.getElementById('advancedQuery').value")))
    print('clear btns in modal:', page.evaluate("Array.from(document.querySelectorAll('#advancedSearchModal button')).map(b=>b.textContent.trim())"))
    print('clear btns in tab:', page.evaluate("Array.from(document.querySelectorAll('#searchTab button')).map(b=>b.textContent.trim())"))
    # --- finance
    page.evaluate("loadFinancePage()"); page.wait_for_timeout(600)
    print('finance:', page.evaluate("document.getElementById('financeTableBody').innerText.replace(/\\n+/g,' | ').slice(0,500)"))
    print('finance add-stage btns:', page.evaluate("Array.from(document.querySelectorAll('#financeTableBody button')).map(b=>b.textContent.trim())"))
    # --- QMF details
    page.evaluate("QMF.openDetails('lf1')"); page.wait_for_timeout(700)
    t=page.evaluate("document.getElementById('qmfDetailsBody').innerText.replace(/\\n+/g,' | ')")
    for k in ['بيانات العميل','بيانات الخصم','رقم التوكيل','29001','28002','تسلسل الجلسات','التأجيل للمستندات','إضافة مرحلة','ترحيل جلسة','طباعة']:
        print(k, k in t)
    print('--- errors'); print('\n'.join(l for l in logs if 'error' in l.lower())[:2000])
    b.close()

from lib import *
with sync_playwright() as p:
    b, page, logs = launch(p)
    page.evaluate(SEED)
    page.evaluate("openAddCaseModal()"); page.wait_for_timeout(300)
    page.evaluate("""() => {
      const set=(id,v)=>{const e=document.getElementById(id); if(!e) {console.log('MISSING '+id); return;} e.value=v;};
      set('client_name','منى إبراهيم'); set('client_national_id','29001010101010'); set('client_phone','01012345678'); set('client_address','أسوان - الصداقة'); set('client_email','mona@x.com');
      set('client_power_number','555'); set('client_power_year','2024'); set('client_notary_office','توثيق أسوان');
      addCasePartyRow('client');
      set('opponent_name','شركة الوادي'); set('opponent_phone','0222'); set('opponent_address','القاهرة'); set('opponent_role','مدعى عليه');
      set('case_type','مدنية'); set('case_title','مطالبة مالية'); set('case_subject','مطالبة بمبلغ');
      set('case_stage','first_instance'); set('case_number','900'); set('case_year','2026'); set('court_name','المحكمة الابتدائية'); set('circuit','الدائرة 3'); set('case_city','أسوان');
      set('case_first_session_date','2026-10-15'); set('case_notes','ملاحظة'); set('fee_total','8000'); set('fee_paid','2000');
    }""")
    r = page.evaluate("""async () => { try { await saveNewCase(); return 'returned'; } catch(e){ return 'THROW '+e.message; } }""")
    page.wait_for_timeout(800)
    print('save:', r)
    print(page.evaluate("""async () => ({
       lf: (await db.legalFiles.toArray()).map(f=>[f.file_code,f.title,f.client_name]),
       cases: (await db.cases.toArray()).map(c=>[c.id,c.case_code,c.client_name,c.case_number,c.legal_file_id||'-']),
       parties: (await db.caseParties.toArray()).map(p=>[p.party_type,p.name]),
       proceedings: (await db.proceedings.toArray()).length,
       fees: (await db.fees.toArray()).map(f=>[f.case_id,f.total]),
       sessions: (await db.sessions.toArray()).length,
       swal: window.__swalLog, modals: window.__modalLog
    })"""))
    print('--- errors'); print('\n'.join(l for l in logs if 'error' in l.lower() or 'MISSING' in l)[:1500])
    b.close()

import json, sys
from playwright.sync_api import sync_playwright

import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
H = os.path.dirname(os.path.abspath(__file__))

def launch(p, root=ROOT):
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    ctx = b.new_context(viewport={'width':1400,'height':900}, locale='ar-EG')
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.add_init_script(path=f'{H}/dexie_shim.js')
    page.add_init_script(path=f'{H}/stubs.js')
    def handle(route):
        u = route.request.url
        if u.startswith('http'):
            ct = 'text/css' if ('css' in u) else 'application/javascript'
            route.fulfill(status=200, content_type=ct, body='')
        else:
            route.continue_()
    page.route('**/*', handle)
    page.goto(f'file://{root}/index.html')
    page.wait_for_timeout(1500)
    return b, page, logs

SEED = r"""
async () => {
  const now = new Date().toISOString();
  currentOfficeId = 'office1'; currentUserRole = 'manager';
  const today = new Date(); const ym = today.toISOString().slice(0,7);
  const d = (n)=> `${ym}-${String(n).padStart(2,'0')}T10:00`;
  await db.legalFiles.put({id:'lf1', office_id:'office1', file_code:'MJ-0001', file_type:'judicial', file_category:'judicial', title:'نزاع ملكية', client_name:'أحمد علي', client_phone:'0100', status:'in_progress', created_at:now, updated_at:now});
  await db.cases.put({id:'c1', office_id:'office1', legal_file_id:'lf1', client_name:'أحمد علي', client_phone:'0100', case_code:'C-001', case_number:'123', case_year:'2025', court_name:'المحكمة الابتدائية', circuit:'الدائرة 5', city:'أسوان', case_type:'مدني', stage_kind:'first_instance', proceeding_type:'first_instance', opponent_name:'محمد حسن', status:'قيد النظر', created_at:now, updated_at:now});
  await db.cases.put({id:'c2', office_id:'office1', client_name:'سارة يوسف', client_phone:'0111', case_code:'C-002', case_number:'77', case_year:'2024', court_name:'محكمة الأسرة', circuit:'أسرة 2', case_type:'أسرة', opponent_name:'خالد', status:'مؤجلة', created_at:now, updated_at:now});
  await db.sessions.put({id:'s1', office_id:'office1', case_id:'c1', legal_file_id:'lf1', session_date:d(15), case_status:'قيد النظر', decision:'التأجيل للمستندات', court_name:'المحكمة الابتدائية', created_at:now});
  await db.sessions.put({id:'s2', office_id:'office1', case_id:'c2', session_date:d(20), case_status:'مؤجلة', decision:'', court_name:'محكمة الأسرة', created_at:now});
  await db.fees.put({case_id:'c1', total:5000, paid:1000, remaining:4000, notes:''});
  document.getElementById('appContainer').style.display='block';
  return 'seeded';
}
"""

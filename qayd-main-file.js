/* =====================================================================
 * qayd-main-file.js
 * v1.0.0 — نظام «الملف الرئيسي» الموحّد (MJ) + المراحل المتسلسلة
 *
 * الفكرة:
 *   ملف رئيسي واحد لكل عمل يحمل رقمًا إداريًا واحدًا يبدأ بـ MJ،
 *   ويمرّ عبر مراحل متسلسلة (قيد ← أول درجة ← استئناف ← التماس ← طعن ← تنفيذ).
 *   كل مرحلة لها رقم قضيتها وجلساتها وأتعابها، مع تغيّر صفة العميل/الخصم.
 *
 * يُحمَّل بعد renderer.js و qayd-stages-patch.js في index.html.
 * لا يعدّل الملف الأصلي — كل الإضافات ديناميكية.
 * ===================================================================== */

(function () {
  'use strict';

  const QMF_VERSION = '1.0.0';
  const MJ_PREFIX = 'MJ';

  /* ============================================================
   * 1) الثوابت
   * ============================================================ */
  const STAGE_KINDS = {
    registration:        { label: 'مرحلة القيد',         order: 0,   dbType: 'other',               hasNumber: false, hasSessions: false },
    first_instance:      { label: 'أول درجة',            order: 1,   dbType: 'first_instance',      hasNumber: true,  hasSessions: true  },
    appeal:              { label: 'استئناف',             order: 2,   dbType: 'appeal',              hasNumber: true,  hasSessions: true  },
    opposition:          { label: 'معارضة',              order: 2.5, dbType: 'opposition',          hasNumber: true,  hasSessions: true  },
    retrial:             { label: 'التماس إعادة النظر',  order: 3,   dbType: 'retrial',             hasNumber: true,  hasSessions: true, reuseNumber: true },
    cassation:           { label: 'طعن بالنقض',          order: 4,   dbType: 'cassation',           hasNumber: true,  hasSessions: true  },
    enforcement:         { label: 'تنفيذ',               order: 5,   dbType: 'enforcement',         hasNumber: true,  hasSessions: true  },
    execution_objection: { label: 'إشكال تنفيذ',         order: 5.5, dbType: 'execution_objection', hasNumber: true,  hasSessions: true  }
  };

  const FILE_TYPES = {
    judicial:                   { label: 'قضية قضائية',       category: 'judicial' },
    enforcement:                { label: 'ملف تنفيذ',         category: 'judicial' },
    real_estate:                { label: 'تسجيل عقاري',       category: 'professional' },
    corporate:                  { label: 'تأسيس شركة',        category: 'professional' },
    government_service:         { label: 'خدمة حكومية',       category: 'professional' },
    prosecution_investigation:  { label: 'تحقيقات النيابة',   category: 'professional' },
    dispute_committee:          { label: 'لجان فض المنازعات', category: 'professional' },
    grievance:                  { label: 'تظلم',              category: 'professional' },
    contract:                   { label: 'صياغة عقد',         category: 'general' },
    legal_consultation:         { label: 'استشارة قانونية',   category: 'general' },
    power_of_attorney:          { label: 'توكيل',             category: 'general' },
    warning:                    { label: 'إنذار',             category: 'general' },
    other:                      { label: 'أخرى',              category: 'general' }
  };

  const CATEGORY_LABELS = { judicial: 'قضائي', professional: 'خدمي/إجرائي', general: 'أعمال عامة' };
  const STATUS_LABELS = {
    new: 'جديد', submitting: 'قيد الرفع', in_progress: 'قيد العمل',
    needs_action: 'يحتاج إجراء', on_hold: 'متوقف', completed: 'مكتمل', archived: 'مؤرشف'
  };

  /* ============================================================
   * 2) الوصول الآمن للعموميات (renderer.js)
   * ============================================================ */
  function G() {
    // ملاحظة: نستخدم أسماء محلية مسبوقة بـ _ لتجنّب حجب (shadowing) العموميات
    // المعرّفة في renderer.js، لأن تكرار الاسم نفسه يُسبّب خطأ TDZ.
    const _db = (typeof db !== 'undefined' && db) ? db : (window.db || null);
    const _Swal = (typeof Swal !== 'undefined' && Swal) ? Swal : window.Swal;
    const _esc = (typeof escapeHtml !== 'undefined' && escapeHtml) ? escapeHtml : (window.escapeHtml || (s => String(s == null ? '' : s)));
    const _showModal = (typeof showModal !== 'undefined' && showModal) ? showModal : window.showModal;
    const _hideModal = (typeof hideModal !== 'undefined' && hideModal) ? hideModal : window.hideModal;
    const _genUUID = (typeof generateUUID !== 'undefined' && generateUUID) ? generateUUID : window.generateUUID;
    const _ownerOnly = (typeof ownerOnly !== 'undefined' && ownerOnly) ? ownerOnly : window.ownerOnly;
    const _ipc = (typeof ipcRenderer !== 'undefined' && ipcRenderer) ? ipcRenderer : window.ipcRenderer;
    const _officeId = (typeof currentOfficeId !== 'undefined' && currentOfficeId) ? currentOfficeId : window.currentOfficeId;
    const _role = (typeof currentUserRole !== 'undefined' && currentUserRole) ? currentUserRole : window.currentUserRole;
    const _officeName = (typeof currentOfficeName !== 'undefined' && currentOfficeName) ? currentOfficeName : window.currentOfficeName;
    return { db: _db, Swal: _Swal, esc: _esc, showModal: _showModal, hideModal: _hideModal, genUUID: _genUUID, ownerOnly: _ownerOnly, ipc: _ipc, officeId: _officeId, role: _role, officeName: _officeName };
  }

  /* ============================================================
   * 3) أدوات مساعدة
   * ============================================================ */
  function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }
  function mjRandom(n) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function digitsOnly(s) { return String(s == null ? '' : s).replace(/[^0-9]/g, ''); }
  function normCode(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function nowIso() { return new Date().toISOString(); }
  function stageLabel(kind) { return (STAGE_KINDS[kind] && STAGE_KINDS[kind].label) || kind || 'مرحلة'; }
  function fileTypeLabel(t) { return (FILE_TYPES[t] && FILE_TYPES[t].label) || t || 'ملف'; }
  function categoryOf(t) { return (FILE_TYPES[t] && FILE_TYPES[t].category) || 'general'; }
  function isJudicialType(t) { return categoryOf(t) === 'judicial'; }

  /* ============================================================
   * 4) توليد كود MJ محليًا (offline)
   * ============================================================ */
  async function generateMainFileCode() {
    const { db } = G();
    const year = String(new Date().getFullYear()).slice(-2);
    let count = 0;
    try {
      const all = await db.legalFiles.toArray();
      count = all.filter(f => String(f.file_code || '').startsWith(`${MJ_PREFIX}-${year}-`)).length;
    } catch (e) { count = 0; }
    for (let i = 0; i < 500; i++) {
      const cand = `${MJ_PREFIX}-${year}-${String(count + i + 1).padStart(5, '0')}-${mjRandom(4)}`;
      let exists = 0;
      try { exists = await db.legalFiles.where('file_code').equals(cand).count(); } catch (e) { exists = 0; }
      if (!exists) return cand;
    }
    return `${MJ_PREFIX}-${year}-${String(Date.now()).slice(-5)}-${mjRandom(4)}`;
  }
  function assertValidMainFileCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^MJ-[0-9]{2}-[0-9]{5}-[A-Z0-9]{4}$/.test(normalized)) {
      throw new Error('كود الملف الرئيسي غير صالح');
    }
    return normalized;
  }

  /* ============================================================
   * 5) حقن CSS
   * ============================================================ */
  function injectStyles() {
    if (document.getElementById('qmf-style')) return;
    const css = `
    .qmf-search { display:flex; align-items:center; gap:0; background:#ffffff; border:1px solid #d9e1eb; border-radius:10px; overflow:hidden; }
    .qmf-search .qmf-prefix { background:linear-gradient(135deg,#be9124,#d5b04c); color:#0f172a; font-weight:900; padding:10px 12px; letter-spacing:1px; }
    .qmf-search input { flex:1; border:0; background:transparent; color:#1c2b3f; padding:10px 12px; outline:none; font-weight:700; letter-spacing:1px; }
    .qmf-search input::placeholder { color:#7d8ea6; font-weight:500; letter-spacing:0; }
    .qmf-card { background:#ffffff; border:1px solid #d9e1eb; border-right:5px solid #be9124; border-radius:12px; padding:14px 16px; margin-bottom:12px; cursor:pointer; transition:.15s; }
    .qmf-card:hover { background:#fffaf0; transform:translateY(-1px); }
    .qmf-card .qmf-code { font-weight:900; color:#8a6814; letter-spacing:1px; font-size:1.05rem; }
    .qmf-card .qmf-title { color:#1c2b3f; font-weight:700; }
    .qmf-card .qmf-meta { color:#53657d; font-size:.85rem; margin-top:4px; }
    .qmf-badge { display:inline-block; padding:2px 10px; border-radius:20px; font-size:.75rem; font-weight:700; }
    .qmf-badge.judicial { background:#1e3a8a; color:#dbeafe; }
    .qmf-badge.professional { background:#065f46; color:#d1fae5; }
    .qmf-badge.general { background:#7c2d12; color:#ffedd5; }
    .qmf-stage { background:#ffffff; border:1px solid #d9e1eb; border-right:5px solid #3b82f6; border-radius:10px; padding:12px 14px; margin-bottom:12px; }
    .qmf-stage.current { border-right-color:#16a34a; background:#f0fdf4; }
    .qmf-stage .qmf-stage-head { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; }
    .qmf-stage .qmf-stage-head h5 { margin:0; color:#8a6814; font-weight:800; font-size:1rem; }
    .qmf-stage .qmf-stage-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:5px 12px; margin-top:8px; font-size:.88rem; color:#1c2b3f; }
    .qmf-stage .qmf-stage-grid b { color:#53657d; font-weight:600; }
    .qmf-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    .qmf-actions .btn { font-size:.82rem; }
    .qmf-judgment { background:#fff8e6; border:1px dashed #be9124; border-radius:8px; padding:8px 10px; margin-top:8px; color:#5b4610; font-size:.88rem; }
    .qmf-empty { text-align:center; color:#53657d; padding:26px; }
    .qmf-section-title { color:#8a6814; font-weight:800; margin:16px 0 8px; display:flex; align-items:center; gap:8px; }
    .qmf-fee-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:10px 0; }
    .qmf-fee-summary .box { background:#ffffff; border:1px solid #d9e1eb; border-radius:10px; padding:10px; text-align:center; }
    .qmf-fee-summary .box .v { font-size:1.15rem; font-weight:900; }
    .qmf-fee-summary .box .k { color:#53657d; font-size:.78rem; }
    `;
    const style = document.createElement('style');
    style.id = 'qmf-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ============================================================
   * 6) حقن النوافذ (Modals) وزر الدخول
   * ============================================================ */
  function injectModals() {
    if (document.getElementById('qmfMainFilesModal')) return;

    const html = `
    <!-- قائمة الملفات الرئيسية -->
    <div class="modal fade" id="qmfMainFilesModal" tabindex="-1">
      <div class="modal-dialog modal-xl">
        <div class="modal-content bg-dark text-white">
          <div class="modal-header">
            <h5 class="modal-title gold-text"><i class="bi bi-folder2-open"></i> الملفات الرئيسية (MJ)</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="d-flex gap-2 mb-3 flex-wrap align-items-center">
              <div class="qmf-search flex-grow-1" style="min-width:260px;">
                <span class="qmf-prefix">MJ-</span>
                <input id="qmfSearchInput" placeholder="اكتب الأرقام فقط… مثال: 00042" oninput="QMF.renderList(this.value)">
              </div>
              <button class="gold-btn" onclick="QMF.openCreateModal()"><i class="bi bi-plus-lg"></i> ملف رئيسي جديد</button>
            </div>
            <div id="qmfFilesList" style="max-height:64vh; overflow-y:auto;"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- إنشاء ملف رئيسي -->
    <div class="modal fade" id="qmfCreateModal" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content bg-dark text-white">
          <div class="modal-header">
            <h5 class="modal-title gold-text"><i class="bi bi-folder-plus"></i> إنشاء ملف رئيسي</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="row g-3">
              <div class="col-md-6">
                <label>نوع الملف</label>
                <select id="qmf_file_type" class="form-select" onchange="QMF.onTypeChange()">
                  ${Object.keys(FILE_TYPES).map(k => `<option value="${k}">${FILE_TYPES[k].label} — ${CATEGORY_LABELS[FILE_TYPES[k].category]}</option>`).join('')}
                </select>
              </div>
              <div class="col-md-6">
                <label>عنوان الملف</label>
                <input id="qmf_title" class="form-control" placeholder="مثال: نزاع ملكية قطعة أرض">
              </div>
              <div class="col-md-6"><label>اسم العميل</label><input id="qmf_client_name" class="form-control"></div>
              <div class="col-md-3"><label>هاتف العميل</label><input id="qmf_client_phone" class="form-control"></div>
              <div class="col-md-3"><label>صفة العميل</label><input id="qmf_client_role" class="form-control" placeholder="مدعي / مستأنف..."></div>
              <div class="col-md-6"><label>الرقم القومي للعميل</label><input id="qmf_client_nid" class="form-control" inputmode="numeric"></div>
              <div class="col-md-6"><label>عنوان العميل</label><input id="qmf_client_addr" class="form-control"></div>
              <div class="col-md-6"><label>اسم الخصم</label><input id="qmf_opp_name" class="form-control"></div>
              <div class="col-md-3"><label>صفة الخصم</label><input id="qmf_opp_role" class="form-control" placeholder="مدعى عليه..."></div>
              <div class="col-md-3"><label>هاتف الخصم</label><input id="qmf_opp_phone" class="form-control"></div>
              <div class="col-12"><label>وصف مختصر</label><textarea id="qmf_desc" class="form-control" rows="2"></textarea></div>
            </div>

            <div id="qmf_judicial_section">
              <div class="qmf-section-title"><i class="bi bi-diagram-3"></i> المرحلة الأولى</div>
              <div class="row g-3">
                <div class="col-md-4">
                  <label>نوع المرحلة</label>
                  <select id="qmf_stage_kind" class="form-select" onchange="QMF.onStageKindChange()">
                    ${Object.keys(STAGE_KINDS).map(k => `<option value="${k}" ${k === 'registration' ? 'selected' : ''}>${STAGE_KINDS[k].label}</option>`).join('')}
                  </select>
                </div>
                <div class="col-md-4"><label>المحكمة</label><input id="qmf_stage_court" class="form-control"></div>
                <div class="col-md-4"><label>الدائرة</label><input id="qmf_stage_circuit" class="form-control"></div>
                <div class="col-md-3"><label>رقم القضية</label><input id="qmf_stage_number" class="form-control"></div>
                <div class="col-md-3"><label>سنة القضية</label><input id="qmf_stage_year" class="form-control"></div>
                <div class="col-md-3"><label>المدينة</label><input id="qmf_stage_city" class="form-control"></div>
                <div class="col-md-3"><label>نوع القضية</label><input id="qmf_stage_type" class="form-control" placeholder="مدنية/جنائية..."></div>
                <div class="col-12"><label>موضوع القضية</label><textarea id="qmf_stage_subject" class="form-control" rows="2"></textarea></div>
              </div>
            </div>

            <div id="qmf_service_section" style="display:none;">
              <div class="qmf-section-title"><i class="bi bi-list-check"></i> الإجراء / الجهة</div>
              <div class="row g-3">
                <div class="col-md-6"><label>الجهة أو مكتب التوثيق</label><input id="qmf_authority_name" class="form-control"></div>
                <div class="col-md-3"><label>رقم الملف لدى الجهة</label><input id="qmf_authority_number" class="form-control"></div>
                <div class="col-md-3"><label>سنة الملف</label><input id="qmf_authority_year" class="form-control"></div>
                <div class="col-md-6"><label>موعد المتابعة القادم</label><input type="date" id="qmf_followup_date" class="form-control"></div>
                <div class="col-md-6"><label>الإجراء القادم</label><input id="qmf_followup_action" class="form-control"></div>
              </div>
            </div>

            <div class="qmf-section-title"><i class="bi bi-cash-coin"></i> الأتعاب المبدئية (اختياري)</div>
            <div class="row g-3">
              <div class="col-md-4"><label>إجمالي الأتعاب</label><input type="number" id="qmf_fee_total" class="form-control" min="0"></div>
              <div class="col-md-4"><label>المدفوع مقدمًا</label><input type="number" id="qmf_fee_paid" class="form-control" min="0"></div>
              <div class="col-md-4"><label>ملاحظات الأتعاب</label><input id="qmf_fee_notes" class="form-control"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">إلغاء</button>
            <button class="gold-btn" onclick="QMF.saveMainFile()"><i class="bi bi-check-lg"></i> حفظ الملف الرئيسي</button>
          </div>
        </div>
      </div>
    </div>

    <!-- تفاصيل الملف الرئيسي -->
    <div class="modal fade" id="qmfDetailsModal" tabindex="-1">
      <div class="modal-dialog modal-xl">
        <div class="modal-content bg-dark text-white">
          <div class="modal-header">
            <h5 class="modal-title gold-text" id="qmfDetailsTitle">تفاصيل الملف</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body" id="qmfDetailsBody"></div>
        </div>
      </div>
    </div>

    <!-- إضافة مرحلة -->
    <div class="modal fade" id="qmfStageModal" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content bg-dark text-white">
          <div class="modal-header">
            <h5 class="modal-title gold-text"><i class="bi bi-diagram-3"></i> إضافة مرحلة جديدة</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="row g-3">
              <div class="col-md-4">
                <label>نوع المرحلة</label>
                <select id="qmf_ns_kind" class="form-select" onchange="QMF.onNewStageKindChange()">
                  ${Object.keys(STAGE_KINDS).filter(k => k !== 'registration').map(k => `<option value="${k}">${STAGE_KINDS[k].label}</option>`).join('')}
                </select>
              </div>
              <div class="col-md-4"><label>المحكمة</label><input id="qmf_ns_court" class="form-control"></div>
              <div class="col-md-4"><label>الدائرة</label><input id="qmf_ns_circuit" class="form-control"></div>
              <div class="col-md-3"><label>رقم القضية</label><input id="qmf_ns_number" class="form-control"></div>
              <div class="col-md-3"><label>سنة القضية</label><input id="qmf_ns_year" class="form-control"></div>
              <div class="col-md-3"><label>المدينة</label><input id="qmf_ns_city" class="form-control"></div>
              <div class="col-md-3"><label>نوع القضية</label><input id="qmf_ns_type" class="form-control"></div>
              <div class="col-md-6"><label>صفة العميل في هذه المرحلة</label><input id="qmf_ns_client_role" class="form-control"></div>
              <div class="col-md-6"><label>صفة الخصم في هذه المرحلة</label><input id="qmf_ns_opp_role" class="form-control"></div>
              <div class="col-12">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="qmf_ns_swap" onchange="QMF.onSwapToggle()">
                  <label class="form-check-label" for="qmf_ns_swap">تبديل صفة العميل والخصم (يحدث في الاستئناف/الطعن)</label>
                </div>
              </div>
              <div class="col-12"><label>موضوع المرحلة</label><textarea id="qmf_ns_subject" class="form-control" rows="2"></textarea></div>
            </div>
            <div class="qmf-section-title"><i class="bi bi-cash-coin"></i> أتعاب هذه المرحلة (اختياري)</div>
            <div class="row g-3">
              <div class="col-md-4"><label>إجمالي الأتعاب</label><input type="number" id="qmf_ns_fee_total" class="form-control" min="0"></div>
              <div class="col-md-4"><label>المدفوع</label><input type="number" id="qmf_ns_fee_paid" class="form-control" min="0"></div>
              <div class="col-md-4"><label>ملاحظات</label><input id="qmf_ns_fee_notes" class="form-control"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">إلغاء</button>
            <button class="gold-btn" onclick="QMF.saveStage()"><i class="bi bi-check-lg"></i> حفظ المرحلة</button>
          </div>
        </div>
      </div>
    </div>
    `;
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);

    // زر الدخول في تبويب القضايا
    const grid = document.querySelector('.quick-actions-grid');
    if (grid && !document.getElementById('qmfOpenBtn')) {
      const btn = document.createElement('button');
      btn.id = 'qmfOpenBtn';
      btn.className = 'btn btn-outline-warning quick-action';
      btn.innerHTML = '<i class="bi bi-folder2-open"></i> الملفات الرئيسية';
      btn.onclick = () => window.QMF.openPanel();
      grid.insertBefore(btn, grid.firstChild);
    }
  }

  /* ============================================================
   * 7) قائمة الملفات الرئيسية + البحث ببادئة ثابتة
   * ============================================================ */
  async function loadStagesForFile(fileId) {
    const { db } = G();
    let stages = [];
    try { stages = await db.cases.filter(c => c.legal_file_id === fileId).toArray(); } catch (e) { stages = []; }
    if (stages.length) return stages;
    try {
      const proceedings = await db.proceedings.filter(p => p.legal_file_id === fileId).toArray();
      return proceedings.map(p => ({
        id: p.id,
        legal_file_id: p.legal_file_id,
        stage_kind: p.metadata?.stage_kind || p.proceeding_type || 'first_instance',
        proceeding_type: p.proceeding_type,
        stage_order: Number(p.metadata?.stage_order ?? 0),
        case_number: p.case_number,
        case_year: p.case_year,
        court_name: p.court_name,
        circuit: p.circuit,
        city: p.city,
        client_role: p.client_position,
        opponent_role: p.opponent_position,
        opponent_name: p.opponent_name,
        status: p.status,
        created_at: p.created_at,
        updated_at: p.updated_at,
        source_proceeding_only: true
      }));
    } catch (e) { return []; }
  }
  async function renderList(query) {
    const { db, esc, officeId } = G();
    const host = document.getElementById('qmfFilesList');
    if (!host) return;
    let files = [];
    try { files = await db.legalFiles.toArray(); } catch (e) { files = []; }
    files = files.filter(f => !officeId || !f.office_id || f.office_id === officeId);
    const q = normCode(query);
    if (q) files = files.filter(f => normCode(f.file_code).includes(q) || normCode(f.client_name).includes(q) || normCode(f.title).includes(q));
    files.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));

    if (!files.length) {
      host.innerHTML = '<div class="qmf-empty"><i class="bi bi-inbox fs-1"></i><p class="mt-2">لا توجد ملفات رئيسية مطابقة. ابدأ بإنشاء ملف جديد.</p></div>';
      return;
    }

    const cards = [];
    for (const f of files) {
      let stages = [];
      stages = await loadStagesForFile(f.id);
      const cat = f.file_category || categoryOf(f.file_type);
      const current = stages.slice().sort((a, b) => (STAGE_KINDS[b.stage_kind] ? STAGE_KINDS[b.stage_kind].order : 0) - (STAGE_KINDS[a.stage_kind] ? STAGE_KINDS[a.stage_kind].order : 0))[0];
      cards.push(`
        <div class="qmf-card" onclick="QMF.openDetails('${f.id}')">
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span class="qmf-code">${esc(f.file_code || '')}</span>
            <span class="qmf-badge ${cat}">${esc(CATEGORY_LABELS[cat] || '')} · ${esc(fileTypeLabel(f.file_type))}</span>
          </div>
          <div class="qmf-title mt-2">${esc(f.title || '')}</div>
          <div class="qmf-meta">
            <i class="bi bi-person"></i> ${esc(f.client_name || '-')}
            · <i class="bi bi-diagram-3"></i> ${stages.length} مرحلة
            ${current ? `· المرحلة الحالية: <b>${esc(stageLabel(current.stage_kind))}</b>` : ''}
          </div>
        </div>`);
    }
    host.innerHTML = cards.join('');
  }

  /* ============================================================
   * 8) إنشاء ملف رئيسي
   * ============================================================ */
  let _editingMainFileId = null;
  function openCreateModal() {
    const { ownerOnly } = G();
    if (typeof ownerOnly === 'function' && !ownerOnly('إنشاء ملف رئيسي')) return;
    _editingMainFileId = null;
    ['qmf_title', 'qmf_client_name', 'qmf_client_phone', 'qmf_client_role', 'qmf_client_nid', 'qmf_client_addr',
      'qmf_opp_name', 'qmf_opp_role', 'qmf_opp_phone', 'qmf_desc', 'qmf_stage_court', 'qmf_stage_circuit',
      'qmf_stage_number', 'qmf_stage_year', 'qmf_stage_city', 'qmf_stage_type', 'qmf_stage_subject',
      'qmf_authority_name', 'qmf_authority_number', 'qmf_authority_year', 'qmf_followup_date', 'qmf_followup_action',
      'qmf_fee_total', 'qmf_fee_paid', 'qmf_fee_notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const t = document.getElementById('qmf_file_type'); if (t) t.value = 'judicial';
    const sk = document.getElementById('qmf_stage_kind'); if (sk) sk.value = 'registration';
    const ft = document.querySelector('#qmfCreateModal .modal-title'); if (ft) ft.innerHTML = '<i class="bi bi-folder-plus"></i> إنشاء ملف رئيسي';
    onTypeChange();
    const { showModal } = G();
    if (typeof showModal === 'function') showModal('qmfCreateModal');
  }

  // تعديل بيانات الملف الرئيسي (العنوان/العميل/الخصم/النوع/الوصف) دون المساس بالمراحل.
  async function editMainFile(legalFileId) {
    const { db, showModal, hideModal } = G();
    const file = await db.legalFiles.get(legalFileId);
    if (!file) return;
    _editingMainFileId = legalFileId;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
    set('qmf_file_type', file.file_type || 'judicial');
    set('qmf_title', file.title || '');
    set('qmf_client_name', file.client_name || '');
    set('qmf_client_phone', file.client_phone || '');
    set('qmf_client_role', file.client_role || '');
    set('qmf_client_nid', file.client_national_id || '');
    set('qmf_client_addr', file.client_address || '');
    set('qmf_opp_name', file.opponent_name || '');
    set('qmf_opp_role', file.opponent_role || '');
    set('qmf_opp_phone', file.opponent_phone || '');
    set('qmf_desc', file.description || '');
    // إخفاء أقسام المرحلة والأتعاب عند تعديل بيانات الملف فقط.
    const js = document.getElementById('qmf_judicial_section'); if (js) js.style.display = 'none';
    const ss = document.getElementById('qmf_service_section'); if (ss) ss.style.display = 'none';
    const ft = document.querySelector('#qmfCreateModal .modal-title'); if (ft) ft.innerHTML = '<i class="bi bi-pencil"></i> تعديل الملف الرئيسي';
    if (typeof hideModal === 'function') hideModal('qmfDetailsModal');
    if (typeof showModal === 'function') showModal('qmfCreateModal');
  }

  // أرشفة الملف الرئيسي.
  async function archiveMainFile(legalFileId) {
    const { db, Swal, hideModal } = G();
    const file = await db.legalFiles.get(legalFileId);
    if (!file) return;
    if (Swal) {
      const res = await Swal.fire({ title: 'أرشفة الملف؟', text: file.title || file.file_code, icon: 'warning', showCancelButton: true, confirmButtonText: 'أرشفة', cancelButtonText: 'إلغاء', background: '#0f172a', color: '#fff' });
      if (!res.isConfirmed) return;
    }
    const now = nowIso();
    await db.legalFiles.update(legalFileId, { status: 'archived', archived: 1, updated_at: now });
    await db.pendingOperations.add({ operation: 'upsert_legal_file', data: { ...file, status: 'archived', archived: 1, updated_at: now }, timestamp: Date.now() });
    if (typeof hideModal === 'function') hideModal('qmfDetailsModal');
    if (Swal) Swal.fire({ icon: 'success', title: 'تمت الأرشفة', timer: 1500, showConfirmButton: false, background: '#0f172a', color: '#fff' });
    await renderList('');
    if (typeof window.loadCasesList === 'function') { try { await window.loadCasesList(); } catch (e) {} }
  }

  // حذف الملف الرئيسي وكل مراحله وجلساته نهائيًا.
  async function deleteMainFile(legalFileId) {
    const { db, Swal, hideModal, esc } = G();
    const file = await db.legalFiles.get(legalFileId);
    if (!file) return;
    if (Swal) {
      const res = await Swal.fire({ title: 'حذف الملف نهائيًا؟', html: `سيتم حذف الملف <b>${esc(file.file_code)}</b> وكل مراحله وجلساته من الجهاز.`, icon: 'warning', showCancelButton: true, confirmButtonText: 'حذف نهائي', cancelButtonText: 'إلغاء', confirmButtonColor: '#b43b45', background: '#0f172a', color: '#fff' });
      if (!res.isConfirmed) return;
    }
    try {
      const stages = await db.cases.filter(c => c.legal_file_id === legalFileId).toArray();
      for (const s of stages) {
        await db.sessions.where('case_id').equals(s.id).delete();
        await db.fees.delete(s.id);
        await db.payments.where('case_id').equals(s.id).delete();
        await db.expenses.where('case_id').equals(s.id).delete();
        await db.cases.delete(s.id);
      }
    } catch (e) { console.warn('[QMF] delete stages', e); }
    try { const rows = await db.proceedings.filter(p => p.legal_file_id === legalFileId).toArray(); for (const r of rows) await db.proceedings.delete(r.id); } catch (e) {}
    try { const rows = await db.serviceActions.filter(a => a.legal_file_id === legalFileId).toArray(); for (const r of rows) await db.serviceActions.delete(r.id); } catch (e) {}
    await db.fees.delete(legalFileId);
    await db.payments.where('case_id').equals(legalFileId).delete();
    await db.expenses.where('case_id').equals(legalFileId).delete();
    await db.legalFiles.delete(legalFileId);
    await db.pendingOperations.add({ operation: 'delete_legal_file', data: { id: legalFileId }, timestamp: Date.now() });
    if (typeof hideModal === 'function') hideModal('qmfDetailsModal');
    if (Swal) Swal.fire({ icon: 'success', title: 'تم الحذف', timer: 1500, showConfirmButton: false, background: '#0f172a', color: '#fff' });
    await renderList('');
    if (typeof window.loadCasesList === 'function') { try { await window.loadCasesList(); } catch (e) {} }
  }

  // إضافة جلسة للملف الرئيسي: تفتح نموذج الجلسات مع اختيار المرحلة الحالية تلقائيًا.
  async function addSessionForFile(legalFileId) {
    const { Swal, hideModal } = G();
    let stages = await loadStagesForFile(legalFileId);
    if (!stages.length) { if (Swal) Swal.fire('تنبيه', 'أضف مرحلة أولاً قبل تسجيل جلسة.', 'info'); return; }
    stages.sort((a, b) => (STAGE_KINDS[b.stage_kind] ? STAGE_KINDS[b.stage_kind].order : 0) - (STAGE_KINDS[a.stage_kind] ? STAGE_KINDS[a.stage_kind].order : 0));
    const current = stages[0];
    if (typeof hideModal === 'function') hideModal('qmfDetailsModal');
    setTimeout(() => {
      if (typeof window.openSessionsModal === 'function') window.openSessionsModal();
      setTimeout(() => {
        if (typeof window.selectCaseForSession === 'function') window.selectCaseForSession(current.id);
        const d = document.getElementById('s_date'); if (d) d.focus();
      }, 300);
    }, 250);
  }

  // ترحيل جلسة من جلسات الملف الرئيسي.
  async function rescheduleFileSession(legalFileId) {
    const { db, Swal, hideModal } = G();
    let stages = await loadStagesForFile(legalFileId);
    let sessions = [];
    for (const s of stages) { try { const rows = await db.sessions.where('case_id').equals(s.id).toArray(); sessions.push(...rows); } catch (e) {} }
    sessions = sessions.filter(s => s.session_date).sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));
    if (!sessions.length) { if (Swal) Swal.fire('تنبيه', 'لا توجد جلسات مسجلة لهذا الملف لترحيلها. استخدم «إضافة جلسة» أولاً.', 'info'); return; }
    if (Swal) {
      const options = {};
      sessions.forEach(s => { options[s.id] = `${String(s.session_date).replace('T', ' ')} — ${s.case_status || ''}`; });
      const res = await Swal.fire({ title: 'اختر الجلسة المراد ترحيلها', input: 'select', inputOptions: options, showCancelButton: true, confirmButtonText: 'ترحيل', cancelButtonText: 'إلغاء', background: '#0f172a', color: '#fff' });
      if (!res.isConfirmed || !res.value) return;
      if (typeof hideModal === 'function') hideModal('qmfDetailsModal');
      setTimeout(() => { if (typeof window.openRescheduleModal === 'function') window.openRescheduleModal(res.value); }, 250);
    }
  }

  function onTypeChange() {
    const t = document.getElementById('qmf_file_type');
    const judicial = t && isJudicialType(t.value);
    const js = document.getElementById('qmf_judicial_section');
    const ss = document.getElementById('qmf_service_section');
    if (js) js.style.display = judicial ? '' : 'none';
    if (ss) ss.style.display = judicial ? 'none' : '';
  }

  function onStageKindChange() {
    const kind = document.getElementById('qmf_stage_kind')?.value;
    const def = STAGE_KINDS[kind] || {};
    const numEl = document.getElementById('qmf_stage_number');
    const yearEl = document.getElementById('qmf_stage_year');
    const courtEl = document.getElementById('qmf_stage_court');
    const req = def.hasNumber;
    if (numEl) { numEl.disabled = !req; numEl.placeholder = req ? '' : 'لا يوجد رقم في مرحلة القيد'; }
    if (yearEl) yearEl.disabled = !req;
    if (courtEl) courtEl.disabled = !req;
  }

  async function saveMainFile() {
    const { db, Swal, genUUID, officeId, ipc, hideModal } = G();
    try {
      const fileType = document.getElementById('qmf_file_type').value;
      const title = document.getElementById('qmf_title').value.trim();
      const clientName = document.getElementById('qmf_client_name').value.trim();
      if (!title || !clientName) throw new Error('أدخل عنوان الملف واسم العميل');

      // وضع التعديل: تحديث بيانات الملف الرئيسي القائم دون إنشاء ملف جديد.
      if (_editingMainFileId) {
        const existing = await db.legalFiles.get(_editingMainFileId);
        if (existing) {
          const nowEdit = nowIso();
          const updates = {
            file_type: fileType, file_category: categoryOf(fileType), title,
            client_name: clientName,
            client_phone: document.getElementById('qmf_client_phone').value.trim(),
            client_role: document.getElementById('qmf_client_role').value.trim(),
            client_national_id: document.getElementById('qmf_client_nid').value.trim(),
            client_address: document.getElementById('qmf_client_addr').value.trim(),
            opponent_name: document.getElementById('qmf_opp_name').value.trim(),
            opponent_role: document.getElementById('qmf_opp_role').value.trim(),
            opponent_phone: document.getElementById('qmf_opp_phone').value.trim(),
            description: document.getElementById('qmf_desc').value.trim(),
            updated_at: nowEdit
          };
          await db.legalFiles.update(existing.id, updates);
          await db.pendingOperations.add({ operation: 'upsert_legal_file', data: { ...existing, ...updates }, timestamp: Date.now() });
          // مزامنة اسم العميل/الخصم مع المراحل المرتبطة.
          try {
            const stages = await db.cases.filter(c => c.legal_file_id === existing.id).toArray();
            for (const s of stages) await db.cases.update(s.id, { client_name: clientName, opponent_name: updates.opponent_name, updated_at: nowEdit });
          } catch (e) {}
          _editingMainFileId = null;
          if (typeof hideModal === 'function') hideModal('qmfCreateModal');
          if (Swal) Swal.fire({ icon: 'success', title: 'تم حفظ التعديلات', timer: 1600, showConfirmButton: false, background: '#0f172a', color: '#fff' });
          await renderList('');
          if (typeof window.loadCasesList === 'function') { try { await window.loadCasesList(); } catch (e) {} }
          setTimeout(() => openDetails(existing.id), 250);
          return;
        }
        _editingMainFileId = null;
      }

      const category = categoryOf(fileType);
      const code = assertValidMainFileCode(await generateMainFileCode());
      const now = nowIso();
      const mainFile = {
        id: uid('LF'),
        office_id: officeId,
        file_code: code,
        file_type: fileType,
        file_category: category,
        title,
        status: 'new',
        client_name: clientName,
        client_phone: document.getElementById('qmf_client_phone').value.trim(),
        client_role: document.getElementById('qmf_client_role').value.trim(),
        client_national_id: document.getElementById('qmf_client_nid').value.trim(),
        client_address: document.getElementById('qmf_client_addr').value.trim(),
        opponent_name: document.getElementById('qmf_opp_name').value.trim(),
        opponent_role: document.getElementById('qmf_opp_role').value.trim(),
        opponent_phone: document.getElementById('qmf_opp_phone').value.trim(),
        description: document.getElementById('qmf_desc').value.trim(),
        opened_at: now.slice(0, 10),
        metadata: { source: 'main_file', category },
        stages: [], // تُملأ بأسماء المراحل لإنشاء مجلد فرعي لكل مرحلة
        created_at: now,
        updated_at: now
      };

      await db.legalFiles.put(mainFile);
      await db.pendingOperations.add({ operation: 'upsert_legal_file', data: mainFile, timestamp: Date.now() });

      // المرحلة الأولى
      if (category === 'judicial') {
        const kind = document.getElementById('qmf_stage_kind').value;
        const def = STAGE_KINDS[kind] || STAGE_KINDS.first_instance;
        const stage = {
          id: uid('C'),
          office_id: officeId,
          legal_file_id: mainFile.id,
          main_file_code: code,
          root_case_id: null,
          parent_case_id: null,
          appeal_of_case_id: null,
          proceeding_type: def.dbType,
          stage_kind: kind,
          stage_order: def.order,
          case_number: def.hasNumber ? document.getElementById('qmf_stage_number').value.trim() : '',
          case_year: def.hasNumber ? document.getElementById('qmf_stage_year').value.trim() : '',
          court_name: def.hasNumber ? document.getElementById('qmf_stage_court').value.trim() : '',
          circuit: document.getElementById('qmf_stage_circuit').value.trim(),
          city: document.getElementById('qmf_stage_city').value.trim(),
          case_type: document.getElementById('qmf_stage_type').value.trim(),
          case_subject: document.getElementById('qmf_stage_subject').value.trim() || title,
          client_name: clientName,
          client_role: mainFile.client_role,
          opponent_name: mainFile.opponent_name,
          opponent_role: mainFile.opponent_role,
          status: 'جديدة',
          judgment_summary: null,
          judgment_date: null,
          case_code: code, // المجلد الرئيسي يعتمد كود MJ
          archived: 0,
          created_at: now,
          updated_at: now
        };
        stage.root_case_id = stage.id;
        mainFile.stages.push({ label: stageLabel(kind), kind, order: def.order });
        await db.cases.add(stage);
        await db.pendingOperations.add({ operation: 'insert_case', data: stage, timestamp: Date.now() });
        await db.proceedings.put({
          id: uid('PR'), legal_file_id: mainFile.id, office_id: officeId,
          proceeding_type: def.dbType, parent_proceeding_id: null, appeal_of_proceeding_id: null,
          court_name: stage.court_name, circuit: stage.circuit || null,
          case_number: stage.case_number, case_year: stage.case_year, city: stage.city || null,
          client_position: stage.client_role, opponent_name: stage.opponent_name, opponent_position: stage.opponent_role,
          status: 'open', metadata: { stage_kind: kind }, created_at: now, updated_at: now
        });
        await db.pendingOperations.add({ operation: 'upsert_proceeding', data: { id: stage.id, legal_file_id: mainFile.id, office_id: officeId, proceeding_type: def.dbType, case_number: stage.case_number, case_year: stage.case_year, court_name: stage.court_name, created_at: now, updated_at: now }, timestamp: Date.now() });

        // الأتعاب الأولية للمرحلة
        const total = parseFloat(document.getElementById('qmf_fee_total').value) || 0;
        const paid = parseFloat(document.getElementById('qmf_fee_paid').value) || 0;
        if (total > 0 || paid > 0) {
          await db.fees.put({ case_id: stage.id, legal_file_id: mainFile.id, stage_id: stage.id, scope: 'stage', total, paid, remaining: Math.max(0, total - paid), notes: document.getElementById('qmf_fee_notes').value.trim() });
          if (paid > 0) await db.payments.add({ case_id: stage.id, amount: paid, date: now.slice(0, 10), note: 'دفعة مقدمة' });
        }
      } else {
        // ملف خدمي/عام: إجراء خدمة + موعد متابعة
        const action = {
          id: uid('SA'), legal_file_id: mainFile.id, office_id: officeId,
          action_type: fileType, sequence_order: 1, step_status: 'open',
          title: 'فتح الملف',
          authority_name: document.getElementById('qmf_authority_name').value.trim(),
          authority_file_number: document.getElementById('qmf_authority_number').value.trim(),
          authority_file_year: document.getElementById('qmf_authority_year').value.trim(),
          next_followup_at: document.getElementById('qmf_followup_date').value || null,
          next_action: document.getElementById('qmf_followup_action').value.trim(),
          status: 'open', created_at: now, updated_at: now
        };
        await db.serviceActions.put(action);
        mainFile.stages.push({ label: 'إجراءات الملف', kind: 'service', order: 0 });
        await db.pendingOperations.add({ operation: 'upsert_service_action', data: action, timestamp: Date.now() });

        const total = parseFloat(document.getElementById('qmf_fee_total').value) || 0;
        const paid = parseFloat(document.getElementById('qmf_fee_paid').value) || 0;
        if (total > 0 || paid > 0) {
          await db.fees.put({ case_id: mainFile.id, legal_file_id: mainFile.id, stage_id: null, scope: 'file', total, paid, remaining: Math.max(0, total - paid), notes: document.getElementById('qmf_fee_notes').value.trim() });
          if (paid > 0) await db.payments.add({ case_id: mainFile.id, amount: paid, date: now.slice(0, 10), note: 'دفعة مقدمة' });
        }
      }

      // المزامنة مع Supabase (أفضل جهد)
      try {
        if (window.supabaseClient && officeId) {
          await window.supabaseClient.from('legal_files').upsert([mainFile], { onConflict: 'id' });
        }
      } catch (e) { console.warn('[QMF] تعذّر رفع الملف الرئيسي:', e?.message || e); }

      // إنشاء المجلد المحلي
      if (ipc && ipc.createMainFileFolder) {
        try { await ipc.createMainFileFolder(code, clientName, mainFile); } catch (e) { console.warn('[QMF] تعذّر إنشاء المجلد:', e); }
      }

      if (typeof hideModal === 'function') hideModal('qmfCreateModal');
      if (typeof Swal !== 'undefined') {
        Swal.fire({ icon: 'success', title: 'تم إنشاء الملف الرئيسي', html: `<div style="text-align:right;"><p><strong>الرقم الإداري:</strong> ${code}</p><p><strong>النوع:</strong> ${fileTypeLabel(fileType)}</p></div>`, timer: 3200, showConfirmButton: false, background: '#0f172a', color: '#fff' });
      }
      await renderList('');
      if (typeof window.loadCasesList === 'function') { try { await window.loadCasesList(); } catch (e) {} }
      if (typeof window.updatePendingBadge === 'function') window.updatePendingBadge();
      setTimeout(() => openDetails(mainFile.id), 500);
    } catch (err) {
      console.error('[QMF] فشل إنشاء الملف الرئيسي:', err);
      const { Swal } = G();
      if (Swal) Swal.fire('خطأ', err.message || 'تعذّر إنشاء الملف الرئيسي', 'error');
    }
  }

  /* ============================================================
   * 9) تفاصيل الملف الرئيسي (الأحدث في الأعلى)
   * ============================================================ */
  async function openDetails(legalFileId) {
    const { db, esc, showModal } = G();
    const file = await db.legalFiles.get(legalFileId);
    if (!file) { const { Swal } = G(); if (Swal) Swal.fire('خطأ', 'الملف الرئيسي غير موجود', 'error'); return; }

    let stages = [];
    stages = await loadStagesForFile(file.id);
    stages.sort((a, b) => {
      const oa = STAGE_KINDS[a.stage_kind] ? STAGE_KINDS[a.stage_kind].order : 0;
      const ob = STAGE_KINDS[b.stage_kind] ? STAGE_KINDS[b.stage_kind].order : 0;
      if (ob !== oa) return ob - oa; // الأحدث في الأعلى
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

    const cat = file.file_category || categoryOf(file.file_type);
    let serviceActions = [];
    try { serviceActions = await db.serviceActions.filter(s => s.legal_file_id === file.id).toArray(); } catch (e) { serviceActions = []; }

    // ملخص الأتعاب لكل الملف
    const agg = await aggregateFees(file, stages);

    let stagesHtml = '';
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      const isCurrent = i === 0;
      const sessions = await db.sessions.where('case_id').equals(s.id).toArray().catch(() => []);
      const fee = await db.fees.get(s.id).catch(() => null) || { total: 0, paid: 0, remaining: 0 };
      const stagePayments = await db.payments.where('case_id').equals(s.id).toArray().catch(() => []);
      fee.paid = stagePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      fee.remaining = Math.max(0, Number(fee.total || 0) - fee.paid);
      stagesHtml += `
        <div class="qmf-stage ${isCurrent ? 'current' : ''}">
          <div class="qmf-stage-head">
            <h5>${isCurrent ? '📍 ' : ''}${esc(stageLabel(s.stage_kind))}</h5>
            <span class="qmf-badge ${isCurrent ? 'professional' : 'general'}">${isCurrent ? 'المرحلة الحالية' : 'مرحلة سابقة'}</span>
          </div>
          <div class="qmf-stage-grid">
            <div><b>رقم القضية:</b> ${esc(s.case_number || '—')}${s.case_year ? '/' + esc(s.case_year) : ''}</div>
            <div><b>المحكمة:</b> ${esc(s.court_name || '—')}</div>
            <div><b>الدائرة:</b> ${esc(s.circuit || '—')}</div>
            <div><b>المدينة:</b> ${esc(s.city || '—')}</div>
            <div><b>صفة العميل:</b> ${esc(s.client_role || '—')}</div>
            <div><b>صفة الخصم:</b> ${esc(s.opponent_role || '—')}</div>
            <div><b>الحالة:</b> ${esc(s.status || '—')}</div>
            <div><b>الجلسات:</b> ${sessions.length}</div>
            <div><b>الأتعاب:</b> ${Number(fee.total || 0).toFixed(0)} (مدفوع ${Number(fee.paid || 0).toFixed(0)})</div>
          </div>
          ${s.judgment_summary ? `<div class="qmf-judgment"><b>منطوق الحكم:</b> ${esc(s.judgment_summary)}${s.judgment_date ? ' — ' + esc(s.judgment_date) : ''}</div>` : ''}
          <div class="qmf-actions">
            <button class="btn btn-sm btn-outline-info" onclick="QMF.openStage('${s.id}')"><i class="bi bi-box-arrow-up-left"></i> فتح المرحلة</button>
            <button class="btn btn-sm btn-success" onclick="QMF.openStageFees('${s.id}','${file.id}')"><i class="bi bi-cash-coin"></i> أتعاب المرحلة</button>
            <button class="btn btn-sm btn-outline-warning" onclick="QMF.printFees('${file.id}','${s.id}')"><i class="bi bi-printer"></i> طباعة أتعاب المرحلة</button>
            <button class="btn btn-sm btn-outline-primary" onclick="QMF.printData('${file.id}','${s.id}')"><i class="bi bi-file-earmark-text"></i> طباعة بيانات المرحلة</button>
          </div>
        </div>`;
    }

    const serviceHtml = serviceActions.length ? `
      <div class="qmf-section-title"><i class="bi bi-list-check"></i> الإجراءات والمواعيد</div>
      ${serviceActions.map(a => `<div class="qmf-stage"><div class="qmf-stage-grid">
        <div><b>الجهة:</b> ${esc(a.authority_name || '—')}</div>
        <div><b>رقم الملف:</b> ${esc(a.authority_file_number || '—')}${a.authority_file_year ? '/' + esc(a.authority_file_year) : ''}</div>
        <div><b>موعد المتابعة:</b> ${esc(a.next_followup_at || '—')}</div>
        <div><b>الإجراء القادم:</b> ${esc(a.next_action || '—')}</div>
      </div></div>`).join('')}` : '';

    const body = `
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div>
          <div class="qmf-code" style="font-size:1.3rem;color:#f0c14b;font-weight:900;">${esc(file.file_code)}</div>
          <div class="mt-1"><span class="qmf-badge ${cat}">${esc(CATEGORY_LABELS[cat] || '')} · ${esc(fileTypeLabel(file.file_type))}</span>
          <span class="badge bg-secondary ms-1">${esc(STATUS_LABELS[file.status] || file.status || '')}</span></div>
        </div>
        <div class="qmf-actions">
          ${cat === 'judicial' ? `<button class="btn btn-sm gold-btn" onclick="QMF.openAddStage('${file.id}')"><i class="bi bi-plus-lg"></i> إضافة مرحلة</button>` : `<button class="btn btn-sm gold-btn" onclick="QMF.convertToJudicial('${file.id}')"><i class="bi bi-arrow-repeat"></i> تحويل إلى ملف قضائي</button>`}
          <button class="btn btn-sm btn-outline-success" onclick="QMF.addSessionForFile('${file.id}')"><i class="bi bi-calendar-plus"></i> إضافة جلسة</button>
          <button class="btn btn-sm btn-outline-warning" onclick="QMF.rescheduleFileSession('${file.id}')"><i class="bi bi-calendar-event"></i> ترحيل جلسة</button>
          <button class="btn btn-sm btn-success" onclick="QMF.openFileFees('${file.id}')"><i class="bi bi-cash-stack"></i> إدارة أتعاب الملف</button>
          <button class="btn btn-sm btn-outline-success" onclick="QMF.printFees('${file.id}')"><i class="bi bi-printer"></i> طباعة أتعاب الملف كله</button>
          <button class="btn btn-sm btn-outline-primary" onclick="QMF.printData('${file.id}')"><i class="bi bi-file-earmark-text"></i> طباعة بيانات الملف كله</button>
          <button class="btn btn-sm btn-outline-warning" onclick="QMF.editMainFile('${file.id}')"><i class="bi bi-pencil"></i> تعديل</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="QMF.archiveMainFile('${file.id}')"><i class="bi bi-archive"></i> أرشفة</button>
          <button class="btn btn-sm btn-outline-danger" onclick="QMF.deleteMainFile('${file.id}')"><i class="bi bi-trash"></i> حذف</button>
        </div>
      </div>

      <div class="row g-2 mb-2">
        <div class="col-md-6"><div class="record-row"><b>العنوان:</b> ${esc(file.title || '—')}</div></div>
        <div class="col-md-6"><div class="record-row"><b>العميل:</b> ${esc(file.client_name || '—')} ${file.client_role ? '· ' + esc(file.client_role) : ''}</div></div>
        <div class="col-md-6"><div class="record-row"><b>الخصم:</b> ${esc(file.opponent_name || '—')} ${file.opponent_role ? '· ' + esc(file.opponent_role) : ''}</div></div>
        <div class="col-md-6"><div class="record-row"><b>الهاتف:</b> ${esc(file.client_phone || '—')}</div></div>
      </div>

      <div class="qmf-fee-summary">
        <div class="box"><div class="v text-info">${agg.total.toFixed(0)}</div><div class="k">إجمالي الأتعاب</div></div>
        <div class="box"><div class="v text-success">${agg.paid.toFixed(0)}</div><div class="k">المدفوع</div></div>
        <div class="box"><div class="v text-danger">${agg.remaining.toFixed(0)}</div><div class="k">المتبقي</div></div>
      </div>

      <div class="qmf-section-title"><i class="bi bi-diagram-3"></i> المراحل (${stages.length})</div>
      ${stagesHtml || '<div class="qmf-empty">لا توجد مراحل بعد.</div>'}
      ${serviceHtml}
    `;

    document.getElementById('qmfDetailsTitle').innerHTML = `<i class="bi bi-folder2-open"></i> ${esc(file.title || 'ملف رئيسي')}`;
    document.getElementById('qmfDetailsBody').innerHTML = body;
    if (typeof showModal === 'function') showModal('qmfDetailsModal');
  }

  async function aggregateFees(file, stages) {
    const { db } = G();
    let total = 0, paid = 0;
    const ids = [file.id, ...stages.map(s => s.id)].filter((id, index, all) => id && all.indexOf(id) === index);
    for (const id of ids) {
      const fee = await db.fees.get(id).catch(() => null);
      if (fee) total += Number(fee.total || 0);
      const payments = await db.payments.where('case_id').equals(id).toArray().catch(() => []);
      paid += payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    }
    return { total, paid, remaining: total - paid };
  }

  /* ============================================================
   * 10) إضافة مرحلة جديدة
   * ============================================================ */
  let _stageParentFile = null;
  async function openAddStage(legalFileId) {
    const { db, showModal } = G();
    _stageParentFile = await db.legalFiles.get(legalFileId);
    if (!_stageParentFile) return;
    // أحدث مرحلة للتوريث
    let stages = await loadStagesForFile(legalFileId);
    stages.sort((a, b) => (STAGE_KINDS[b.stage_kind] ? STAGE_KINDS[b.stage_kind].order : 0) - (STAGE_KINDS[a.stage_kind] ? STAGE_KINDS[a.stage_kind].order : 0));
    const prev = stages[0] || null;
    _stageParentFile._prevStage = prev;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
    set('qmf_ns_kind', 'appeal');
    set('qmf_ns_court', prev ? (prev.court_name || '') : '');
    set('qmf_ns_circuit', prev ? (prev.circuit || '') : '');
    set('qmf_ns_number', '');
    set('qmf_ns_year', String(new Date().getFullYear()));
    set('qmf_ns_city', prev ? (prev.city || '') : '');
    set('qmf_ns_type', prev ? (prev.case_type || '') : '');
    set('qmf_ns_client_role', prev ? (prev.client_role || '') : (_stageParentFile.client_role || ''));
    set('qmf_ns_opp_role', prev ? (prev.opponent_role || '') : (_stageParentFile.opponent_role || ''));
    set('qmf_ns_subject', prev ? (prev.case_subject || '') : (_stageParentFile.title || ''));
    set('qmf_ns_fee_total', ''); set('qmf_ns_fee_paid', ''); set('qmf_ns_fee_notes', '');
    const swap = document.getElementById('qmf_ns_swap'); if (swap) swap.checked = false;
    if (typeof showModal === 'function') showModal('qmfStageModal');
  }

  function onNewStageKindChange() {
    const kind = document.getElementById('qmf_ns_kind')?.value;
    const def = STAGE_KINDS[kind] || {};
    const numEl = document.getElementById('qmf_ns_number');
    const yearEl = document.getElementById('qmf_ns_year');
    if (def.reuseNumber && _stageParentFile && _stageParentFile._prevStage) {
      const p = _stageParentFile._prevStage;
      if (numEl) numEl.value = p.case_number || '';
      if (yearEl) yearEl.value = p.case_year || '';
      if (numEl) numEl.readOnly = true;
      const { Swal } = G();
      if (Swal) Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'التماس إعادة النظر يعيد استخدام رقم المرحلة السابقة', showConfirmButton: false, timer: 2600, background: '#0f172a', color: '#fff' });
    } else {
      if (numEl) numEl.readOnly = false;
    }
  }

  function onSwapToggle() {
    const swap = document.getElementById('qmf_ns_swap');
    const c = document.getElementById('qmf_ns_client_role');
    const o = document.getElementById('qmf_ns_opp_role');
    if (!c || !o) return;
    const tmp = c.value; c.value = o.value; o.value = tmp;
  }

  async function saveStage() {
    const { db, Swal, officeId, hideModal } = G();
    try {
      const file = _stageParentFile;
      if (!file) throw new Error('لم يتم تحديد الملف الرئيسي');
      const kind = document.getElementById('qmf_ns_kind').value;
      const def = STAGE_KINDS[kind] || STAGE_KINDS.appeal;
      const now = nowIso();
      const prev = file._prevStage || null;

      const stage = {
        id: uid('C'),
        office_id: officeId,
        legal_file_id: file.id,
        main_file_code: file.file_code,
        root_case_id: prev ? (prev.root_case_id || prev.id) : null,
        parent_case_id: prev ? prev.id : null,
        appeal_of_case_id: prev ? prev.id : null,
        proceeding_type: def.dbType,
        stage_kind: kind,
        stage_order: def.order,
        case_number: document.getElementById('qmf_ns_number').value.trim(),
        case_year: document.getElementById('qmf_ns_year').value.trim(),
        court_name: document.getElementById('qmf_ns_court').value.trim(),
        circuit: document.getElementById('qmf_ns_circuit').value.trim(),
        city: document.getElementById('qmf_ns_city').value.trim(),
        case_type: document.getElementById('qmf_ns_type').value.trim(),
        case_subject: document.getElementById('qmf_ns_subject').value.trim() || file.title,
        client_name: file.client_name,
        client_role: document.getElementById('qmf_ns_client_role').value.trim(),
        opponent_name: file.opponent_name,
        opponent_role: document.getElementById('qmf_ns_opp_role').value.trim(),
        status: 'جديدة',
        judgment_summary: null,
        judgment_date: null,
        case_code: file.file_code,
        archived: 0,
        created_at: now,
        updated_at: now
      };
      if (!stage.root_case_id) stage.root_case_id = stage.id;

      await db.cases.add(stage);
      await db.pendingOperations.add({ operation: 'insert_case', data: stage, timestamp: Date.now() });
      await db.proceedings.put({
        id: uid('PR'), legal_file_id: file.id, office_id: officeId,
        proceeding_type: def.dbType, parent_proceeding_id: prev ? prev.proceeding_id || null : null,
        appeal_of_proceeding_id: prev ? prev.proceeding_id || null : null,
        court_name: stage.court_name, circuit: stage.circuit || null,
        case_number: stage.case_number, case_year: stage.case_year, city: stage.city || null,
        client_position: stage.client_role, opponent_name: stage.opponent_name, opponent_position: stage.opponent_role,
        status: 'open', metadata: { stage_kind: kind }, created_at: now, updated_at: now
      });

      const total = parseFloat(document.getElementById('qmf_ns_fee_total').value) || 0;
      const paid = parseFloat(document.getElementById('qmf_ns_fee_paid').value) || 0;
      if (total > 0 || paid > 0) {
        await db.fees.put({ case_id: stage.id, legal_file_id: _stageParentFile.id, stage_id: stage.id, scope: 'stage', total, paid, remaining: Math.max(0, total - paid), notes: document.getElementById('qmf_ns_fee_notes').value.trim() });
        if (paid > 0) await db.payments.add({ case_id: stage.id, amount: paid, date: now.slice(0, 10), note: 'دفعة مقدمة' });
      }

      await db.legalFiles.update(file.id, { updated_at: now, status: 'in_progress' });

      if (typeof hideModal === 'function') hideModal('qmfStageModal');
      if (Swal) Swal.fire({ icon: 'success', title: 'تمت إضافة المرحلة', html: `<div style="text-align:right;"><p><b>النوع:</b> ${stageLabel(kind)}</p><p><b>الرقم:</b> ${stage.case_number || '—'}/${stage.case_year || ''}</p></div>`, timer: 2800, showConfirmButton: false, background: '#0f172a', color: '#fff' });

      if (typeof window.loadCasesList === 'function') { try { await window.loadCasesList(); } catch (e) {} }
      if (typeof window.updatePendingBadge === 'function') window.updatePendingBadge();
      setTimeout(() => openDetails(file.id), 300);
    } catch (err) {
      console.error('[QMF] فشل حفظ المرحلة:', err);
      const { Swal } = G();
      if (Swal) Swal.fire('خطأ', err.message || 'تعذّر حفظ المرحلة', 'error');
    }
  }

  /* ============================================================
   * 11) التحويل من خدمي/عام إلى قضائي (نفس رقم MJ)
   * ============================================================ */
  async function convertToJudicial(legalFileId) {
    const { db, Swal, hideModal } = G();
    const file = await db.legalFiles.get(legalFileId);
    if (!file) return;
    if (Swal) {
      const res = await Swal.fire({
        title: 'تحويل إلى ملف قضائي',
        html: `<div style="text-align:right;"><p>سيتم تحويل الملف <b>${file.file_code}</b> إلى ملف قضائي مع الاحتفاظ بنفس الرقم الإداري، وإنشاء مرحلة قيد.</p></div>`,
        icon: 'question', showCancelButton: true, confirmButtonText: 'تحويل', cancelButtonText: 'إلغاء', background: '#0f172a', color: '#fff'
      });
      if (!res.isConfirmed) return;
    }
    const now = nowIso();
    await db.legalFiles.update(file.id, { file_type: 'judicial', file_category: 'judicial', status: 'in_progress', updated_at: now });
    const stage = {
      id: uid('C'), office_id: file.office_id, legal_file_id: file.id, main_file_code: file.file_code,
      root_case_id: null, parent_case_id: null, appeal_of_case_id: null,
      proceeding_type: 'other', stage_kind: 'registration', stage_order: 0,
      case_number: '', case_year: '', court_name: '', circuit: '', city: '',
      case_type: '', case_subject: file.title,
      client_name: file.client_name, client_role: file.client_role,
      opponent_name: file.opponent_name, opponent_role: file.opponent_role,
      status: 'جديدة', judgment_summary: null, judgment_date: null,
      case_code: file.file_code, archived: 0, created_at: now, updated_at: now
    };
    stage.root_case_id = stage.id;
    await db.cases.add(stage);
    await db.pendingOperations.add({ operation: 'insert_case', data: stage, timestamp: Date.now() });
    if (Swal) Swal.fire({ icon: 'success', title: 'تم التحويل', text: 'أُنشئت مرحلة القيد. يمكنك الآن إضافة أول درجة.', timer: 2600, showConfirmButton: false, background: '#0f172a', color: '#fff' });
    if (typeof hideModal === 'function') hideModal('qmfDetailsModal');
    if (typeof window.loadCasesList === 'function') { try { await window.loadCasesList(); } catch (e) {} }
    setTimeout(() => openDetails(file.id), 300);
  }

  /* ============================================================
   * 12) فتح المرحلة في واجهة القضية (جلسات/أتعاب/مستندات)
   * ============================================================ */
  function openStage(stageId) {
    const { hideModal } = G();
    if (typeof hideModal === 'function') hideModal('qmfDetailsModal');
    setTimeout(() => { if (typeof window.openCaseDetails === 'function') window.openCaseDetails(stageId); }, 300);
  }
  function openStageFees(stageId, legalFileId) {
    const { hideModal } = G();
    if (typeof hideModal === 'function') hideModal('qmfDetailsModal');
    setTimeout(() => { if (typeof window.openFeesModal === 'function') window.openFeesModal(stageId, legalFileId, 'stage'); }, 300);
  }
  function openFileFees(legalFileId) {
    const { hideModal } = G();
    if (typeof hideModal === 'function') hideModal('qmfDetailsModal');
    setTimeout(() => { if (typeof window.openFeesModal === 'function') window.openFeesModal(legalFileId, legalFileId, 'file'); }, 300);
  }

  /* ============================================================
   * 13) الطباعة
   * ============================================================ */
  function printShell(title, bodyHtml) {
    const { esc, officeName } = G();
    return `<html dir="rtl"><head><meta charset="utf-8"><style>
      body{font-family:Arial,'Noto Sans Arabic',sans-serif;direction:rtl;padding:30px;color:#172b45}
      .print-head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #be9124;padding-bottom:10px;margin-bottom:16px}
      .print-head .office{font-weight:900;color:#12335b;font-size:20px}
      .print-head .meta{font-size:12px;color:#53657d}
      h1{text-align:center;color:#12335b;margin:6px 0 16px}
      h2{color:#8a6814;font-size:16px;border-bottom:1px solid #e6d9b0;padding-bottom:4px;margin-top:22px}
      table{width:100%;border-collapse:collapse;margin:10px 0}
      th,td{border:1px solid #d9e1eb;padding:6px 8px;text-align:right;font-size:13px}
      th{background:#f0f7ff}
      .print-foot{margin-top:26px;border-top:1px solid #d9e1eb;padding-top:8px;font-size:11px;color:#53657d;text-align:center}
      .stage-block{margin-bottom:16px;border:1px solid #d9e1eb;border-right:5px solid #be9124;border-radius:8px;padding:10px 14px}
      .stage-block h3{margin:0 0 8px;color:#8a6814;font-size:15px}
      .kv{margin:3px 0;font-size:13px}
      .kv b{color:#53657d}
    </style></head><body>
      <div class="print-head"><div class="office">${esc(officeName || 'مكتب جاد الرب للمحاماة')}</div><div class="meta">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</div></div>
      <h1>${esc(title)}</h1>
      ${bodyHtml}
      <div class="print-foot">نظام قيد لإدارة الملفات القانونية</div>
    </body></html>`;
  }

  async function printFees(legalFileId, stageId) {
    const { db, esc, ipc, Swal } = G();
    const file = await db.legalFiles.get(legalFileId);
    if (!file) return;
    let targets = [];
    if (stageId) {
      const s = await db.cases.get(stageId);
      targets = s ? [s] : [];
    } else {
      try { targets = await db.cases.filter(c => c.legal_file_id === legalFileId).toArray(); } catch (e) { targets = []; }
      targets.sort((a, b) => (STAGE_KINDS[a.stage_kind] ? STAGE_KINDS[a.stage_kind].order : 0) - (STAGE_KINDS[b.stage_kind] ? STAGE_KINDS[b.stage_kind].order : 0));
    }

    let rows = '';
    let grandTotal = 0, grandPaid = 0;
    const details = [];
    for (const s of targets) {
      const fee = await db.fees.get(s.id).catch(() => null) || { total: 0, paid: 0, remaining: 0, notes: '' };
      const payments = await db.payments.where('case_id').equals(s.id).toArray().catch(() => []);
      const expenses = await db.expenses.where('case_id').equals(s.id).toArray().catch(() => []);
      grandTotal += Number(fee.total || 0); grandPaid += Number(fee.paid || 0);
      rows += `<tr><td>${esc(stageLabel(s.stage_kind))}</td><td>${esc(s.case_number || '—')}/${esc(s.case_year || '')}</td><td>${Number(fee.total || 0).toFixed(2)}</td><td>${Number(fee.paid || 0).toFixed(2)}</td><td>${Number(fee.remaining || 0).toFixed(2)}</td></tr>`;
      if (stageId) {
        details.push({ stage: s, payments, expenses, fee });
      }
    }

    let body = `<h2>${stageId ? 'أتعاب المرحلة' : 'أتعاب الملف كله'}</h2>`;
    body += `<div class="kv"><b>الرقم الإداري:</b> ${esc(file.file_code)} &nbsp; <b>العميل:</b> ${esc(file.client_name || '')}</div>`;
    body += `<table><thead><tr><th>المرحلة</th><th>رقم القضية</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>${rows}</tbody></table>`;
    body += `<div class="kv"><b>إجمالي الأتعاب:</b> ${grandTotal.toFixed(2)} &nbsp; <b>إجمالي المدفوع:</b> ${grandPaid.toFixed(2)} &nbsp; <b>المتبقي:</b> ${(grandTotal - grandPaid).toFixed(2)}</div>`;

    if (stageId && details.length) {
      const d = details[0];
      if (d.payments.length) {
        body += `<h2>سجل الدفعات</h2><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظات</th></tr></thead><tbody>${d.payments.map(p => `<tr><td>${esc(p.date || '')}</td><td>${Number(p.amount || 0).toFixed(2)}</td><td>${esc(p.note || '')}</td></tr>`).join('')}</tbody></table>`;
      }
      if (d.expenses.length) {
        body += `<h2>سجل المصروفات</h2><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>البند</th></tr></thead><tbody>${d.expenses.map(x => `<tr><td>${esc(x.date || '')}</td><td>${Number(x.amount || 0).toFixed(2)}</td><td>${esc(x.category || '')}</td></tr>`).join('')}</tbody></table>`;
      }
    }

    const html = printShell(stageId ? 'إيصال أتعاب مرحلة' : 'إيصال أتعاب الملف', body);
    const fname = `أتعاب_${file.file_code}${stageId ? '_مرحلة' : '_كامل'}.pdf`;
    if (ipc && ipc.printArabicPdf) await ipc.printArabicPdf(html, fname);
    else if (Swal) Swal.fire('تنبيه', 'الطباعة متاحة داخل تطبيق سطح المكتب فقط', 'info');
  }

  async function printData(legalFileId, stageId) {
    const { db, esc, ipc, Swal } = G();
    const file = await db.legalFiles.get(legalFileId);
    if (!file) return;

    if (stageId) {
      const s = await db.cases.get(stageId);
      if (!s) return;
      const sessions = await db.sessions.where('case_id').equals(stageId).toArray().catch(() => []);
      let body = `<div class="stage-block">
        <h3>${esc(stageLabel(s.stage_kind))}</h3>
        <div class="kv"><b>الرقم الإداري:</b> ${esc(file.file_code)}</div>
        <div class="kv"><b>رقم القضية:</b> ${esc(s.case_number || '—')}/${esc(s.case_year || '')}</div>
        <div class="kv"><b>المحكمة:</b> ${esc(s.court_name || '—')} &nbsp; <b>الدائرة:</b> ${esc(s.circuit || '—')} &nbsp; <b>المدينة:</b> ${esc(s.city || '—')}</div>
        <div class="kv"><b>العميل:</b> ${esc(s.client_name || '')} ${s.client_role ? '(' + esc(s.client_role) + ')' : ''}</div>
        <div class="kv"><b>الخصم:</b> ${esc(s.opponent_name || '')} ${s.opponent_role ? '(' + esc(s.opponent_role) + ')' : ''}</div>
        <div class="kv"><b>الموضوع:</b> ${esc(s.case_subject || '—')}</div>
        <div class="kv"><b>الحالة:</b> ${esc(s.status || '—')}</div>
        ${s.judgment_summary ? `<div class="kv"><b>منطوق الحكم:</b> ${esc(s.judgment_summary)} ${s.judgment_date ? '(' + esc(s.judgment_date) + ')' : ''}</div>` : ''}
      </div>`;
      if (sessions.length) {
        body += `<h2>الجلسات</h2><table><thead><tr><th>التاريخ</th><th>الحالة</th><th>القرار</th></tr></thead><tbody>${sessions.map(x => `<tr><td>${esc(new Date(x.session_date).toLocaleString('ar-EG'))}</td><td>${esc(x.case_status || '')}</td><td>${esc(x.decision || '')}</td></tr>`).join('')}</tbody></table>`;
      }
      const html = printShell(`بيانات المرحلة — ${stageLabel(s.stage_kind)}`, body);
      if (ipc && ipc.printArabicPdf) await ipc.printArabicPdf(html, `بيانات_${file.file_code}_${stageLabel(s.stage_kind)}.pdf`);
      else if (Swal) Swal.fire('تنبيه', 'الطباعة متاحة داخل تطبيق سطح المكتب فقط', 'info');
      return;
    }

    // الملف كله
    let stages = await loadStagesForFile(legalFileId);
    stages.sort((a, b) => (STAGE_KINDS[a.stage_kind] ? STAGE_KINDS[a.stage_kind].order : 0) - (STAGE_KINDS[b.stage_kind] ? STAGE_KINDS[b.stage_kind].order : 0));

    let body = `<div class="stage-block">
      <div class="kv"><b>الرقم الإداري:</b> ${esc(file.file_code)}</div>
      <div class="kv"><b>العنوان:</b> ${esc(file.title || '')}</div>
      <div class="kv"><b>النوع:</b> ${esc(fileTypeLabel(file.file_type))} (${esc(CATEGORY_LABELS[file.file_category || categoryOf(file.file_type)] || '')})</div>
      <div class="kv"><b>العميل:</b> ${esc(file.client_name || '')} ${file.client_role ? '(' + esc(file.client_role) + ')' : ''}</div>
      <div class="kv"><b>الخصم:</b> ${esc(file.opponent_name || '')} ${file.opponent_role ? '(' + esc(file.opponent_role) + ')' : ''}</div>
      <div class="kv"><b>الوصف:</b> ${esc(file.description || '—')}</div>
    </div>`;

    for (const s of stages) {
      const sessions = await db.sessions.where('case_id').equals(s.id).toArray().catch(() => []);
      body += `<div class="stage-block">
        <h3>${esc(stageLabel(s.stage_kind))}</h3>
        <div class="kv"><b>رقم القضية:</b> ${esc(s.case_number || '—')}/${esc(s.case_year || '')} &nbsp; <b>المحكمة:</b> ${esc(s.court_name || '—')}</div>
        <div class="kv"><b>صفة العميل:</b> ${esc(s.client_role || '—')} &nbsp; <b>صفة الخصم:</b> ${esc(s.opponent_role || '—')}</div>
        <div class="kv"><b>الموضوع:</b> ${esc(s.case_subject || '—')} &nbsp; <b>الحالة:</b> ${esc(s.status || '—')}</div>
        ${s.judgment_summary ? `<div class="kv"><b>منطوق الحكم:</b> ${esc(s.judgment_summary)}</div>` : ''}
        ${sessions.length ? `<div class="kv"><b>الجلسات (${sessions.length}):</b> ${sessions.map(x => esc(String(x.session_date || '').slice(0, 10))).join(' · ')}</div>` : ''}
      </div>`;
    }

    const html = printShell('بيانات الملف الرئيسي', body);
    if (ipc && ipc.printArabicPdf) await ipc.printArabicPdf(html, `بيانات_${file.file_code}_كامل.pdf`);
    else if (Swal) Swal.fire('تنبيه', 'الطباعة متاحة داخل تطبيق سطح المكتب فقط', 'info');
  }

  /* ============================================================
   * 14) فتح اللوحة
   * ============================================================ */
  async function openPanel() {
    const { showModal } = G();
    if (typeof showModal === 'function') showModal('qmfMainFilesModal');
    await renderList('');
  }

  /* ============================================================
   * BOOT
   * ============================================================ */
  function boot() {
    injectStyles();
    injectModals();
    window.QMF = {
      version: QMF_VERSION,
      openPanel,
      renderList,
      openCreateModal,
      saveMainFile,
      editMainFile,
      archiveMainFile,
      deleteMainFile,
      addSessionForFile,
      rescheduleFileSession,
      openDetails,
      openAddStage,
      saveStage,
      convertToJudicial,
      openStage,
      openStageFees,
      openFileFees,
      printFees,
      printData,
      onTypeChange,
      onStageKindChange,
      onNewStageKindChange,
      onSwapToggle,
      generateMainFileCode,
      assertValidMainFileCode,
      STAGE_KINDS,
      FILE_TYPES
    };
    console.log('%c[qayd-main-file] ✅ نظام الملف الرئيسي (MJ) جاهز v' + QMF_VERSION, 'color:#be9124;font-weight:bold;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

// ========== renderer.js - النسخة النهائية المتكاملة (شريط جانبي مبسط + ترخيص 90 يوم + مودال إعدادات) ==========
window.onerror = function(message, source, lineno, colno, error) {
    console.error('خطأ شامل:', message, error);
    Swal.fire({ icon: 'error', title: 'خطأ غير متوقع', text: message, background: '#0f172a', color: '#fff' });
    return false;
};
let storageRepairPromptShown = false;
async function offerIndexedDbRepair(error) {
    if (storageRepairPromptShown) return;
    storageRepairPromptShown = true;
    const result = await Swal.fire({
        icon: 'error',
        title: 'مشكلة في قاعدة البيانات المحلية',
        text: 'تعذر فتح مخزن البيانات المحلي. سيتم حفظ نسخة احتياطية ثم إعادة تهيئة المخزن فقط إذا وافقت.',
        showCancelButton: true,
        confirmButtonText: 'إصلاح مع نسخة احتياطية',
        cancelButtonText: 'إغلاق',
        background: '#0f172a', color: '#fff'
    });
    if (!result.isConfirmed || !ipcRenderer?.repairIndexedDB) return;
    const repaired = await ipcRenderer.repairIndexedDB();
    if (!repaired?.success) return Swal.fire('تعذر الإصلاح', repaired?.error || 'تعذر إنشاء النسخة الاحتياطية', 'error');
    Swal.fire({ icon: 'success', title: 'تم حفظ النسخة الاحتياطية', text: 'سيعاد تشغيل التطبيق الآن لإعادة إنشاء قاعدة البيانات المحلية.', timer: 1800, showConfirmButton: false, background: '#0f172a', color: '#fff' })
        .then(() => location.reload());
}
window.onunhandledrejection = function(event) {
    console.error('وعد غير معالج:', event.reason);
    const message = event.reason?.message || String(event.reason || '');
    if (/backing store|indexedDB|IndexedDB/i.test(message)) return offerIndexedDbRepair(event.reason);
    Swal.fire({ icon: 'error', title: 'خطأ غير معالج', text: message || 'خطأ غير معروف', background: '#0f172a', color: '#fff' });
};

// ========== 1. الإعدادات وقواعد البيانات ==========
let ipcRenderer = null;
try { if (window.electronAPI) ipcRenderer = window.electronAPI; } catch(e) { console.log('ليس في بيئة إلكترون'); }
let currentUserRole = null;
function canSeeFinance() { return currentUserRole === 'manager' || currentUserRole === 'accountant'; }
function ownerOnly(action = 'هذه العملية') { if (currentUserRole !== 'manager') { Swal.fire('غير مسموح', `المالك فقط يستطيع تنفيذ ${action}`, 'warning'); return false; } return true; }

const db = new Dexie('LawDeskDB');
db.version(4).stores({
    cases: 'id, office_id, client_name, client_phone, client_email, client_role, opponent_name, case_number, case_year, court_name, circuit, case_type, case_subject, case_code, archived',
        sessions: 'id, office_id, case_id, session_date, case_status, decision',
        fees: 'case_id, total, paid, remaining, notes',
        payments: '++id, case_id, amount, date, note',
        events: '++id, title, date, type',
        tasks: '++id, description, date, completed',
        pendingOperations: '++id, operation, data, timestamp',
        offices: '++id, office_id, office_name, pin, email, license_key, license_expiry'
}).upgrade(async tx => {
    const oldOffices = await tx.offices.toArray();
    for (let o of oldOffices) if (!o.license_key) await tx.offices.update(o.id, { license_key: null, license_expiry: null });
    const oldCases = await tx.cases.toArray();
    for (let c of oldCases) if (!c.office_id) await tx.cases.update(c.id, { office_id: 'default_office' });
    const oldSessions = await tx.sessions.toArray();
    for (let s of oldSessions) if (!s.office_id) await tx.sessions.update(s.id, { office_id: 'default_office' });
});

// جدول محلي مستقل للملفات المهنية؛ لا نخلط هذه السجلات مع جدول القضايا القضائية.
db.version(5).stores({
    officeFiles: 'id, office_id, file_code, file_type, client_name, client_phone, status, archived, updated_at',
    fileEvents: 'id, office_id, file_id, event_date, status, client_visible'
});

// سجل المصروفات مستقل حتى يمكن حساب المصروفات وصافي الربح لكل قضية أو ملف مهني أو تحقيقات.
db.version(6).stores({
    expenses: '++id, office_id, owner_id, case_id, amount, date, category'
});

// بيانات مرفقات الإيصالات؛ الملفات نفسها تحفظ في مجلد المستندات المحلي عبر Electron.
db.version(7).stores({
    receipts: '++id, record_id, date, name, path'
});

// دفتر مالي موحد: كل عملية لها نطاق (مكتب/قضية/ملف) ونوع (دخل/مصروف).
db.version(8).stores({
    financialTransactions: 'id, office_id, transaction_type, transaction_scope, case_id, office_file_id, transaction_date, category'
});

// فهارس داخلية لحفظ معرفات Supabase مع جداول Dexie القديمة ذات المفاتيح التلقائية.
// لا تغيّر هذه الإضافة الحقول المعروضة أو طريقة استخدام سطح المكتب.
db.version(9).stores({
    tasks: '++id, office_id, remote_id, description, date, completed',
    expenses: '++id, office_id, remote_id, owner_id, case_id, amount, date, category',
    payments: '++id, remote_id, case_id, amount, date, note'
});

// ملاحظات فريق المكتب: تحفظ محلياً أولاً ثم ترفع إلى public.notes عند المزامنة.
db.version(10).stores({
    notes: '++id, office_id, case_id, office_file_id, updated_at'
});

// النموذج العام: ملف قانوني رئيسي، مراحل قضائية، خدمات غير قضائية، وطلبات اعتماد الهاتف.
db.version(11).stores({
    legalFiles: 'id, office_id, file_code, file_type, status, client_name, responsible_user_id, updated_at',
    proceedings: 'id, legal_file_id, office_id, proceeding_type, parent_proceeding_id, appeal_of_proceeding_id, status, updated_at',
    serviceActions: 'id, legal_file_id, office_id, action_type, sequence_order, step_status, next_followup_at, status, updated_at',
    approvalRequests: 'id, office_id, requested_by, entity_type, entity_id, status, created_at',
    auditLogs: '++id, office_id, entity_type, entity_id, action, created_at',
    syncConflicts: '++id, office_id, entity_type, entity_id, status, created_at'
});

// سير العمل الجديد: أكثر من عميل/خصم وسجل تغييرات الجلسات.
db.version(12).stores({
    caseParties: 'id, office_id, case_id, legal_file_id, party_type, name, phone, updated_at',
    sessionChangeLog: '++id, office_id, remote_id, session_id, changed_at, action'
});

// فهرس داخلي لحفظ معرّف Supabase للأحداث المحلية (الأجناد) حتى تتم المزامنة بدون تكرار.
// إضافة فقط: لا تغيّر الحقول المعروضة ولا طريقة استخدام سطح المكتب.
db.version(13).stores({
    events: '++id, office_id, remote_id, title, date, type'
});

let supabaseClient = null;
let currentOfficeId = null;
let currentOfficeName = null;
let activeCaseId = null, activeSessionId = null, currentCaseForPrint = null, currentDate = new Date();
let currentSelectedDateStr = null, rescheduleSessionId = null;

// هوية النسخة الخاصة بمكتب جاد الرب فقط؛ لا تُنشئ النسخة مكتبًا عامًا جديدًا.
const OWNER_EMAIL = 'mahmoud.abdelhamyd@gmail.com';
const OWNER_OFFICE_ID = '0c62b461-fe1f-49e3-98bf-1bb080bed80b';
const OWNER_OFFICE_NAME = 'مكتب جاد الرب للمحاماة والاستشارات القانونية';
const OWNER_LICENSE_KEY = 'OWNER-PERMANENT-QAYD';
const OWNER_LICENSE_EXPIRY = '9999-12-31';

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function isOwnerEmail(value) { return normalizeEmail(value) === OWNER_EMAIL; }

async function normalizeOwnerLocalOffice() {
    const office = await db.offices.toCollection().first();
    if (!office || !isOwnerEmail(office.email)) return false;
    const oldOfficeId = office.office_id;
    if (oldOfficeId !== OWNER_OFFICE_ID) {
        for (const table of [db.cases, db.sessions, db.tasks, db.expenses, db.financialTransactions, db.officeFiles, db.fileEvents, db.notes, db.legalFiles, db.proceedings, db.serviceActions, db.approvalRequests, db.auditLogs, db.syncConflicts]) {
            const rows = await table.toArray();
            for (const row of rows) if (row.office_id === oldOfficeId) await table.update(row.id, { office_id: OWNER_OFFICE_ID });
        }
    }
    await db.offices.update(office.id, { office_id: OWNER_OFFICE_ID, office_name: OWNER_OFFICE_NAME, email: OWNER_EMAIL, license_key: OWNER_LICENSE_KEY, license_expiry: OWNER_LICENSE_EXPIRY });
    currentOfficeId = OWNER_OFFICE_ID;
    currentOfficeName = OWNER_OFFICE_NAME;
    currentUserRole = 'manager';
    updateSidebarOfficeName(OWNER_OFFICE_NAME);
    return true;
}

async function ensureOwnerLicense(officeId = null) {
    await initSupabase();
    if (!supabaseClient) return false;
    const payload = {
        license_key: OWNER_LICENSE_KEY,
        email: OWNER_EMAIL,
        expiry_date: OWNER_LICENSE_EXPIRY,
        is_active: true,
        notes: 'تفعيل دائم لمالك تطبيق قيد',
        ...(officeId ? { office_id: officeId } : {})
    };
    const { data: existing } = await supabaseClient.from('licenses').select('license_key').eq('license_key', OWNER_LICENSE_KEY).maybeSingle();
    const { error } = existing
        ? await supabaseClient.from('licenses').update(payload).eq('license_key', OWNER_LICENSE_KEY)
        : await supabaseClient.from('licenses').insert([payload]);
    if (error) console.warn('تعذر مزامنة ترخيص المالك:', error);
    return !error;
}

let DEV_MODE = false;
(async () => {
    if (ipcRenderer && ipcRenderer.getDevMode) {
        DEV_MODE = await ipcRenderer.getDevMode();
        console.log('وضع التطوير:', DEV_MODE ? 'نشط (بدون ترخيص)' : 'إنتاج (يتطلب ترخيص)');
    }
})();

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function initSupabase() {
    if (supabaseClient) return supabaseClient;
    try {
        if (ipcRenderer && ipcRenderer.getSupabaseKeys) {
            const keys = await ipcRenderer.getSupabaseKeys();
            supabaseClient = supabase.createClient(keys.url, keys.key);
            console.log('✅ تم تهيئة Supabase');
        } else {
            const fallbackUrl = "https://mgvyieyismzzvdejsvcv.supabase.co";
            const fallbackKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJtZ3Z5aWV5aXNtenp2ZGVqc3ZjdiIsImlhdCI6MTc4MzU0MjY1MywiZXhwIjoyMDk5MTE4NjUzfQ.xE-K83Ku3ei3GlFkwKivtBzGMDyK60R6MnYr2eEFz-I";
            supabaseClient = supabase.createClient(fallbackUrl, fallbackKey);
        }
        return supabaseClient;
    } catch (err) { console.error('خطأ في تهيئة Supabase:', err); return null; }
}

async function setSupabaseOfficeId(officeId) {
    if (!supabaseClient) await initSupabase();
    if (supabaseClient) {
        try { await supabaseClient.rpc('set_office_id', { office_id: officeId }); }
        catch(e) { console.warn('فشل تعيين office_id', e); }
    }
}

function showModal(id) {
    let el = document.getElementById(id);
    if(el) {
        let modal = bootstrap.Modal.getOrCreateInstance(el);
        if (id === 'rescheduleModal') el.style.zIndex = 1060;
        modal.show();
    }
}
function hideModal(id) { let el = document.getElementById(id); if(el) bootstrap.Modal.getOrCreateInstance(el).hide(); }

async function updatePendingBadge() {
    try { const count = await db.pendingOperations.count(); const badge = document.getElementById('syncBadge'); if(badge) { badge.innerText = count; badge.style.display = count > 0 ? 'block' : 'none'; } }
    catch(e) { console.warn("خطأ في تحديث العداد", e); }
}

function updateSidebarOfficeName(name) {
    const el = document.getElementById('sidebarOfficeName');
    if (el) el.innerText = name || 'اسم المحامي';
}

// ========== 2. دوال الترخيص والعرض ==========
async function loadAndDisplayLicenseStatus() {
    const offices = await db.offices.toArray();
    const activateBtn = document.getElementById('activateLicenseBtn');
    if (offices.length === 0) {
        document.getElementById('licenseStatusText').innerText = 'غير مفعل';
        if (activateBtn) activateBtn.style.display = 'block';
        return;
    }
    const licenseKey = offices[0].license_key;
    const expiryDate = offices[0].license_expiry;
    if (isOwnerEmail(offices[0].email) || licenseKey === OWNER_LICENSE_KEY) {
        document.getElementById('licenseStatusText').innerHTML = '<span class="text-success">تفعيل دائم — مالك التطبيق</span>';
        if (activateBtn) activateBtn.style.display = 'none';
        return;
    }
    if (!licenseKey || !expiryDate) {
        document.getElementById('licenseStatusText').innerHTML = '<span class="text-warning">غير مفعل</span>';
        if (activateBtn) activateBtn.style.display = 'block';
        return;
    }
    const expiry = new Date(expiryDate);
    const now = new Date();
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) {
        document.getElementById('licenseStatusText').innerHTML = '<span class="text-danger">منتهي الصلاحية</span>';
        if (activateBtn) activateBtn.style.display = 'block';
    } else if (daysLeft <= 7) {
        document.getElementById('licenseStatusText').innerHTML = `<span class="text-warning">ينتهي بعد ${daysLeft} يوم</span>`;
        if (activateBtn) activateBtn.style.display = 'none';
    } else {
        document.getElementById('licenseStatusText').innerHTML = `<span class="text-success">ساري (${daysLeft} يوم متبقي)</span>`;
        if (activateBtn) activateBtn.style.display = 'none';
    }
}

async function checkLicenseValidity(licenseKey) {
    if (licenseKey === OWNER_LICENSE_KEY) return { valid: true, expiry: OWNER_LICENSE_EXPIRY, message: 'تفعيل دائم لمالك التطبيق' };
    if (!supabaseClient) await initSupabase();
    const { data, error } = await supabaseClient
    .from('licenses')
    .select('license_key, expiry_date, is_active')
    .eq('license_key', licenseKey)
    .single();
    if (error || !data) return { valid: false, message: 'مفتاح الترخيص غير صالح' };
    if (!data.is_active) return { valid: false, message: 'هذا المفتاح معطل' };
    const expiry = new Date(data.expiry_date);
    if (expiry < new Date()) return { valid: false, message: 'انتهت صلاحية الترخيص في ' + data.expiry_date };
    return { valid: true, expiry: data.expiry_date, message: 'ترخيص صالح' };
}

window.startFirstInstallRegistration = function() {
    const offices = db.offices.toArray();
    offices.then(items => {
        if (items.length > 0) return Swal.fire('تنبيه', 'يوجد مكتب مسجل على هذا الجهاز. استخدم الدخول أو الاسترداد.', 'info');
        showModal('officeSetupModal');
    });
};

window.showLicenseModal = function() {
    document.getElementById('licenseModalOptions').style.display = 'block';
    document.getElementById('activationInputArea').style.display = 'none';
    document.getElementById('trialEmailArea').style.display = 'none';
    showModal('licenseModal');
};
window.showActivationInput = function() {
    document.getElementById('licenseModalOptions').style.display = 'none';
    document.getElementById('activationInputArea').style.display = 'block';
    document.getElementById('activationCode').focus();
};
window.hideActivationInput = function() {
    document.getElementById('activationInputArea').style.display = 'none';
    document.getElementById('licenseModalOptions').style.display = 'block';
};
window.startFreeTrial = function() {
    document.getElementById('licenseModalOptions').style.display = 'none';
    document.getElementById('trialEmailArea').style.display = 'block';
    document.getElementById('trialEmail').focus();
};
window.hideTrialEmail = function() {
    document.getElementById('trialEmailArea').style.display = 'none';
    document.getElementById('licenseModalOptions').style.display = 'block';
};

window.startFreeTrialWithEmail = async function() {
    const email = normalizeEmail(document.getElementById('trialEmail').value);
    if (!email || !email.includes('@')) {
        Swal.fire('خطأ', 'يرجى إدخال بريد إلكتروني صحيح', 'error');
        return;
    }
    if (isOwnerEmail(email)) {
        localStorage.setItem('pendingLicenseKey', OWNER_LICENSE_KEY);
        localStorage.setItem('pendingLicenseExpiry', OWNER_LICENSE_EXPIRY);
        await ensureOwnerLicense();
        hideModal('licenseModal');
        Swal.fire('تم التعرف على المالك', 'سيتم تفعيل التطبيق بشكل دائم بعد حفظ بيانات المكتب.', 'success').then(() => showModal('officeSetupModal'));
        return;
    }
    const trialKey = 'TRIAL-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 90);
    const expiryStr = expiryDate.toISOString().split('T')[0];

    await initSupabase();
    const { error } = await supabaseClient.from('licenses').insert([{
        license_key: trialKey,
        email: email,
        expiry_date: expiryStr,
        is_active: true,
        notes: 'نسخة تجريبية 90 يوم'
    }]);
    if (error) {
        console.error('فشل إنشاء الترخيص التجريبي:', error);
        Swal.fire('خطأ', 'حدث خطأ أثناء إنشاء الترخيص، حاول مرة أخرى', 'error');
        return;
    }
    localStorage.setItem('pendingLicenseKey', trialKey);
    localStorage.setItem('pendingLicenseExpiry', expiryStr);
    hideModal('licenseModal');
    Swal.fire('تم', 'تم تفعيل النسخة التجريبية لمدة 90 يوم', 'success').then(() => {
        showModal('officeSetupModal');
    });
    await loadAndDisplayLicenseStatus();
};

window.verifyActivationCode = async function() {
    const code = document.getElementById('activationCode').value.trim();
    if (!code) return Swal.fire('خطأ', 'أدخل كود التفعيل', 'error');
    if (code === OWNER_LICENSE_KEY) {
        localStorage.setItem('pendingLicenseKey', OWNER_LICENSE_KEY);
        localStorage.setItem('pendingLicenseExpiry', OWNER_LICENSE_EXPIRY);
        hideModal('licenseModal');
        Swal.fire('تم', 'تم التعرف على كود مالك التطبيق. التفعيل دائم.', 'success').then(() => showModal('officeSetupModal'));
        return;
    }
    await initSupabase();
    const { data, error } = await supabaseClient.from('licenses').select('license_key, expiry_date, is_active').eq('license_key', code).single();
    if (error || !data) return Swal.fire('خطأ', 'كود التفعيل غير صالح', 'error');
    if (!data.is_active) return Swal.fire('خطأ', 'هذا الكود معطل', 'error');
    const expiry = new Date(data.expiry_date);
    if (expiry < new Date()) return Swal.fire('خطأ', 'انتهت صلاحية الكود', 'error');
    localStorage.setItem('pendingLicenseKey', code);
    localStorage.setItem('pendingLicenseExpiry', data.expiry_date);
    hideModal('licenseModal');
    Swal.fire('تم', 'تم تفعيل الترخيص بنجاح', 'success').then(() => {
        showModal('officeSetupModal');
    });
    await loadAndDisplayLicenseStatus();
};

// ========== 3. نظام التبويبات اليدوي ==========
function showTab(tabId) {
    document.querySelectorAll('.tab-pane').forEach(pane => { pane.classList.remove('active', 'show'); pane.style.display = 'none'; });
    const targetPane = document.getElementById(tabId);
    if (targetPane) { targetPane.style.display = 'block'; targetPane.classList.add('active', 'show'); }
    document.querySelectorAll('.nav-link').forEach(btn => {
        btn.classList.remove('active');
        const target = btn.getAttribute('data-bs-target');
        if (target === '#' + tabId) btn.classList.add('active');
    });
}
window.showTab = showTab;
function bindManualTabs() {
    document.querySelectorAll('.nav-link').forEach(btn => {
        btn.removeEventListener('click', manualTabHandler);
        btn.addEventListener('click', manualTabHandler);
    });
}
function manualTabHandler(e) { e.preventDefault(); const target = this.getAttribute('data-bs-target'); if (target) showTab(target.substring(1)); }

// ========== 4. إعداد المكتب (مع ربط الترخيص المعلق) ==========
window.saveOfficeSetup = async function() {
    const officeName = document.getElementById('officeNameInput').value.trim();
    const email = normalizeEmail(document.getElementById('officeEmailInput').value);
    const pin = document.getElementById('initialPin').value;
    const confirm = document.getElementById('confirmPin').value;
    if (!officeName) return Swal.fire('خطأ', 'أدخل اسم المحامي أو المكتب', 'error');
    if (!isOwnerEmail(email)) return Swal.fire('غير مسموح', `هذه النسخة مخصصة لمالك مكتب جاد الرب (${OWNER_EMAIL}) فقط.`, 'warning');
    if (pin !== confirm) return Swal.fire('خطأ', 'PIN غير متطابق', 'error');
    if (pin.length < 4 || pin.length > 6) return Swal.fire('خطأ', 'PIN يجب أن يكون 4-6 أرقام', 'error');

    let licenseKey = localStorage.getItem('pendingLicenseKey');
    let licenseExpiry = localStorage.getItem('pendingLicenseExpiry');
    if (isOwnerEmail(email)) {
        licenseKey = OWNER_LICENSE_KEY;
        licenseExpiry = OWNER_LICENSE_EXPIRY;
    }
    if (!licenseKey && !DEV_MODE) {
        Swal.fire('تنبيه', 'يجب تفعيل الترخيص قبل إعداد المكتب', 'warning');
        showLicenseModal();
        window.continueOfficeSetup = saveOfficeSetup;
        return;
    }

    const officeId = OWNER_OFFICE_ID;
    const canonicalOfficeName = OWNER_OFFICE_NAME;
    await db.offices.clear();
    await db.offices.add({ office_id: officeId, office_name: canonicalOfficeName, pin, email: OWNER_EMAIL, license_key: OWNER_LICENSE_KEY, license_expiry: OWNER_LICENSE_EXPIRY });
    currentOfficeId = officeId;
    currentOfficeName = canonicalOfficeName;
    currentUserRole = 'manager';
    updateSidebarOfficeName(canonicalOfficeName);
    localStorage.removeItem('pendingLicenseKey');
    localStorage.removeItem('pendingLicenseExpiry');
    window.continueOfficeSetup = null;

    if (licenseKey && supabaseClient) {
        if (licenseKey === OWNER_LICENSE_KEY) await ensureOwnerLicense(officeId);
        else await supabaseClient.from('licenses').update({ office_id: officeId }).eq('license_key', licenseKey);
    }

    try {
        await initSupabase();
        if (supabaseClient) {
            await supabaseClient.from('offices').upsert([{ office_id: officeId, office_name: canonicalOfficeName, email: OWNER_EMAIL, pin, license_key: OWNER_LICENSE_KEY, license_expiry: OWNER_LICENSE_EXPIRY }], { onConflict: 'office_id' });
        }
    } catch(e) { console.warn(e); }

    hideModal('officeSetupModal');
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    bindManualTabs();
    showTab('agendaTab');
    await loadRecentCases();
    await loadUpcomingSessions('week');
    await renderCalendar();
    await loadStats();
    updatePendingBadge();
    checkUpcomingNotifications();
    setInterval(checkUpcomingNotifications, 3600000);
    await loadAndDisplayLicenseStatus();
};

// ========== 5. استرداد المكتب ==========
window.showRecoveryModal = function() { showModal('recoverOfficeModal'); };
window.showOfficeSetupInstead = function() { hideModal('recoverOfficeModal'); showModal('officeSetupModal'); };
window.recoverOffice = async function() {
    const email = document.getElementById('recoverEmail').value.trim();
    const newPin = document.getElementById('newPinRecover').value;
    const confirmPin = document.getElementById('confirmNewPinRecover').value;
    if (!email) return Swal.fire('خطأ', 'أدخل البريد الإلكتروني', 'error');
    if (newPin !== confirmPin) return Swal.fire('خطأ', 'PIN غير متطابق', 'error');
    if (newPin.length < 4 || newPin.length > 6) return Swal.fire('خطأ', 'PIN يجب أن يكون 4-6 أرقام', 'error');

    await initSupabase();
    if (!supabaseClient) return Swal.fire('خطأ', 'لا يوجد اتصال بالإنترنت لاسترداد المكتب', 'error');

    const { data, error } = await supabaseClient.from('offices').select('office_id, office_name').eq('email', email);
    if (error || !data || data.length === 0) return Swal.fire('خطأ', 'لم يتم العثور على مكتب مرتبط بهذا البريد', 'error');
    const office = data[0];
    const officeId = office.office_id;
    const officeName = office.office_name;

    let licenseKey = null, licenseExpiry = null;
    if (!DEV_MODE) {
        const { data: licData } = await supabaseClient.from('licenses').select('license_key, expiry_date').eq('office_id', officeId).single();
        if (licData) {
            licenseKey = licData.license_key;
            licenseExpiry = licData.expiry_date;
        } else {
            Swal.fire('تنبيه', 'هذا المكتب ليس لديه ترخيص صالح، الرجاء التفعيل', 'warning');
            showLicenseModal();
            return;
        }
    }

    await db.offices.clear();
    await db.offices.add({ office_id: officeId, office_name: officeName, pin: newPin, email, license_key: licenseKey, license_expiry: licenseExpiry });
    currentOfficeId = officeId;
    currentOfficeName = officeName;
    updateSidebarOfficeName(officeName);

    hideModal('recoverOfficeModal');
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    bindManualTabs();
    showTab('agendaTab');

    await setSupabaseOfficeId(currentOfficeId);
    await downloadFromSupabase();
    await loadRecentCases();
    await loadUpcomingSessions('week');
    await renderCalendar();
    await loadStats();
    updatePendingBadge();
    checkUpcomingNotifications();
    setInterval(checkUpcomingNotifications, 3600000);
    await loadAndDisplayLicenseStatus();
    Swal.fire('تم', 'تم استرداد المكتب بنجاح', 'success');
};

// ========== 6. تسجيل الدخول بـ PIN ==========
async function checkOfficeSetup() {
    const offices = await db.offices.toArray();
    if (offices.length > 0) {
        currentOfficeId = offices[0].office_id;
        currentOfficeName = offices[0].office_name;
        updateSidebarOfficeName(currentOfficeName);
        await loadAndDisplayLicenseStatus();
        return true;
    }
    return false;
}
window.verifyPin = async function() {
    const entered = document.getElementById('pinInput').value;
    const offices = await db.offices.toArray();
    if (offices.length === 0) {
        showModal('officeSetupModal');
        return;
    }
    if (entered === offices[0].pin) {
        currentOfficeId = offices[0].office_id;
        currentOfficeName = offices[0].office_name;
        if (isOwnerEmail(offices[0].email)) {
            await normalizeOwnerLocalOffice();
            currentOfficeId = OWNER_OFFICE_ID;
            currentOfficeName = OWNER_OFFICE_NAME;
            currentUserRole = 'manager';
            await ensureDesktopSupabaseSession();
        }
        updateSidebarOfficeName(currentOfficeName);

        if (!DEV_MODE && !isOwnerEmail(offices[0].email)) {
            const licenseKey = offices[0].license_key;
            if (!licenseKey) {
                Swal.fire('تنبيه', 'لا يوجد ترخيص صالح لهذا المكتب', 'warning');
                showLicenseModal();
                return;
            }
            const result = await checkLicenseValidity(licenseKey);
            if (!result.valid) {
                Swal.fire('خطأ', result.message, 'error');
                showLicenseModal();
                return;
            } else if (new Date(offices[0].license_expiry) < new Date(Date.now() + 7*24*60*60*1000)) {
                Swal.fire({
                    icon: 'info',
                    title: 'تنبيه',
                    text: `ينتهي ترخيصك في ${offices[0].license_expiry}. يرجى تجديده قريباً.`,
                    background: '#0f172a',
                    color: '#fff',
                    timer: 5000,
                    showConfirmButton: true
                });
            }
        }

        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('appContainer').style.display = 'block';
        bindManualTabs();
        showTab('agendaTab');
        await loadRecentCases();
        await loadUpcomingSessions('week');
        await renderCalendar();
        await loadStats();
        await loadDashboardSummary();
        updatePendingBadge();
        checkUpcomingNotifications();
        setInterval(checkUpcomingNotifications, 3600000);
        await loadAndDisplayLicenseStatus();
        if (currentUserRole === 'manager') loadOwnerReviewData().then(data => updateOwnerReviewBadge(data.requests.length + data.conflicts.length)).catch(error => console.warn('تعذر تحميل عداد اعتماد الهاتف:', error?.message || error));
    } else {
        Swal.fire('خطأ', 'PIN غير صحيح', 'error');
        document.getElementById('pinInput').value = '';
    }
};

window.showChangePinModal = function() { showModal('changePinModal'); };
window.changeOfficePin = async function() {
    const old = document.getElementById('oldPin').value;
    const newPin = document.getElementById('newPin').value;
    const confirm = document.getElementById('confirmNewPin').value;
    const offices = await db.offices.toArray();
    if (offices.length === 0) return;
    if (old !== offices[0].pin) return Swal.fire('خطأ', 'PIN الحالي غير صحيح', 'error');
    if (newPin !== confirm) return Swal.fire('خطأ', 'PIN الجديد غير متطابق', 'error');
    if (newPin.length < 4 || newPin.length > 6) return Swal.fire('خطأ', 'PIN يجب أن يكون 4-6 أرقام', 'error');
    await db.offices.update(offices[0].id, { pin: newPin });
    hideModal('changePinModal');
    Swal.fire('تم', 'تم تغيير PIN بنجاح', 'success');
};

// ========== 7. التنبيهات ==========
async function checkUpcomingNotifications() {
    if (!ipcRenderer) return;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const sessions = await db.sessions.filter(s => s.session_date && s.session_date.startsWith(tomorrowStr) && s.office_id === currentOfficeId).toArray();
    if (sessions.length) ipcRenderer.showNotification('تنبيه الجلسات', `لديك ${sessions.length} جلسات غداً`);
    const tasks = await db.tasks.where('date').equals(tomorrowStr).filter(t => !t.completed).toArray();
    if (tasks.length) ipcRenderer.showNotification('تنبيه المهام', `لديك ${tasks.length} مهام غداً`);
    const events = await db.events.where('date').equals(tomorrowStr).toArray();
    if (events.length) ipcRenderer.showNotification('تنبيه الأحداث', `لديك ${events.length} أحداث غداً`);
}

// ========== 8. إدارة المكتب ==========
let allCasesList = [];
let allOfficeRecords = [];
window.loadCasesList = async function() {
    try {
        allCasesList = await db.cases.filter(c => !c.archived && c.office_id === currentOfficeId).toArray();
        const professionalFiles = await db.officeFiles.where('office_id').equals(currentOfficeId).filter(f => !f.archived).toArray();
        allOfficeRecords = [...allCasesList.map(c => ({ ...c, record_type: 'judicial' })), ...professionalFiles.map(f => ({ ...f, record_type: f.file_type }))];
        filterCasesList();
    } catch (error) {
        console.error('تعذر تحميل إدارة القضايا:', error);
        const container = document.getElementById('casesListContainer');
        if (container) container.innerHTML = `<div class="alert alert-danger">تعذر تحميل الملفات: ${escapeHtml(error.message || 'خطأ غير معروف')}</div>`;
    }
};
function filterCasesList() {
    const search = (document.getElementById('caseSearchInput')?.value || '').trim().toLowerCase();
    const court = document.getElementById('courtFilter')?.value || '';
    const service = document.getElementById('serviceFilter')?.value || '';
    const filtered = allOfficeRecords.filter(record => {
        const haystack = [record.client_name, record.title, record.court_name, record.case_number, record.file_code, record.case_code].filter(Boolean).join(' ').toLowerCase();
        return (!search || haystack.includes(search)) && (!court || record.court_name === court) && (!service || record.record_type === service);
    });
    const container = document.getElementById('casesListContainer');
    if (!container) return;
    container.innerHTML = filtered.length ? filtered.map(record => {
        const judicial = record.record_type === 'judicial';
        const label = judicial ? 'ملف قضائي' : professionalTypeLabel(record.record_type);
        const reference = judicial ? `${record.case_number || ''}/${record.case_year || ''}` : record.file_code;
        return `<div class="case-card-item" data-id="${record.id}" onclick="${judicial ? `openCaseDetails('${record.id}')` : `selectProfessionalFile('${record.id}')`}">
          <div class="d-flex justify-content-between gap-2"><strong class="gold-text">${escapeHtml(record.client_name || record.title)}</strong><span class="badge ${judicial ? 'bg-primary' : 'bg-success'}">${label}</span></div>
          <div class="small mt-1">${escapeHtml(record.title || record.case_subject || '')}</div>${judicial ? `<span class="badge bg-light text-dark case-status-badge mt-1">${escapeHtml(record.status || 'جديدة')}</span>` : ''}
          <div class="small">${escapeHtml(judicial ? (record.court_name || 'محكمة غير محددة') : 'ملف بلا جلسات محكمة')}${judicial && record.case_type ? ` | ${escapeHtml(record.case_type)}` : ''}</div>
          <div class="small text-warning mt-1">الكود: ${escapeHtml(record.case_code || record.file_code || 'غير محدد')} · المرجع: ${escapeHtml(reference)}</div>
        </div>`;
    }).join('') : '<div class="text-center text-white-50 py-4">لا توجد ملفات مطابقة للبحث أو الفلاتر.</div>';
}
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
window.editProfessionalFile = async function(id) { const file = await db.officeFiles.get(id); if (!file) return; const f = file.metadata?.followup || {}; document.getElementById('editingProfessionalFileId').value = id; document.getElementById('professionalFileType').value = file.file_type; document.getElementById('professionalFileTitle').value = file.title || ''; document.getElementById('professionalAuthorityFileNumber').value = file.authority_file_number || ''; document.getElementById('professionalAuthorityFileYear').value = file.authority_file_year || ''; document.getElementById('professionalAuthorityName').value = file.authority_name || ''; document.getElementById('professionalClientName').value = file.client_name || ''; document.getElementById('professionalClientRole').value = file.client_role || ''; document.getElementById('professionalClientPhone').value = file.client_phone || ''; document.getElementById('professionalClientNationalId').value = file.client_national_id || ''; document.getElementById('professionalClientEmail').value = file.client_email || ''; document.getElementById('professionalClientAddress').value = file.client_address || ''; document.getElementById('professionalOpponentName').value = file.opponent_name || ''; document.getElementById('professionalOpponentRole').value = file.opponent_role || ''; document.getElementById('professionalOpponentPhone').value = file.opponent_phone || ''; document.getElementById('professionalOpponentNationalId').value = file.opponent_national_id || ''; document.getElementById('professionalOpponentEmail').value = file.opponent_email || ''; document.getElementById('professionalOpponentAddress').value = file.opponent_address || ''; document.getElementById('professionalFileDescription').value = file.description || ''; document.getElementById('professionalLastActionDate').value = f.last_action_date || ''; document.getElementById('professionalLastAction').value = f.last_action || ''; document.getElementById('professionalNextActionDate').value = f.next_action_date || ''; document.getElementById('professionalNextAction').value = f.next_action || ''; document.getElementById('professionalFileSaveButton').textContent = 'حفظ التعديلات'; showModal('professionalFileModal'); };
window.addProfessionalDocument = async function(id) { const file = await db.officeFiles.get(id); if (!file || !ipcRenderer?.selectProfessionalDocument) return; const sources = await ipcRenderer.selectProfessionalDocument(); if (!sources || !sources.length) return; const selected = await Swal.fire({ title: 'طريقة إضافة مستندات الملف', input: 'radio', inputOptions: { copy: 'نسخ المستندات مع إبقاء الأصل', move: 'نقل المستندات وحذف الأصل من مكانه' }, inputValue: 'copy', showCancelButton: true, confirmButtonText: 'متابعة', cancelButtonText: 'إلغاء', background: '#0f172a', color: '#fff' }); if (!selected.isConfirmed) return; const result = await ipcRenderer.copyProfessionalDocument(sources, file.file_code, file.client_name, file.file_type, selected.value || 'copy'); if (!result?.success) return Swal.fire('خطأ', result?.error || 'تعذر إضافة المستندات', 'error'); Swal.fire({ icon: 'success', title: selected.value === 'move' ? 'تم نقل المستندات' : 'تم نسخ المستندات', text: `عدد المستندات: ${result.count || 0}`, timer: 1500, showConfirmButton: false }); };
window.archiveProfessionalFile = async function(id) { const file=await db.officeFiles.get(id); if (!file) return; const result=await Swal.fire({title:'أرشفة الملف؟',text:file.title,icon:'warning',showCancelButton:true,confirmButtonText:'أرشفة',cancelButtonText:'إلغاء'}); if (!result.isConfirmed) return; await db.officeFiles.update(id,{archived:true,updated_at:new Date().toISOString()}); await db.pendingOperations.add({operation:'update_office_file',data:{id,archived:true},timestamp:Date.now()}); await loadCasesList(); document.getElementById('caseDetailContent').innerHTML='تمت أرشفة الملف'; };
window.deleteProfessionalFile = async function(id) { const file=await db.officeFiles.get(id); if (!file) return; const result=await Swal.fire({title:'حذف الملف نهائيًا؟',text:'سيتم حذف سجل الملف وإجراءاته من الجهاز.',icon:'warning',showCancelButton:true,confirmButtonText:'حذف نهائي',cancelButtonText:'إلغاء',confirmButtonColor:'#b43b45'}); if (!result.isConfirmed) return; await db.officeFiles.delete(id); await db.fileEvents.where('file_id').equals(id).delete(); await db.fees.delete(id); await db.payments.where('case_id').equals(id).delete(); await db.expenses.where('case_id').equals(id).delete(); await db.pendingOperations.add({operation:'delete_office_file',data:{id},timestamp:Date.now()}); await loadCasesList(); document.getElementById('caseDetailContent').innerHTML='تم حذف الملف'; };
window.openProfessionalFolder = async function(id) { const file = await db.officeFiles.get(id); if (file && ipcRenderer?.openProfessionalFileFolder) await ipcRenderer.openProfessionalFileFolder(file.file_code, file.client_name, file.file_type); };

window.openProfessionalActionModal = async function(id) { const file = await db.officeFiles.get(id || activeCaseId); if (!file) return; activeCaseId=file.id; document.getElementById('professionalActionDate').value=new Date().toISOString().slice(0,10); ['professionalActionDone','professionalActionNext','professionalActionNextDate'].forEach(x=>document.getElementById(x).value=''); showModal('professionalActionModal'); };
window.saveProfessionalAction = async function() { const file=await db.officeFiles.get(activeCaseId); if (!file) return; const done=document.getElementById('professionalActionDone').value.trim(); const next=document.getElementById('professionalActionNext').value.trim(); const date=document.getElementById('professionalActionDate').value; const nextDate=document.getElementById('professionalActionNextDate').value; if (!done && !next) return Swal.fire('تنبيه','أدخل الإجراء المنفذ أو الإجراء القادم','warning'); const event={id:generateUUID(),office_id:currentOfficeId,file_id:file.id,event_date:date||new Date().toISOString(),event_type:'procedure',status:'مفتوح',title:done||'موعد قادم',details:next||'',client_visible:true,metadata:{next_action_date:nextDate||null},created_at:new Date().toISOString()}; await db.fileEvents.add(event); const metadata={...(file.metadata||{}),followup:{last_action_date:date||null,last_action:done,next_action_date:nextDate||null,next_action:next}}; await db.officeFiles.update(file.id,{metadata,updated_at:new Date().toISOString()}); await db.pendingOperations.bulkAdd([{operation:'insert_file_event',data:event,timestamp:Date.now()},{operation:'update_office_file',data:{id:file.id,metadata,updated_at:new Date().toISOString()},timestamp:Date.now()}]); hideModal('professionalActionModal'); await selectProfessionalFile(file.id); };

function partyCardHtml(title, party, roleKey = 'role') {
    const p = party || {};
    return `<div class="party-card"><h6 class="gold-text mb-2">${title}</h6><div class="row g-2"><div class="col-md-6"><strong>الاسم:</strong> ${escapeHtml(p.name || '-')}</div><div class="col-md-6"><strong>الصفة:</strong> ${escapeHtml(p[roleKey] || '-')}</div><div class="col-md-6"><strong>الرقم القومي:</strong> ${escapeHtml(p.nationalId || '-')}</div><div class="col-md-6"><strong>الهاتف:</strong> ${escapeHtml(p.phone || '-')}</div><div class="col-12"><strong>العنوان:</strong> ${escapeHtml(p.address || '-')}</div><div class="col-12"><strong>البريد الإلكتروني:</strong> ${escapeHtml(p.email || '-')}</div></div></div>`;
}
window.openPartyDetails = async function(kind) {
    const record = await db.cases.get(activeCaseId) || await db.officeFiles.get(activeCaseId);
    if (!record) return;
    const isClient = kind === 'client';
    const party = { name: isClient ? record.client_name : record.opponent_name, role: isClient ? (record.client_role || '') : (record.opponent_role || ''), nationalId: isClient ? record.client_national_id : record.opponent_national_id, phone: isClient ? record.client_phone : record.opponent_phone, address: isClient ? record.client_address : record.opponent_address, email: isClient ? record.client_email : record.opponent_email };
    await Swal.fire({ title: isClient ? 'بيانات العميل' : 'بيانات الخصم', html: partyCardHtml('', party), confirmButtonText: 'إغلاق', background: '#ffffff', color: '#172b45' });
};
function detailActionsHtml(isJudicial, id) {
    const q = escapeHtml(id);
    const mutationActions = currentUserRole === 'manager' ? `<button class="btn btn-outline-warning" onclick="${isJudicial ? 'openEditCaseModalFromPanel()' : `editProfessionalFile('${q}')`}"><i class="bi bi-pencil"></i> تعديل</button><button class="btn btn-outline-danger" onclick="${isJudicial ? 'showCaseOptions()' : `deleteProfessionalFile('${q}')`}"><i class="bi bi-trash"></i> حذف</button><button class="btn btn-outline-secondary" onclick="${isJudicial ? 'archiveCase(activeCaseId)' : `archiveProfessionalFile('${q}')`}"><i class="bi bi-archive"></i> أرشفة</button>` : '';
    return `<div class="detail-action-grid"><button class="btn btn-outline-info" onclick="openPartyDetails('client')"><i class="bi bi-person-vcard"></i> بيانات العميل</button><button class="btn btn-outline-danger" onclick="openPartyDetails('opponent')"><i class="bi bi-person-badge"></i> بيانات الخصم</button><button class="btn btn-outline-info" onclick="${isJudicial ? 'addCaseDocument()' : `addProfessionalDocument('${q}')`}"><i class="bi bi-file-earmark-plus"></i> مستند +</button><button class="btn btn-outline-warning" onclick="${isJudicial ? 'addCaseDocument()' : `addProfessionalDocument('${q}')`}"><i class="bi bi-journal-plus"></i> مذكرة أو صحيفة +</button><button class="btn btn-outline-primary" onclick="${isJudicial ? "showCasePanelSection('sessions')" : `openProfessionalActionModal('${q}')`}"><i class="bi bi-calendar-check"></i> ${isJudicial ? 'الجلسات' : 'الإجراءات'}</button><button class="btn btn-success" onclick="openFeesModal(activeCaseId)"><i class="bi bi-cash-coin"></i> الأتعاب</button>${isJudicial && currentUserRole === 'manager' ? '<button class="btn btn-outline-secondary" onclick="openTeamNotes(activeCaseId)"><i class="bi bi-journal-text"></i> ملاحظات الفريق</button>' : ''}${mutationActions}</div>`;
}

window.selectProfessionalFile = async function(id) {
    const file = await db.officeFiles.get(id); if (!file) return;
    activeCaseId = id;
    const followup = file.metadata?.followup || {};
    document.getElementById('caseDetailContent').innerHTML = `<div class="record-detail"><div class="record-code">كود الملف: ${escapeHtml(file.file_code)}</div><div class="record-row"><strong>نوع الملف:</strong> ${escapeHtml(professionalTypeLabel(file.file_type))}</div><div class="record-row"><strong>اسم الملف:</strong> ${escapeHtml(file.title)}</div>${partyCardHtml('بيانات العميل', {name:file.client_name, role:file.client_role, nationalId:file.client_national_id, phone:file.client_phone, address:file.client_address, email:file.client_email})}${partyCardHtml('بيانات الخصم', {name:file.opponent_name, role:file.opponent_role, nationalId:file.opponent_national_id, phone:file.opponent_phone, address:file.opponent_address, email:file.opponent_email})}<div class="record-row"><strong>الوصف:</strong> ${escapeHtml(file.description || '-')}</div><div class="record-row"><strong>آخر إجراء:</strong> ${escapeHtml(followup.last_action || '-')} ${followup.last_action_date ? `(${escapeHtml(followup.last_action_date)})` : ''}</div><div class="record-row"><strong>الإجراء القادم:</strong> ${escapeHtml(followup.next_action || '-')} ${followup.next_action_date ? `(${escapeHtml(followup.next_action_date)})` : ''}</div></div>`;
    const events = await db.fileEvents.where('file_id').equals(id).toArray();
    document.getElementById('caseDetailSessions').innerHTML = events.length ? events.sort((a,b)=>new Date(b.event_date)-new Date(a.event_date)).map(e=>`<div class="small border-bottom py-1">${new Date(e.event_date).toLocaleString('ar-EG')} - ${escapeHtml(e.title)} (${escapeHtml(e.status)})${e.metadata?.next_action_date ? ` — القادم: ${escapeHtml(e.metadata.next_action_date)}` : ''}</div>`).join('') : 'لا توجد إجراءات';
    document.getElementById('caseActionsPanel').innerHTML = `<button class="btn btn-sm btn-outline-success" onclick="openProfessionalActionModal('${escapeHtml(file.id)}')"><i class="bi bi-calendar-plus"></i> إضافة إجراء</button>${detailActionsHtml(false, file.id)}`;
    showCasePanelSection('data');
};

// إضافة قضية جديدة
// توليد كود القضية محليًا داخل qayd؛ قاعدة البيانات لا تنشئ الكود ولا تستبدله.
async function generateCaseCode() {
    const prefix = 'JELR'; // اختصار JAD ELRAB LAW FIRM للحفاظ على الهوية الموحدة.
    const year = String(new Date().getFullYear()).slice(-2);
    const randomPart = () => {
        const bytes = new Uint8Array(4);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
    };

    // نبدأ برقم تسلسلي محلي، ثم نتحقق من عدم تكرار الكود في IndexedDB.
    const localCount = await db.cases.count();
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const sequence = String(localCount + attempt + 1).padStart(4, '0');
        const candidate = `${prefix}-${year}-${sequence}-${randomPart()}`;
        if (!(await db.cases.where('case_code').equals(candidate).count())) return candidate;
    }
    throw new Error('تعذر توليد كود قضية محلي فريد');
}

// حاجز موحد يمنع الحفظ أو المزامنة أو إنشاء المجلد بدون كود صالح.
function assertValidCaseCode(caseCode) {
    if (typeof caseCode !== 'string' || !/^JELR-[0-9]{2}-[0-9]{4}-[A-Z0-9]{6}$/.test(caseCode.trim())) {
        throw new Error('كود القضية غير موجود أو لا يطابق صيغة JELR المعتمدة');
    }
    return caseCode.trim();
}

let casePartyRowCounter = 0;
window.addCasePartyRow = function(type) {
    const host = document.getElementById(type === 'client' ? 'additionalClients' : 'additionalOpponents');
    if (!host) return;
    const key = `${type}_${++casePartyRowCounter}`;
    host.insertAdjacentHTML('beforeend', `<div class="col-12 border rounded p-2 mt-2" data-party-row="${key}"><div class="row g-2"><div class="col-md-4"><input class="form-control party-name" placeholder="اسم ${type === 'client' ? 'العميل' : 'الخصم'}"></div><div class="col-md-3"><input class="form-control party-role" placeholder="الصفة"></div><div class="col-md-3"><input class="form-control party-phone" placeholder="الهاتف"></div><div class="col-md-2"><button type="button" class="btn btn-outline-danger w-100" onclick="this.closest('[data-party-row]').remove()">حذف</button></div><div class="col-md-3"><input class="form-control party-power-number" placeholder="رقم التوكيل"></div><div class="col-md-2"><input class="form-control party-power-year" placeholder="سنة التوكيل"></div><div class="col-md-4"><input class="form-control party-notary" placeholder="مكتب التوثيق"></div><div class="col-md-3"><input class="form-control party-national-id" placeholder="الرقم القومي"></div></div></div>`);
};
function collectAdditionalParties(caseId) {
    const rows = [];
    for (const type of ['client', 'opponent']) document.querySelectorAll(`#${type === 'client' ? 'additionalClients' : 'additionalOpponents'} [data-party-row]`).forEach(row => {
        const name = row.querySelector('.party-name')?.value.trim(); if (!name) return;
        rows.push({ id: generateUUID(), office_id: currentOfficeId, case_id: caseId, party_type: type, name, role: row.querySelector('.party-role')?.value.trim() || '', phone: row.querySelector('.party-phone')?.value.trim() || '', national_id: row.querySelector('.party-national-id')?.value.trim() || '', power_of_attorney_number: row.querySelector('.party-power-number')?.value.trim() || '', power_of_attorney_year: row.querySelector('.party-power-year')?.value.trim() || '', notary_office: row.querySelector('.party-notary')?.value.trim() || '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    });
    return rows;
}
window.openAddCaseModal = () => { casePartyRowCounter = 0; document.getElementById('additionalClients').innerHTML = ''; document.getElementById('additionalOpponents').innerHTML = ''; showModal('addCaseModal'); };
window.saveNewCase = async function() {
    const caseData = {
        id: 'C_' + Date.now(),
        office_id: currentOfficeId,
        client_name: document.getElementById('client_name').value,
        client_phone: document.getElementById('client_phone').value,
        client_national_id: document.getElementById('client_national_id')?.value || '',
        client_email: document.getElementById('client_email').value,
        client_address: document.getElementById('client_address')?.value || '',
        client_role: document.getElementById('client_role').value,
        opponent_name: document.getElementById('opponent_name').value,
        opponent_role: document.getElementById('opponent_role')?.value || '',
        opponent_national_id: document.getElementById('opponent_national_id')?.value || '',
        opponent_email: document.getElementById('opponent_email')?.value || '',
        opponent_phone: document.getElementById('opponent_phone')?.value || '',
        opponent_address: document.getElementById('opponent_address')?.value || '',
        case_number: document.getElementById('case_number').value,
            case_year: document.getElementById('case_year').value,
                court_name: document.getElementById('court_name').value,
                circuit: document.getElementById('circuit').value,
                case_type: document.getElementById('case_type').value,
                        case_subject: document.getElementById('case_subject').value,
                        category: document.getElementById('case_type').value,
                        proceeding_type: document.getElementById('case_stage')?.value || 'first_instance',
                        importance: document.getElementById('case_importance')?.value || 'normal',
                        alert_notes: document.getElementById('case_alert_notes')?.value || '',
                        status: document.getElementById('case_status')?.value || 'جديدة',
                        city: document.getElementById('case_city')?.value || '',
                        // يجب توليد الكود قبل إنشاء الكائن وقبل أي كتابة في IndexedDB.
                        case_code: await generateCaseCode(),
                            archived: 0
    };

        // التحقق النهائي قبل الحفظ المحلي؛ لا نسمح بإنشاء قضية ناقصة الكود.
    caseData.case_code = assertValidCaseCode(caseData.case_code);
    const now = new Date().toISOString();
    const legalFile = { id: `LF-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, office_id: currentOfficeId, file_code: caseData.case_code, file_type: 'judicial', title: caseData.case_subject || `ملف ${caseData.client_name}`, status: 'new', client_name: caseData.client_name, client_phone: caseData.client_phone, client_email: caseData.client_email, client_national_id: caseData.client_national_id, client_address: caseData.client_address, description: caseData.case_subject || '', opened_at: now.slice(0, 10), metadata: { source: 'case_creation' }, created_at: now, updated_at: now };
    const proceeding = { id: `PR-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, legal_file_id: legalFile.id, office_id: currentOfficeId, proceeding_type: caseData.proceeding_type, court_name: caseData.court_name, circuit: caseData.circuit, case_number: caseData.case_number, case_year: caseData.case_year, city: caseData.city, client_position: caseData.client_role, opponent_name: caseData.opponent_name, status: 'open', metadata: {}, created_at: now, updated_at: now };
    caseData.legal_file_id = legalFile.id;
    caseData.proceeding_id = proceeding.id;
    await db.legalFiles.put(legalFile);
    await db.proceedings.put(proceeding);
    await db.pendingOperations.add({ operation: 'upsert_legal_file', data: legalFile, timestamp: Date.now() });
    await db.pendingOperations.add({ operation: 'upsert_proceeding', data: proceeding, timestamp: Date.now() });
    await db.cases.add(caseData);
    const primaryParties = [
        { id: generateUUID(), office_id: currentOfficeId, case_id: caseData.id, party_type: 'client', name: caseData.client_name, role: caseData.client_role, phone: caseData.client_phone, national_id: caseData.client_national_id, email: caseData.client_email, address: caseData.client_address, power_of_attorney_number: document.getElementById('client_power_number')?.value || '', power_of_attorney_year: document.getElementById('client_power_year')?.value || '', notary_office: document.getElementById('client_notary_office')?.value || '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ...(caseData.opponent_name ? [{ id: generateUUID(), office_id: currentOfficeId, case_id: caseData.id, party_type: 'opponent', name: caseData.opponent_name, role: caseData.opponent_role, phone: caseData.opponent_phone, national_id: caseData.opponent_national_id, email: caseData.opponent_email, address: caseData.opponent_address, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] : [])
    ];
    const partyRows = [...primaryParties, ...collectAdditionalParties(caseData.id)];
    if (partyRows.length) { await db.caseParties.bulkAdd(partyRows); for (const party of partyRows) await db.pendingOperations.add({ operation: 'upsert_case_party', data: party, timestamp: Date.now() }); }
    if (supabaseClient && currentOfficeId) {
        try {
            const { error: fileError } = await supabaseClient.from('legal_files').upsert([legalFile], { onConflict: 'id' });
            if (fileError) throw fileError;
            const { error: proceedingError } = await supabaseClient.from('proceedings').upsert([proceeding], { onConflict: 'id' });
            if (proceedingError) throw proceedingError;
            const { data: inserted, error } = await supabaseClient.from('cases').insert([caseData]).select('case_code');
            if (!error && inserted && inserted[0] && inserted[0].case_code === caseData.case_code) {
                // يجب أن يعيد الخادم نفس الكود الذي ولّده qayd، وليس كودًا جديدًا.
                const confirmedCode = assertValidCaseCode(inserted[0].case_code);
                Swal.fire({ icon: 'success', title: 'تم الحفظ', text: `كود القضية: ${confirmedCode}`, background: '#0f172a', color: '#fff', timer: 2000, showConfirmButton: false });
            } else {
                await db.pendingOperations.add({ operation: 'insert_case', data: caseData, timestamp: Date.now() });
                Swal.fire({ icon: 'warning', title: 'تم الحفظ محلياً', text: 'سيتم المزامنة عند الاتصال بالإنترنت', background: '#0f172a', color: '#fff' });
            }
        } catch (err) {
            console.error('فشل الإدراج المباشر:', err);
            await db.pendingOperations.add({ operation: 'insert_case', data: caseData, timestamp: Date.now() });
            Swal.fire({ icon: 'warning', title: 'تم الحفظ محلياً', text: 'سيتم المزامنة لاحقاً', background: '#0f172a', color: '#fff' });
        }
    } else {
        await db.pendingOperations.add({ operation: 'insert_case', data: caseData, timestamp: Date.now() });
        Swal.fire({ icon: 'info', title: 'تم الحفظ محلياً', text: 'قم بالمزامنة للحصول على الكود الدائم', background: '#0f172a', color: '#fff' });
    }

    let feeTotal = parseFloat(document.getElementById('fee_total').value);
    if (feeTotal > 0) {
        let feePaid = parseFloat(document.getElementById('fee_paid').value) || 0;
        await db.fees.put({ case_id: caseData.id, total: feeTotal, paid: feePaid, remaining: feeTotal - feePaid, notes: document.getElementById('fee_notes').value });
        if (feePaid > 0) await db.payments.add({ case_id: caseData.id, amount: feePaid, date: new Date().toISOString().split('T')[0], note: 'دفعة مقدمة' });
    }
    const initialExpense = parseFloat(document.getElementById('case_expense_amount')?.value) || 0;
    if (initialExpense > 0) await db.expenses.add({ office_id: currentOfficeId, owner_id: caseData.id, case_id: caseData.id, amount: initialExpense, date: new Date().toISOString().split('T')[0], category: document.getElementById('case_expense_category')?.value || 'مصروف ابتدائي' });

    // إنشاء المجلد لا يتم إلا بعد نجاح التحقق من الكود المحلي.
    if (ipcRenderer?.createCaseFolder) {
        ipcRenderer.createCaseFolder(assertValidCaseCode(caseData.case_code), caseData.client_name, caseData);
    }

    hideModal('addCaseModal');
    document.getElementById('caseFormModal').reset();
    document.getElementById('feesSectionModal').style.display = 'none';
    loadCasesList();
    updatePendingBadge();
};
window.toggleFeesSectionModal = function() { let s = document.getElementById('feesSectionModal'); if (s) s.style.display = s.style.display === 'none' ? 'block' : 'none'; };

// القوالب والملاحظات
async function ensureCaseFolder() {
    let c = await db.cases.get(activeCaseId);
    if (!c) return null;
    const caseCode = assertValidCaseCode(c.case_code);
    let folderName = `${caseCode} - ${c.client_name}`.replace(/[<>:"\/\\|?*]/g, '_');
    if (ipcRenderer) {
        let res = await ipcRenderer.openCaseFolder(folderName);
        if (!res.success && ipcRenderer.createCaseFolder) await ipcRenderer.createCaseFolder(caseCode, c.client_name, c);
    }
    return folderName;
}
window.openTemplate = async function(type) {
    if (!activeCaseId) return Swal.fire('تنبيه', 'اختر قضية أولاً', 'warning');
    let folderName = await ensureCaseFolder();
    if (!folderName) return;
    let templateMap = { memo: 'مذكرة.docx', announcement: 'إعلان.docx', pleading: 'لائحة_دعوى.docx' };
    let fileName = templateMap[type] || 'مذكرة.docx';
    let result = await ipcRenderer.openTemplate(folderName, fileName);
    if (result && result.error) Swal.fire('خطأ', result.error, 'error');
};
window.openNotes = async function() {
    if (!activeCaseId) return Swal.fire('تنبيه', 'اختر قضية أولاً', 'warning');
    let folderName = await ensureCaseFolder();
    if (!folderName) return;
    let result = await ipcRenderer.openNotes(folderName);
    if (result && result.error) Swal.fire('خطأ', result.error, 'error');
};

// ========== 9. الجلسات ==========
window.searchCasesForSession = async function(q) {
    if (q.length < 2) { document.getElementById('caseSearchResults').style.display = 'none'; return; }
    try {
        const cases = await db.cases.filter(c => !c.archived && c.office_id === currentOfficeId).filter(c => String(c.client_name).includes(q) || String(c.case_number).includes(q) || String(c.case_code).toLowerCase().includes(q.toLowerCase())).limit(10).toArray();
        let html = cases.map(c => `<div class="p-2 border-bottom border-secondary text-white" style="cursor:pointer" onclick="selectCaseForSession('${c.id}')"><span class="text-warning">${c.case_code}</span> - ${c.client_name} (${c.case_number})</div>`).join('');
        const resDiv = document.getElementById('caseSearchResults');
        resDiv.innerHTML = html; resDiv.style.display = html ? 'block' : 'none';
    } catch (e) { }
};
window.selectCaseForSession = async function(id) {
    activeCaseId = id;
    document.getElementById('caseSearchResults').style.display = 'none';
    try {
        const c = await db.cases.get(id);
        if (c) {
            document.getElementById('s_case_code').value = c.case_code;
            document.getElementById('s_case_number').value = c.case_number;
            document.getElementById('s_case_year').value = c.case_year;
            document.getElementById('s_court').value = c.court_name;
            document.getElementById('s_circuit').value = c.circuit || '';
            document.getElementById('s_city').value = c.city || '';
            document.getElementById('s_client').value = c.client_name;
            document.getElementById('s_client_role').value = c.client_role;
            document.getElementById('s_opponent').value = c.opponent_name || 'لا يوجد';
        }
    } catch (e) { }
};
window.saveSession = async function() {
    if (!ownerOnly('إضافة جلسة')) return;
    if (!activeCaseId || !document.getElementById('s_date').value) { Swal.fire('تنبيه', 'اختر قضية وأدخل التاريخ', 'warning'); return; }
    const sessionData = { id: 'S_' + Date.now(), office_id: currentOfficeId, case_id: activeCaseId, session_date: document.getElementById('s_date').value, case_status: document.getElementById('s_case_status').value, decision: document.getElementById('s_decision').value, court_name: document.getElementById('s_court').value, circuit: document.getElementById('s_circuit').value, city: document.getElementById('s_city').value, required_action: document.getElementById('s_required_action').value, responsible_name: document.getElementById('s_responsible').value, followup_date: document.getElementById('s_followup').value || null };
    await db.sessions.add(sessionData);
    await db.sessionChangeLog.add({ office_id: currentOfficeId, session_id: sessionData.id, action: 'created', old_data: {}, new_data: sessionData, changed_at: new Date().toISOString() });
    await db.pendingOperations.add({ operation: 'insert_session', data: sessionData, timestamp: Date.now() });
    Swal.fire({ icon: 'success', title: 'تم الحفظ محلياً', background: '#0f172a', showConfirmButton: false, timer: 1500 });
    ['s_decision','s_required_action','s_responsible','s_followup'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    loadUpcomingSessions('week'); renderCalendar(); updatePendingBadge();
};
window.loadUpcomingSessions = async function(range, btn) {
    if (btn) { document.querySelectorAll('#sessions .btn-group .btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    const now = new Date(); const start = now.toISOString().split('T')[0]; const end = new Date();
    if (range === 'week') end.setDate(now.getDate() + 7); else end.setMonth(now.getMonth() + 1);
    const endStr = end.toISOString().split('T')[0];
    try {
        const sessions = await db.sessions.where('session_date').between(start, endStr, true, true).filter(s => s.office_id === currentOfficeId).toArray();
        sessions.sort((a, b) => a.session_date.localeCompare(b.session_date));
        let html = '';
        for (let s of sessions) {
            const c = await db.cases.get(s.case_id);
            if (c) html += `<div class="session-card" onclick="openCaseDetails('${c.id}')"><div class="d-flex justify-content-between"><span class="gold-text">${new Date(s.session_date).toLocaleString('ar-EG', { dateStyle: 'full', timeStyle: 'short' })}</span><span class="case-status status-new">${s.case_status}</span></div><div class="mt-2"><strong>${c.client_name || 'عميل غير مسجل'}</strong> - ${c.case_number || 'رقم غير مسجل'}${c.case_year ? '/' + c.case_year : ''}</div><div class="mt-1 text-white-50">${c.court_name || 'محكمة غير مسجلة'} · ${c.circuit || 'دائرة غير مسجلة'}</div><div class="mt-1 text-white">${s.decision || ''}</div></div>`;
        }
        document.getElementById('upcomingSessionsList').innerHTML = html || '<div class="text-muted">لا توجد جلسات في هذه الفترة</div>';
    } catch (e) { }
};
window.openEditSession = async function(id) {
    if (!ownerOnly('تعديل الجلسة')) return;
    activeSessionId = id;
    const s = await db.sessions.get(id);
    if (!s) return;
    document.getElementById('edit_s_date').value = s.session_date.slice(0, 16);
    document.getElementById('edit_s_status').value = s.case_status;
    document.getElementById('edit_s_decision').value = s.decision || '';
    document.getElementById('edit_s_court').value = s.court_name || '';
    document.getElementById('edit_s_circuit').value = s.circuit || '';
    document.getElementById('edit_s_city').value = s.city || '';
    document.getElementById('edit_s_required_action').value = s.required_action || '';
    document.getElementById('edit_s_responsible').value = s.responsible_name || '';
    document.getElementById('edit_s_followup').value = s.followup_date || '';
    hideModal('caseModal'); showModal('editSessionModal');
};
window.cancelEditSession = function() { hideModal('editSessionModal'); openCaseDetails(activeCaseId); };
window.saveEditedSession = async function() {
    if (!ownerOnly('تعديل الجلسة')) return;
    const previous = await db.sessions.get(activeSessionId);
    const updated = { session_date: document.getElementById('edit_s_date').value, case_status: document.getElementById('edit_s_status').value, decision: document.getElementById('edit_s_decision').value, court_name: document.getElementById('edit_s_court').value, circuit: document.getElementById('edit_s_circuit').value, city: document.getElementById('edit_s_city').value, required_action: document.getElementById('edit_s_required_action').value, responsible_name: document.getElementById('edit_s_responsible').value, followup_date: document.getElementById('edit_s_followup').value || null };
    await db.sessions.update(activeSessionId, updated);
    await db.sessionChangeLog.add({ office_id: currentOfficeId, session_id: activeSessionId, action: 'updated', old_data: previous || {}, new_data: { ...previous, ...updated }, changed_at: new Date().toISOString() });
    await db.pendingOperations.add({ operation: 'update_session', data: { id: activeSessionId, ...updated }, timestamp: Date.now() });
    hideModal('editSessionModal');
    openCaseDetails(activeCaseId);
    renderCalendar(); loadUpcomingSessions('week'); updatePendingBadge();
};

// ========== 10. الأجندة والأحداث ==========
window.changeMonth = function(dir) { currentDate.setMonth(currentDate.getMonth() + dir); renderCalendar(); };
window.renderCalendar = async function() {
    const year = currentDate.getFullYear(), month = currentDate.getMonth();
    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    document.getElementById('calendarMonthYear').innerText = `${monthNames[month]} ${year}`;
    const weekDays = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
    document.getElementById('calendarHeaders').innerHTML = weekDays.map(d => `<div class="calendar-header">${d}</div>`).join('');
    const firstDay = new Date(year, month, 1);
    let startDayIdx = firstDay.getDay(); let offset = startDayIdx === 0 ? 6 : startDayIdx - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    try {
        let sessions = await db.sessions.filter(s => s.office_id === currentOfficeId).toArray();
        let events = await db.events.toArray();
        let tasks = await db.tasks.toArray();
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        let html = '';
        for (let i = 0; i < offset; i++) html += '<div class="calendar-day empty"></div>';
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
            const dSess = sessions.filter(s => s.session_date && s.session_date.startsWith(dateStr));
            const dEvt = events.filter(e => e.date === dateStr);
            const dTask = tasks.filter(t => t.date === dateStr && !t.completed);
            let isToday = (dateStr === new Date().toISOString().split('T')[0]);
            let badges = '';
            for (let s of dSess) badges += `<div class="day-badge badge-session" title="${s.case_status}" onclick="event.stopPropagation(); openRescheduleModal('${s.id}')">⚖️ جلسة ${s.session_date.slice(11, 16)}</div>`;
            for (let e of dEvt) badges += `<div class="day-badge badge-event" title="${e.title}">📅 ${e.title}</div>`;
            for (let t of dTask) badges += `<div class="day-badge badge-task" title="${t.description}">📌 ${t.description}</div>`;
            html += `<div class="calendar-day ${isToday ? 'today' : ''}" onclick="showDayDetails('${dateStr}')"><div class="day-number">${d}</div><div class="d-flex flex-column gap-1 w-100">${badges}</div></div>`;
        }
        document.getElementById('calendarDays').innerHTML = html;
        const monthList = document.getElementById('agendaMonthCases');
        if (monthList) { const caseMap = new Map((await db.cases.toArray()).map(c => [String(c.id), c])); const monthRows = sessions.filter(s => s.session_date && s.session_date.startsWith(monthStr)).sort((a,b) => String(a.session_date).localeCompare(String(b.session_date))); monthList.innerHTML = monthRows.length ? monthRows.map(s => { const c = caseMap.get(String(s.case_id)); return `<div class="agenda-month-item" onclick="openCaseDetails('${escapeHtml(s.case_id)}')"><div class="date">${escapeHtml(String(s.session_date).slice(0,16).replace('T',' '))}</div><strong>${escapeHtml(c?.client_name || 'قضية غير معروفة')}</strong><div class="small text-muted">${escapeHtml(c?.case_code || '')} · ${escapeHtml(s.court_name || c?.court_name || 'المحكمة غير محددة')}</div><span class="badge bg-secondary mt-1">${escapeHtml(s.case_status || 'جديدة')}</span></div>`; }).join('') : '<div class="text-muted text-center py-3">لا توجد جلسات أو قضايا مجدولة في هذا الشهر.</div>'; }
        loadUpcomingEvents();
    } catch (e) { console.error('خطأ في renderCalendar:', e); }
};
window.showDayDetails = async function(dateStr) {
    currentSelectedDateStr = dateStr;
    document.getElementById('dayModalTitle').innerText = `تفاصيل يوم ${dateStr}`;
    try {
        let sessions = await db.sessions.filter(s => s.session_date && s.session_date.startsWith(dateStr) && s.office_id === currentOfficeId).toArray();
        let events = await db.events.where('date').equals(dateStr).toArray();
        let tasks = await db.tasks.where('date').equals(dateStr).toArray();
        let html = `<h6 class="gold-text"><i class="bi bi-briefcase"></i> الجلسات</h6>`;
        if (sessions.length === 0) html += `<p class="small text-muted">لا يوجد</p>`;
        for (let s of sessions) {
            const c = await db.cases.get(s.case_id);
            html += `<div class="p-2 mb-2 bg-dark rounded border border-danger cursor-pointer" onclick="hideModal('dayModal'); openCaseDetails('${c.id}')">${c?.client_name || 'غير معروف'} - ${s.case_status} <button class="btn btn-sm btn-outline-warning ms-2" onclick="event.stopPropagation(); openRescheduleModal('${s.id}')">ترحيل</button></div>`;
        }
        html += `<hr class="border-secondary"><h6 class="gold-text"><i class="bi bi-calendar-event"></i> الأحداث</h6>`;
        if (events.length === 0) html += `<p class="small text-muted">لا يوجد</p>`;
        for (let e of events) html += `<div class="p-2 mb-2 bg-dark rounded border border-success d-flex justify-content-between align-items-center gap-2"><span>${escapeHtml(e.title)}</span><span class="text-nowrap"><button class="btn btn-sm btn-outline-warning" onclick="openEditEvent(${e.id})" title="تعديل"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger ms-1" onclick="deleteEvent(${e.id})" title="حذف"><i class="bi bi-trash"></i></button></span></div>`;
        html += `<hr class="border-secondary"><h6 class="gold-text"><i class="bi bi-list-check"></i> المهام</h6>`;
        if (tasks.length === 0) html += `<p class="small text-muted">لا يوجد</p>`;
        for (let t of tasks) html += `<div class="p-2 mb-2 bg-dark rounded border border-warning d-flex justify-content-between align-items-center"><span style="text-decoration:${t.completed ? 'line-through' : 'none'}">${t.description}</span><input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTask('${t.id}', this.checked)"></div>`;
        document.getElementById('dayModalContent').innerHTML = html;
        showModal('dayModal');
    } catch (e) { console.error(e); }
};
window.toggleTask = async function(id, status) { await db.tasks.update(id, { completed: status }); await queueTaskSync(id, 'update'); showDayDetails(currentSelectedDateStr); renderCalendar(); };
let editingEventId = null;
window.openEditEvent = async function(id) {
    const event = await db.events.get(Number(id));
    if (!event) return Swal.fire('تنبيه', 'الحدث غير موجود', 'warning');
    editingEventId = event.id;
    document.getElementById('editEventTitle').value = event.title || '';
    document.getElementById('editEventDate').value = event.date || '';
    document.getElementById('editEventType').value = event.type || 'other';
    showModal('editEventModal');
};
window.saveEditedEvent = async function() {
    if (editingEventId === null) return;
    const title = document.getElementById('editEventTitle').value.trim();
    const date = document.getElementById('editEventDate').value;
    const type = document.getElementById('editEventType').value || 'other';
    if (!title || !date) return Swal.fire('تنبيه', 'أدخل وصف الحدث وتاريخه', 'warning');
    await db.events.update(editingEventId, { title, date, type });
    await queueEventSync(editingEventId, 'update');
    hideModal('editEventModal');
    editingEventId = null;
    await renderCalendar();
    if (currentSelectedDateStr) await showDayDetails(currentSelectedDateStr);
    await loadUpcomingEvents();
};
window.deleteEvent = async function(id) {
    const event = await db.events.get(Number(id));
    if (!event) return;
    const result = await Swal.fire({ title: 'حذف الحدث؟', text: event.title || '', icon: 'warning', showCancelButton: true, confirmButtonText: 'حذف', cancelButtonText: 'إلغاء', confirmButtonColor: '#b43b45' });
    if (!result.isConfirmed) return;
    await queueEventDelete(Number(id));
    await db.events.delete(Number(id));
    if (editingEventId === Number(id)) { hideModal('editEventModal'); editingEventId = null; }
    await renderCalendar();
    if (currentSelectedDateStr) await showDayDetails(currentSelectedDateStr);
    await loadUpcomingEvents();
};
window.deleteEditingEvent = async function() { if (editingEventId !== null) await deleteEvent(editingEventId); };
window.addNewEvent = async function() {
    const t = document.getElementById('newEventTitle').value, d = document.getElementById('newEventDate').value, type = document.getElementById('newEventType').value;
    if (!t || !d) return;
    try {
        if (type === 'task') { const id = await db.tasks.add({ office_id: currentOfficeId, description: t, date: d, completed: false }); await queueTaskSync(id, 'insert'); }
        else { const id = await db.events.add({ office_id: currentOfficeId, title: t, date: d, type: 'other', created_at: new Date().toISOString() }); await queueEventSync(id, 'insert'); }
        document.getElementById('newEventTitle').value = ''; renderCalendar();
    } catch (e) { }
};
window.openAgendaItemModal = function(type = 'event') {
    document.getElementById('agendaItemType').value = type;
    document.getElementById('agendaItemTitle').value = '';
    document.getElementById('agendaItemDate').value = currentSelectedDateStr || new Date().toISOString().slice(0, 10);
    showModal('agendaItemModal');
};
window.saveAgendaItemFromModal = async function() {
    const type = document.getElementById('agendaItemType').value;
    const title = document.getElementById('agendaItemTitle').value.trim();
    const date = document.getElementById('agendaItemDate').value;
    if (!title || !date) return Swal.fire('تنبيه', 'أدخل العنوان والتاريخ', 'warning');
    if (type === 'task') { const id = await db.tasks.add({ office_id: currentOfficeId, description: title, date, completed: false }); await queueTaskSync(id, 'insert'); }
    else { const id = await db.events.add({ office_id: currentOfficeId, title, date, type: 'other', created_at: new Date().toISOString() }); await queueEventSync(id, 'insert'); }
    hideModal('agendaItemModal'); await renderCalendar(); await loadUpcomingEvents();
    Swal.fire({ icon: 'success', title: 'تمت الإضافة', timer: 1200, showConfirmButton: false });
};
window.openDeadlineCalculatorModal = function() {
    document.getElementById('modalCalcStartDate').value = currentSelectedDateStr || new Date().toISOString().slice(0, 10);
    document.getElementById('modalCalcDays').value = 15;
    document.getElementById('modalCalcResult').innerText = '';
    showModal('deadlineCalculatorModal');
};
window.calculateModalDate = function() {
    const start = document.getElementById('modalCalcStartDate').value;
    const days = Number(document.getElementById('modalCalcDays').value || 0);
    if (!start) return Swal.fire('تنبيه', 'اختر تاريخ البداية', 'warning');
    const date = new Date(`${start}T00:00:00`); date.setDate(date.getDate() + days);
    window.modalCalculatedDate = date.toISOString().slice(0, 10);
    document.getElementById('modalCalcResult').innerText = date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
};
window.saveCalculatedModalItem = async function(type) {
    if (!window.modalCalculatedDate) calculateModalDate();
    if (!window.modalCalculatedDate) return;
    const result = await Swal.fire({ title: type === 'task' ? 'وصف المهمة' : 'وصف الحدث', input: 'text', inputValue: type === 'task' ? 'مهمة قانونية' : 'موعد قانوني', showCancelButton: true, confirmButtonText: 'حفظ', cancelButtonText: 'إلغاء' });
    if (!result.isConfirmed || !result.value?.trim()) return;
    if (type === 'task') { const id = await db.tasks.add({ office_id: currentOfficeId, description: result.value.trim(), date: window.modalCalculatedDate, completed: false }); await queueTaskSync(id, 'insert'); }
    else { const id = await db.events.add({ office_id: currentOfficeId, title: result.value.trim(), date: window.modalCalculatedDate, type: 'legal', created_at: new Date().toISOString() }); await queueEventSync(id, 'insert'); }
    hideModal('deadlineCalculatorModal'); await renderCalendar(); await loadUpcomingEvents();
    Swal.fire({ icon: 'success', title: 'تمت الإضافة', timer: 1200, showConfirmButton: false });
};
window.addQuickItemToDay = async function() {
    const t = document.getElementById('quickItemTitle').value, type = document.getElementById('quickItemType').value;
    if (!t || !currentSelectedDateStr) return;
    try {
        if (type === 'task') { const id = await db.tasks.add({ office_id: currentOfficeId, description: t, date: currentSelectedDateStr, completed: false }); await queueTaskSync(id, 'insert'); }
        else { const id = await db.events.add({ office_id: currentOfficeId, title: t, date: currentSelectedDateStr, type: 'other', created_at: new Date().toISOString() }); await queueEventSync(id, 'insert'); }
        document.getElementById('quickItemTitle').value = ''; showDayDetails(currentSelectedDateStr); renderCalendar();
    } catch (e) { }
};
window.loadUpcomingEvents = async function() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const events = await db.events.where('date').aboveOrEqual(today).toArray();
        const tasks = await db.tasks.where('date').aboveOrEqual(today).filter(t => !t.completed).toArray();
        events.sort((a, b) => a.date.localeCompare(b.date)); tasks.sort((a, b) => a.date.localeCompare(b.date));
        let html = '';
        for (let e of events) html += `<div class="p-2 mb-2 bg-dark rounded border-start border-success border-4 d-flex justify-content-between align-items-center gap-2"><span><span class="text-success small">${escapeHtml(e.date)}</span><br>${escapeHtml(e.title)}</span><span class="text-nowrap"><button class="btn btn-sm btn-outline-warning" onclick="openEditEvent(${e.id})" title="تعديل"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger ms-1" onclick="deleteEvent(${e.id})" title="حذف"><i class="bi bi-trash"></i></button></span></div>`;
        for (let t of tasks) html += `<div class="p-2 mb-2 bg-dark rounded border-start border-warning border-4"><span class="text-warning small">${t.date}</span><br>${t.description}</div>`;
        document.getElementById('upcomingEventsList').innerHTML = html || '<p class="text-muted">لا يوجد</p>';
    } catch (e) { }
};

// ========== 11. ترحيل الجلسة ==========
window.openRescheduleModal = function(sessionId) {
    rescheduleSessionId = sessionId;
    showModal('rescheduleModal');
};
window.confirmReschedule = async function() {
    if (!ownerOnly('ترحيل الجلسة')) return;
    let newDate = document.getElementById('rescheduleDate').value;
    let newStatus = document.getElementById('rescheduleStatus').value;
    if (!newDate) return Swal.fire('تنبيه', 'أدخل التاريخ', 'warning');
    await db.sessions.update(rescheduleSessionId, { session_date: newDate, case_status: newStatus });
    await db.pendingOperations.add({ operation: 'update_session', data: { id: rescheduleSessionId, session_date: newDate, case_status: newStatus }, timestamp: Date.now() });
    hideModal('rescheduleModal');
    renderCalendar();
    loadUpcomingSessions('week');
    Swal.fire('تم الترحيل', '', 'success');
};

// ========== 12. الأرشيف ==========
window.loadArchivedCases = async function() {
    try {
        const cases = await db.cases.filter(c => c.archived === 1 && c.office_id === currentOfficeId).toArray();
        let html = '';
        for (let c of cases) html += `<div class="col-md-4"><div class="case-card" onclick="openCaseDetails('${c.id}')"><h5 class="gold-text mb-1">${c.client_name}</h5><p class="mb-0 text-white-50 small">كود: ${c.case_code}</p><p class="mb-0 text-white-50 mt-2">رقم: ${c.case_number}/${c.case_year}</p><div class="mt-2 d-flex gap-2"><button class="btn btn-sm btn-outline-info flex-grow-1" onclick="event.stopPropagation(); openArchivedCaseFolder('${c.case_code} - ${c.client_name}'.replace(/[<>:"\/\\|?*]/g, '_'))"><i class="bi bi-folder-symlink"></i> فتح المجلد</button><button class="btn btn-sm btn-outline-danger flex-grow-1" onclick="event.stopPropagation(); permanentlyDeleteArchived('${c.id}')"><i class="bi bi-trash"></i> حذف نهائي</button></div></div></div>`;
        document.getElementById('archivedCasesList').innerHTML = html || '<div class="col-12 text-center text-muted">لا توجد قضايا مؤرشفة</div>';
    } catch (e) { console.error(e); }
};
window.openArchivedCaseFolder = async function(folderName) { if (!ipcRenderer) return Swal.fire('تنبيه', 'متاحة فقط في سطح المكتب', 'info'); try { const res = await ipcRenderer.openCaseFolder(folderName); if (!res.success) Swal.fire('خطأ', res.error, 'error'); } catch (err) { Swal.fire('خطأ', 'فشل فتح المجلد', 'error'); } };
window.permanentlyDeleteArchived = async function(id) { const caseData = await db.cases.get(id); const confirm = await Swal.fire({ title: 'تأكيد الحذف النهائي', text: `هل أنت متأكد من حذف "${caseData.client_name}" نهائياً؟`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc3545', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء', background: '#0f172a', color: '#fff' }); if (confirm.isConfirmed) await deleteCasePermanently(id); loadArchivedCases(); };

// ========== 13. الإحصائيات و PDF ==========
window.loadStats = async function() { try { const cases = await db.cases.filter(c => !c.archived && c.office_id === currentOfficeId).toArray(); const files = await db.officeFiles.where('office_id').equals(currentOfficeId).filter(f => !f.archived).toArray(); const sessions = await db.sessions.filter(s => s.office_id === currentOfficeId).toArray(); document.getElementById('stat-cases').innerText = cases.length + files.length; document.getElementById('stat-total-s').innerText = sessions.length; document.getElementById('stat-clients').innerText = new Set([...cases, ...files].map(c => c.client_name)).size; } catch (e) { console.error('تعذر تحميل إحصاءات المكتب', e); } };
window.printCasePDF = async function() { if (!currentCaseForPrint) return; const rows=(currentCaseForPrint.sessions||[]).map(x=>`<li>${new Date(x.session_date).toLocaleString('ar-EG')} — ${escapeHtml(x.case_status||'')} — ${escapeHtml(x.decision||'')}</li>`).join('')||'<li>لا توجد جلسات مسجلة</li>'; const html=`<html dir="rtl"><meta charset="utf-8"><style>body{font-family:Arial,'Noto Sans Arabic',sans-serif;direction:rtl;padding:30px;color:#172b45}.print-head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #be9124;padding-bottom:10px;margin-bottom:16px}.print-head .office{font-weight:900;color:#12335b;font-size:20px}.print-head .meta{font-size:12px;color:#53657d}h1{text-align:center;color:#12335b}li{margin:10px 0}.print-foot{margin-top:26px;border-top:1px solid #d9e1eb;padding-top:8px;font-size:11px;color:#53657d;text-align:center}</style><div class="print-head"><div class="office">${escapeHtml(currentOfficeName||'مكتب المحاماة')}</div><div class="meta">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</div></div><h1>تقرير القضية</h1><p>العميل: ${escapeHtml(currentCaseForPrint.client_name)}</p><p>رقم القضية: ${escapeHtml(currentCaseForPrint.case_number)}/${escapeHtml(currentCaseForPrint.case_year)}</p><p>المحكمة: ${escapeHtml(currentCaseForPrint.court_name)}</p><p>كود القضية: ${escapeHtml(currentCaseForPrint.case_code||'')}</p><h2>سجل الجلسات</h2><ul>${rows}</ul><div class="print-foot">نظام قيد لإدارة الملفات القانونية</div></html>`; if (ipcRenderer?.printArabicPdf) await ipcRenderer.printArabicPdf(html, `قضية_${currentCaseForPrint.case_number||'تقرير'}.pdf`); };

// ========== 14. المزامنة مع Supabase ==========
// تسجيل الدخول إلى Supabase من سطح المكتب باستخدام نفس البريد وPIN المحليين.
// لا نرسل PIN إلى أي مكان خارج طلب Auth؛ بعد نجاح الدخول تستخدم RPC سياسات المكتب.
async function ensureDesktopSupabaseSession() {
    if (!supabaseClient) await initSupabase();
    if (!supabaseClient || !currentOfficeId) return false;
    const office = await db.offices.where('office_id').equals(currentOfficeId).first();
    if (!office?.email || !office?.pin) return false;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user?.email?.toLowerCase() === String(office.email).toLowerCase()) {
        const { data: membership } = await supabaseClient.from('office_members').select('role').eq('office_id', currentOfficeId).eq('user_id', session.user.id).maybeSingle();
        currentUserRole = isOwnerEmail(office.email) ? 'manager' : (membership?.role || null);
        document.querySelector('#finance-tab')?.classList.toggle('d-none', !canSeeFinance());
        document.querySelector('#teamManagementBtn')?.classList.toggle('d-none', currentUserRole !== 'manager');
        const ownerReviewBtn = document.querySelector('#ownerReviewBtn'); if (ownerReviewBtn) ownerReviewBtn.style.display = currentUserRole === 'manager' ? 'block' : 'none';
        return true;
    }
    let { error } = await supabaseClient.auth.signInWithPassword({ email: office.email, password: office.pin });
    if (error && office.email && office.pin) {
        const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({ email: office.email, password: office.pin });
        if (!signUpError && signUpData.session) error = null;
    }
    if (error) {
        console.warn('تعذر تسجيل دخول مزامنة سطح المكتب:', error.message);
        return false;
    }
    const { data: membership } = await supabaseClient.from('office_members').select('role').eq('office_id', currentOfficeId).eq('user_id', (await supabaseClient.auth.getUser()).data.user?.id).maybeSingle();
    currentUserRole = isOwnerEmail(office.email) ? 'manager' : (membership?.role || null);
    if (isOwnerEmail(office.email) && currentUserRole === 'manager') {
        await supabaseClient.from('office_members').upsert({ user_id: (await supabaseClient.auth.getUser()).data.user?.id, office_id: currentOfficeId, role: 'manager', display_name: 'محمود عبد الحميد' }, { onConflict: 'user_id,office_id' });
    }
    document.querySelector('#finance-tab')?.classList.toggle('d-none', !canSeeFinance());
    document.querySelector('#teamManagementBtn')?.classList.toggle('d-none', currentUserRole !== 'manager');
    const ownerReviewBtn = document.querySelector('#ownerReviewBtn'); if (ownerReviewBtn) ownerReviewBtn.style.display = currentUserRole === 'manager' ? 'block' : 'none';
    return true;
}

function newSyncOperationId() {
    return generateUUID();
}

// ===== مساعدات مزامنة الأحداث (الأجناد) والمهام =====
// نولّد معرّفًا ثابتًا (remote_id) لكل سجل محلي حتى لا يتكرر على Supabase.
async function ensureEventRemoteId(localId) {
    const event = await db.events.get(Number(localId));
    if (!event) return null;
    let remoteId = event.remote_id;
    if (!remoteId) { remoteId = generateUUID(); await db.events.update(event.id, { remote_id: remoteId }); }
    return { event, remoteId };
}

async function queueEventSync(localId, operation = 'insert') {
    try {
        const info = await ensureEventRemoteId(localId);
        if (!info) return;
        const { event, remoteId } = info;
        await db.pendingOperations.add({
            operation: operation === 'insert' ? 'insert_event' : 'update_event',
            data: { remote_id: remoteId, title: event.title || '', date: event.date || null, type: event.type || 'other', created_at: event.created_at || new Date().toISOString() },
            timestamp: Date.now()
        });
        updatePendingBadge();
    } catch (e) { console.warn('تعذر جدولة مزامنة الحدث', e); }
}

async function queueEventDelete(localId) {
    try {
        const event = await db.events.get(Number(localId));
        if (!event || !event.remote_id) return;
        await db.pendingOperations.add({ operation: 'delete_event', data: { remote_id: event.remote_id }, timestamp: Date.now() });
        updatePendingBadge();
    } catch (e) { console.warn('تعذر جدولة حذف الحدث', e); }
}

async function ensureTaskRemoteId(localId) {
    const task = await db.tasks.get(Number(localId));
    if (!task) return null;
    let remoteId = task.remote_id;
    if (!remoteId) { remoteId = generateUUID(); await db.tasks.update(task.id, { remote_id: remoteId }); }
    return { task, remoteId };
}

async function queueTaskSync(localId, operation = 'insert') {
    try {
        const info = await ensureTaskRemoteId(localId);
        if (!info) return;
        const { task, remoteId } = info;
        await db.pendingOperations.add({
            operation: operation === 'insert' ? 'insert_task' : 'update_task',
            data: { remote_id: remoteId, description: task.description || '', date: task.date || null, completed: !!task.completed },
            timestamp: Date.now()
        });
        updatePendingBadge();
    } catch (e) { console.warn('تعذر جدولة مزامنة المهمة', e); }
}

async function queueTaskDelete(localId) {
    try {
        const task = await db.tasks.get(Number(localId));
        if (!task || !task.remote_id) return;
        await db.pendingOperations.add({ operation: 'delete_task', data: { remote_id: task.remote_id }, timestamp: Date.now() });
        updatePendingBadge();
    } catch (e) { console.warn('تعذر جدولة حذف المهمة', e); }
}

// رفع حدث إلى Supabase: نحاول أولاً عبر RPC الآمن (بعد تطبيق migration دعم events)،
// ثم نتراجع إلى الإدراج المباشر إن سمحت سياسات RLS.
async function pushEventRecord(payload) {
    try {
        await pushDesktopRecord('events', payload.id, 'insert', payload);
        return;
    } catch (rpcError) {
        const { error } = await supabaseClient.from('events').upsert(payload, { onConflict: 'id' });
        if (error) throw rpcError;
    }
}

async function pushDesktopRecord(entityType, entityId, operation, payload) {
    const { data, error } = await supabaseClient.rpc('apply_mobile_operation', {
        p_operation_id: newSyncOperationId(),
        p_office_id: currentOfficeId,
        p_entity_type: entityType,
        p_entity_id: String(entityId),
        p_operation: operation,
        p_payload: payload,
        p_base_updated_at: payload.updated_at || null
    });
    if (error) throw error;
    if (data?.status === 'rejected') throw new Error(data.error || `رفضت مزامنة ${entityType}`);
}

// رفع كل البيانات الموجودة أصلًا في Dexie، وليس العمليات الجديدة فقط.
// هذا هو مسار الترحيل الأولي المطلوب حتى تظهر بيانات المكتب على الهاتف.
async function uploadAllLocalOfficeData() {
    if (!(await ensureDesktopSupabaseSession())) {
        throw new Error('تعذر تسجيل دخول مالك المكتب إلى Supabase');
    }
    const legalFiles = await db.legalFiles.where('office_id').equals(currentOfficeId).toArray();
    for (const record of legalFiles) {
        const payload = { ...record, status: normalizeLegalFileStatus(record.status) };
        const { error } = await supabaseClient.from('legal_files').upsert(payload, { onConflict: 'id' });
        if (error) throw error;
        if (payload.status !== record.status) await db.legalFiles.update(record.id, { status: payload.status });
    }
    const proceedings = await db.proceedings.where('office_id').equals(currentOfficeId).toArray();
    for (const record of proceedings) {
        const { error } = await supabaseClient.from('proceedings').upsert(record, { onConflict: 'id' });
        if (error) throw error;
    }
    const cases = await db.cases.where('office_id').equals(currentOfficeId).toArray();
    for (const record of cases) await pushDesktopRecord('cases', record.id, 'update', record);
    const parties = await db.caseParties.where('office_id').equals(currentOfficeId).toArray();
    for (const party of parties) { const { error } = await supabaseClient.from('case_parties').upsert(party, { onConflict: 'id' }); if (error) throw error; }
    const sessionLogs = await db.sessionChangeLog.where('office_id').equals(currentOfficeId).toArray();
    for (const log of sessionLogs) { const remoteId = log.remote_id || generateUUID(); const { id, ...logData } = log; const { error } = await supabaseClient.from('session_change_log').upsert({ ...logData, id: remoteId }, { onConflict: 'id' }); if (error) throw error; if (!log.remote_id) await db.sessionChangeLog.update(log.id, { remote_id: remoteId }); }

    // لا نرفع العلاقات التابعة قبل التأكد من وجود القضية على الخادم؛
    // هذا يمنع توقف المزامنة بسبب سجلات أتعاب/جلسات قديمة يتيمة محليًا.
    const { data: remoteCases, error: remoteCasesError } = await supabaseClient
        .from('cases').select('id').eq('office_id', currentOfficeId).limit(5000);
    if (remoteCasesError) throw remoteCasesError;
    const remoteCaseIds = new Set((remoteCases || []).map((row) => String(row.id)));
    const skippedRelations = [];

    const sessions = await db.sessions.where('office_id').equals(currentOfficeId).toArray();
    for (const record of sessions) {
        if (!remoteCaseIds.has(String(record.case_id))) {
            skippedRelations.push(`جلسة ${record.id}`);
            continue;
        }
        await pushDesktopRecord('sessions', record.id, 'insert', record);
    }

    const tasks = await db.tasks.toArray();
    for (const record of tasks) {
        const remoteId = record.remote_id || generateUUID();
        if (!record.remote_id) await db.tasks.update(record.id, { remote_id: remoteId });
        await pushDesktopRecord('tasks', remoteId, 'insert', { ...record, id: undefined, remote_id: undefined });
    }

    // رفع أحداث الأجناد (events) إلى Supabase. لا يدعمها RPC القديم، لذلك نستخدم pushEventRecord
    // الذي يجرّب المسار الآمن ثم يتراجع للإدراج المباشر. أي فشل هنا لا يوقف بقية المزامنة.
    const calendarEvents = await db.events.toArray();
    for (const record of calendarEvents) {
        const remoteId = record.remote_id || generateUUID();
        if (!record.remote_id) await db.events.update(record.id, { remote_id: remoteId });
        const payload = { id: remoteId, office_id: currentOfficeId, title: record.title || '', date: record.date || null, type: record.type || 'other', created_at: record.created_at || new Date().toISOString() };
        try { await pushEventRecord(payload); }
        catch (e) { console.warn('تعذر رفع حدث الأجندة (يلزم تطبيق migration دعم events):', e?.message || e); }
    }

    const expenses = await db.expenses.where('office_id').equals(currentOfficeId).toArray();
    for (const record of expenses) {
        const payload = { ...record, expense_date: record.expense_date || record.date };
        if (payload.case_id && !remoteCaseIds.has(String(payload.case_id))) delete payload.case_id;
        const remoteId = record.remote_id || generateUUID();
        if (!record.remote_id) await db.expenses.update(record.id, { remote_id: remoteId });
        await pushDesktopRecord('expenses', remoteId, 'insert', { ...payload, id: undefined, remote_id: undefined });
    }

    // رفع نسخة دفترية موحدة؛ يظل جدول expenses للتوافق مع الإصدارات القديمة.
    const ledger = await db.financialTransactions.where('office_id').equals(currentOfficeId).toArray();
    for (const record of ledger) {
        // لا نرسل السجل المحلي كاملاً؛ الإصدارات القديمة كانت تحتوي legacy_payment_id
        // وهو غير موجود في المخطط الحالي، فيرفض PostgREST العملية قبل تنفيذها.
        const ledgerPayload = {
            id: record.id,
            office_id: currentOfficeId,
            transaction_type: record.transaction_type === 'expense' ? 'expense' : 'income',
            transaction_scope: ['office', 'case', 'file'].includes(record.transaction_scope) ? record.transaction_scope : 'office',
            case_id: record.case_id || null,
            office_file_id: record.office_file_id || null,
            amount: Number(record.amount) || 0,
            transaction_date: record.transaction_date || record.date || new Date().toISOString().slice(0, 10),
            category: record.category || (record.transaction_type === 'expense' ? 'مصروف' : 'دخل'),
            description: record.description || null,
            payment_method: record.payment_method || null,
            paid_from: record.paid_from || null,
            receipt_path: record.receipt_path || null,
            created_at: record.created_at || new Date().toISOString(),
            updated_at: record.updated_at || new Date().toISOString()
        };
        const { error } = await supabaseClient.from('financial_transactions').upsert(ledgerPayload, { onConflict: 'id' });
        if (error) throw error;
    }
    const legacyPayments = await db.payments.toArray();
    for (const payment of legacyPayments) {
        // payment.id رقم محلي وليس UUID؛ نشتق منه UUID صالحًا وثابتًا، ولا نرسل أي حقل محلي إضافي إلى Supabase.
        const numericId = Math.abs(Number(payment.id) || 0).toString(16).padStart(12, '0').slice(-12);
        const legacyId = `00000000-0000-0000-0000-${numericId}`;
        const legacyLedger = { id: legacyId, office_id: currentOfficeId, transaction_type: 'income', transaction_scope: 'case', case_id: payment.case_id, office_file_id: null, amount: payment.amount, transaction_date: payment.date, category: 'دفعة أتعاب', description: payment.note || '' };
        const { error } = await supabaseClient.from('financial_transactions').upsert(legacyLedger, { onConflict: 'id' });
        if (error) throw error;
    }

    const fees = await db.fees.toArray();
    for (const record of fees) {
        if (!remoteCaseIds.has(String(record.case_id))) {
            skippedRelations.push(`أتعاب القضية ${record.case_id}`);
            continue;
        }
        await pushDesktopRecord('fees', record.case_id, 'update', record);
    }
    if (skippedRelations.length) console.warn('تم تجاوز سجلات تابعة لقضايا غير موجودة:', skippedRelations);

    const files = await db.officeFiles.where('office_id').equals(currentOfficeId).toArray();
    for (const record of files) {
        const { error } = await supabaseClient.rpc('sync_office_file', { p_file: record });
        if (error) throw error;
    }

    const events = await db.fileEvents.where('office_id').equals(currentOfficeId).toArray();
    for (const record of events) {
        const { error } = await supabaseClient.rpc('sync_file_event', { p_event: record });
        if (error) throw error;
    }

    const notes = await db.notes.where('office_id').equals(currentOfficeId).toArray();
    for (const record of notes) {
        const { id, ...noteData } = record;
        const { error } = await supabaseClient.from('notes').insert([noteData]);
        if (error && error.code !== '23505') throw error;
    }
}

window.syncWithSupabase = async function() {
    if (!navigator.onLine) return Swal.fire({ icon: 'warning', title: 'تنبيه', text: 'أنت غير متصل بالإنترنت', background: '#0f172a', color: '#fff' });
    if (!supabaseClient) await initSupabase();
    if (!supabaseClient) return Swal.fire('خطأ', 'لم يتم تهيئة اتصال Supabase', 'error');
    await setSupabaseOfficeId(currentOfficeId);
    Swal.fire({ title: 'جاري المزامنة...', allowOutsideClick: false, didOpen: () => Swal.showLoading(), background: '#0f172a', color: '#fff' });
    try {
        // أولًا نرفع قاعدة المكتب المحلية كاملة حتى لا يظهر الهاتف كمكتب فارغ.
        await uploadAllLocalOfficeData();
        await uploadToSupabase();
        await downloadFromSupabase();
        updatePendingBadge();
        loadStats();
        loadDashboardSummary();
        loadCasesList();
        loadUpcomingSessions('week');
        renderCalendar();

        if (activeCaseId && document.getElementById('feesModal')?.classList.contains('show')) {
            await openFeesModal(activeCaseId);
        }

        if (activeCaseId) {
            const updatedCase = await db.cases.get(activeCaseId);
            if (updatedCase) {
                const detailCodeSpan = document.querySelector('#caseDetailContent .text-warning.fw-bold + span');
                if (detailCodeSpan) detailCodeSpan.innerText = updatedCase.case_code;
                const modalCodeSpan = document.querySelector('#caseModal .border-warning');
                if (modalCodeSpan) modalCodeSpan.innerText = updatedCase.case_code;
            }
        }
        Swal.close();
        const [syncedCases, syncedSessions, syncedTasks, syncedLedger] = await Promise.all([
            db.cases.where('office_id').equals(currentOfficeId).count(),
            db.sessions.where('office_id').equals(currentOfficeId).count(),
            db.tasks.where('office_id').equals(currentOfficeId).count(),
            db.financialTransactions.where('office_id').equals(currentOfficeId).count()
        ]);
        Swal.fire({ icon: 'success', title: 'تم', text: `تمت المزامنة — قضايا: ${syncedCases} · جلسات: ${syncedSessions} · مهام: ${syncedTasks} · حركات مالية: ${syncedLedger}`, background: '#0f172a', color: '#fff', showConfirmButton: false, timer: 3500 });
    } catch (err) { console.error('فشلت المزامنة:', err); Swal.close(); Swal.fire({ icon: 'error', title: 'فشلت المزامنة', text: err?.message || 'حدث خطأ غير معروف أثناء رفع بيانات المكتب', background: '#0f172a', color: '#fff' }); }
};

let backgroundSyncInFlight = false;
// حالة المزامنة الظاهرة للمالك: آخر نجاح، آخر خطأ، وعدد المحاولات المتتالية الفاشلة.
let syncState = { lastSyncAt: null, lastError: null, consecutiveFailures: 0, backoffMs: 0 };
const SYNC_BASE_INTERVAL_MS = 60 * 1000;
const SYNC_MAX_BACKOFF_MS = 10 * 60 * 1000;

function formatSyncTime(ts) { try { return ts ? new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'; } catch (e) { return '—'; } }

async function updateSyncStatusUI() {
    const pending = await db.pendingOperations.count().catch(() => 0);
    const online = navigator.onLine;
    const state = document.getElementById('dashboardSyncState');
    if (state) {
        if (!online) { state.innerText = 'دون اتصال'; state.className = 'badge bg-warning text-dark'; }
        else if (backgroundSyncInFlight) { state.innerText = 'جارٍ المزامنة...'; state.className = 'badge bg-info text-dark'; }
        else if (syncState.lastError) { state.innerText = 'تعذّرت المزامنة'; state.className = 'badge bg-danger'; }
        else if (pending > 0) { state.innerText = `بانتظار الرفع (${pending})`; state.className = 'badge bg-secondary'; }
        else { state.innerText = 'متزامن'; state.className = 'badge bg-success'; }
    }
    const line = document.getElementById('syncStatusLine');
    if (line) {
        let text;
        if (!online) text = 'دون اتصال — ستتم المزامنة تلقائيًا عند العودة';
        else if (syncState.lastError) text = 'آخر محاولة فشلت — ستُعاد تلقائيًا';
        else if (pending > 0) text = `آخر مزامنة ${formatSyncTime(syncState.lastSyncAt)} · معلّق ${pending}`;
        else text = `آخر مزامنة ${formatSyncTime(syncState.lastSyncAt)}`;
        line.innerText = text;
    }
    const badge = document.getElementById('syncBadge');
    if (badge) { badge.innerText = pending; badge.style.display = pending > 0 ? 'block' : 'none'; }
    // C1: مؤشر الاتصال الملوّن في الشريط الجانبي (متصل/مزامنة/دون اتصال/خطأ).
    const dot = document.getElementById('syncConnDot');
    if (dot) dot.className = 'sync-conn-dot ' + (!online ? 'offline' : backgroundSyncInFlight ? 'syncing' : (syncState.lastError ? 'offline' : 'online'));
}

async function runBackgroundSync() {
    if (backgroundSyncInFlight || !currentOfficeId || !navigator.onLine || !supabaseClient) { await updateSyncStatusUI(); return; }
    backgroundSyncInFlight = true;
    await updateSyncStatusUI();
    try {
        await uploadAllLocalOfficeData();
        await uploadToSupabase();
        await downloadFromSupabase();
        syncState.lastSyncAt = Date.now();
        syncState.lastError = null;
        syncState.consecutiveFailures = 0;
        syncState.backoffMs = 0;
        await updatePendingBadge();
        await Promise.all([loadStats(), loadCasesList(), loadUpcomingSessions('week'), renderCalendar()]);
    } catch (error) {
        syncState.lastError = error?.message || String(error);
        syncState.consecutiveFailures += 1;
        // تراجع أسي: 1 ثم 2 ثم 4 ثم 8 ثم 10 دقائق كحد أقصى، لتخفيف الضغط عند تعذّر الاتصال.
        syncState.backoffMs = Math.min(SYNC_BASE_INTERVAL_MS * Math.pow(2, Math.min(syncState.consecutiveFailures - 1, 4)), SYNC_MAX_BACKOFF_MS);
        console.warn('المزامنة الخلفية مؤجلة:', syncState.lastError);
    } finally {
        backgroundSyncInFlight = false;
        await updateSyncStatusUI();
    }
}

// حلقة مزامنة ذاتية الجدولة تحترم التراجع الأسي بدل الفاصل الثابت.
function scheduleBackgroundSync() {
    const delay = syncState.backoffMs > 0 ? syncState.backoffMs : SYNC_BASE_INTERVAL_MS;
    setTimeout(async () => { await runBackgroundSync(); scheduleBackgroundSync(); }, delay);
}

// عند عودة الإنترنت: نصفر التراجع ونزامن فورًا.
async function handleBackOnline() {
    syncState.backoffMs = 0;
    syncState.consecutiveFailures = 0;
    await updateSyncStatusUI();
    await runBackgroundSync();
}

async function uploadToSupabase() {
    const pendingOps = await db.pendingOperations.toArray();
    const failures = [];
    for (let op of pendingOps) {
        try {
            if (op.operation === 'insert_case') {
                const { id, ...caseData } = op.data;
                const { error } = await supabaseClient.from('cases').insert([caseData]).select('case_code');
                if (error) throw error;
            } else if (op.operation === 'update_case') {
                const { id, case_code, ...updateData } = op.data;
                // نستخدم المعرّف الفريد للقضية أولاً (مطابقة دقيقة)، مع التراجع إلى case_code للتوافق مع السجلات القديمة.
                let caseQuery = supabaseClient.from('cases').update(updateData);
                caseQuery = id ? caseQuery.eq('id', id) : caseQuery.eq('case_code', case_code);
                const { error } = await caseQuery;
                if (error) throw error;
            } else if (op.operation === 'delete_case') {
                const { error: sessionsError } = await supabaseClient.from('sessions').delete().eq('case_id', op.data.id);
                if (sessionsError) throw sessionsError;
                const { error: caseError } = await supabaseClient.from('cases').delete().eq('id', op.data.id);
                if (caseError) throw caseError;
            } else if (op.operation === 'insert_session') {
                const sessionData = { ...op.data };
                const { error } = await supabaseClient.from('sessions').insert([sessionData]);
                if (error) throw error;
            } else if (op.operation === 'update_session') {
                const { id, ...updateData } = op.data;
                const { error } = await supabaseClient.from('sessions').update(updateData).eq('id', id);
                if (error) throw error;
            } else if (op.operation === 'delete_session') {
                const { error } = await supabaseClient.from('sessions').delete().eq('id', op.data.id);
                if (error) throw error;
            } else if (op.operation === 'upsert_fee') {
                const { error } = await supabaseClient.from('fees').upsert(op.data, { onConflict: 'case_id' });
                if (error) throw error;
            } else if (op.operation === 'insert_payment') {
                const { id, remote_id, ...paymentData } = op.data;
                // نستخدم remote_id كمعرّف ثابت على Supabase لمنع تكرار الدفعة عند إعادة المحاولة.
                const paymentId = remote_id || generateUUID();
                const { error } = await supabaseClient.from('payments').upsert({ ...paymentData, id: paymentId }, { onConflict: 'id' });
                if (error) throw error;
            } else if (op.operation === 'insert_expense') {
                const expenseData = { ...op.data, expense_date: op.data.expense_date || op.data.date };
                delete expenseData.date; delete expenseData.id; delete expenseData.remote_id; delete expenseData.owner_id;
                // remote_id ثابت يمنع تكرار المصروف عند إعادة المحاولة (كان يُدرج مرتين سابقًا).
                const expenseId = op.data.remote_id || generateUUID();
                const { error } = await supabaseClient.from('expenses').upsert({ ...expenseData, id: expenseId }, { onConflict: 'id' });
                if (error) throw error;
            } else if (op.operation === 'insert_task') {
                await pushDesktopRecord('tasks', op.data.remote_id, 'insert', { description: op.data.description, date: op.data.date, completed: !!op.data.completed });
            } else if (op.operation === 'update_task') {
                await pushDesktopRecord('tasks', op.data.remote_id, 'update', { description: op.data.description, date: op.data.date, completed: !!op.data.completed });
            } else if (op.operation === 'delete_task') {
                const { error } = await supabaseClient.from('tasks').delete().eq('id', op.data.remote_id);
                if (error) throw error;
            } else if (op.operation === 'insert_event' || op.operation === 'update_event') {
                const payload = { id: op.data.remote_id, office_id: currentOfficeId, title: op.data.title || '', date: op.data.date || null, type: op.data.type || 'other', created_at: op.data.created_at || new Date().toISOString() };
                await pushEventRecord(payload);
            } else if (op.operation === 'delete_event') {
                const { error } = await supabaseClient.from('events').delete().eq('id', op.data.remote_id);
                if (error) throw error;
            } else if (op.operation === 'insert_note') {
                const { id, ...noteData } = op.data;
                const { error } = await supabaseClient.from('notes').insert([noteData]);
                if (error) throw error;
            } else if (['upsert_legal_file', 'upsert_proceeding', 'upsert_service_action', 'upsert_approval_request', 'upsert_case_party'].includes(op.operation)) {
                const tableMap = { upsert_legal_file: 'legal_files', upsert_proceeding: 'proceedings', upsert_service_action: 'service_actions', upsert_approval_request: 'approval_requests', upsert_case_party: 'case_parties' };
                const { error } = await supabaseClient.from(tableMap[op.operation]).upsert(op.data, { onConflict: 'id' });
                if (error) throw error;
            } else if (op.operation === 'insert_office_file') {
                // الملفات المهنية تُرسل عبر RPC آمن ولا تُفتح لها صلاحية إدخال عامة.
                const { error } = await supabaseClient.rpc('sync_office_file', { p_file: op.data });
                if (error) throw error;
            } else if (op.operation === 'update_office_file') {
                const { error } = await supabaseClient.rpc('sync_office_file', { p_file: op.data });
                if (error) throw error;
            } else if (op.operation === 'insert_file_event') {
                const { error } = await supabaseClient.rpc('sync_file_event', { p_event: op.data });
                if (error) throw error;
            } else if (op.operation === 'update_file_event') {
                const { error } = await supabaseClient.rpc('sync_file_event', { p_event: op.data });
                if (error) throw error;
            } else {

                // العمليات غير المعروفة تبقى في الطابور حتى يراجعها المطور بدل فقدانها بصمت.
                throw new Error(`عملية مزامنة غير معروفة: ${op.operation}`);
            }

            // لا نحذف العملية إلا بعد نجاح Supabase؛ عند الفشل يعيد الطابور المحاولة لاحقًا.
            await db.pendingOperations.delete(op.id);
        } catch (err) {
            // الاحتفاظ بالعملية الفاشلة يحمي بيانات المكتب من الفقدان عند انقطاع الشبكة أو رفض الطلب.
            console.error('خطأ في الرفع، ستبقى العملية معلقة للمحاولة التالية:', err);
            failures.push(`${op.operation}: ${err?.message || err}`);
        }
    }
    if (failures.length) throw new Error(`تعذر رفع ${failures.length} عملية. أول سبب: ${failures[0]}`);
}

async function downloadFromSupabase() {
    const { data: cases, error: casesError } = await supabaseClient.from('cases').select('*').eq('office_id', currentOfficeId);
    if (casesError) console.error('خطأ في تحميل القضايا:', casesError);
    if (cases && cases.length > 0) {
        for (let c of cases) {
            const existing = await db.cases.get(c.id);
            if (existing) await db.cases.update(c.id, c);
            else await db.cases.add(c);
        }
    }
    // تنزيل الملفات المهنية عبر RPC آمن لأن القراءة المباشرة للجدول مغلقة.
    const { data: professionalFiles, error: professionalFilesError } = await supabaseClient.rpc('get_office_files_for_sync', { p_office_id: currentOfficeId });
    if (professionalFilesError) console.error('خطأ في تحميل الملفات المهنية:', professionalFilesError);
    if (professionalFiles && professionalFiles.length > 0) {
        for (let f of professionalFiles) {
            const existing = await db.officeFiles.get(f.id);
            if (existing) await db.officeFiles.update(f.id, f);
            else await db.officeFiles.add(f);
        }
    }
    const { data: professionalEvents, error: professionalEventsError } = await supabaseClient.rpc('get_file_events_for_sync', { p_office_id: currentOfficeId });
    if (professionalEventsError) console.error('خطأ في تحميل مراحل الملفات المهنية:', professionalEventsError);
    if (professionalEvents && professionalEvents.length > 0) {
        for (let e of professionalEvents) {
            const existing = await db.fileEvents.get(e.id);
            if (existing) await db.fileEvents.update(e.id, e);
            else await db.fileEvents.add(e);
        }
    }

    const { data: sessions, error: sessionsError } = await supabaseClient.from('sessions').select('*').eq('office_id', currentOfficeId);
    if (sessionsError) console.error('خطأ في تحميل الجلسات:', sessionsError);
    if (sessions && sessions.length > 0) {
        for (let s of sessions) {
            const existing = await db.sessions.get(s.id);
            if (existing) await db.sessions.update(s.id, s);
            else await db.sessions.add(s);
        }
    }
    const { data: remoteParties, error: partiesError } = await supabaseClient.from('case_parties').select('*').eq('office_id', currentOfficeId).limit(5000);
    if (partiesError) console.error('خطأ في تحميل العملاء والخصوم:', partiesError);
    for (const party of remoteParties || []) await db.caseParties.put(party);
    const { data: remoteSessionLogs, error: sessionLogsError } = await supabaseClient.from('session_change_log').select('*').eq('office_id', currentOfficeId).limit(5000);
    if (sessionLogsError) console.error('خطأ في تحميل سجل تغييرات الجلسات:', sessionLogsError);
    for (const log of remoteSessionLogs || []) { const existing = await db.sessionChangeLog.where('remote_id').equals(log.id).first(); const local = { ...log, remote_id: log.id, id: existing?.id }; if (existing) await db.sessionChangeLog.update(existing.id, local); else { delete local.id; await db.sessionChangeLog.add(local); } }

    // الجداول التالية تُنزّل أيضًا حتى تظهر حركات الهاتف داخل سطح المكتب.
    const { data: remoteTasks, error: tasksError } = await supabaseClient.from('tasks').select('*').eq('office_id', currentOfficeId).limit(5000);
    if (tasksError) console.error('خطأ في تحميل المهام:', tasksError);
    for (const task of remoteTasks || []) {
        const existing = await db.tasks.where('remote_id').equals(String(task.id)).first();
        const local = { ...task, remote_id: String(task.id), id: existing?.id };
        if (existing) await db.tasks.update(existing.id, local);
        else { delete local.id; await db.tasks.add(local); }
    }

    // تنزيل أحداث الأجناد (events) حتى تظهر أحداث الهاتف داخل تقويم سطح المكتب.
    const { data: remoteEvents, error: remoteEventsError } = await supabaseClient.from('events').select('*').eq('office_id', currentOfficeId).limit(5000);
    if (remoteEventsError) console.error('خطأ في تحميل أحداث الأجندة:', remoteEventsError);
    for (const ev of remoteEvents || []) {
        const existing = await db.events.where('remote_id').equals(String(ev.id)).first();
        const local = { ...ev, remote_id: String(ev.id), id: existing?.id };
        if (existing) await db.events.update(existing.id, local);
        else { delete local.id; await db.events.add(local); }
    }

    const { data: remoteExpenses, error: expensesError } = await supabaseClient.from('expenses').select('*').eq('office_id', currentOfficeId).limit(5000);
    if (expensesError) console.error('خطأ في تحميل المصروفات:', expensesError);
    for (const expense of remoteExpenses || []) {
        const existing = await db.expenses.where('remote_id').equals(String(expense.id)).first();
        const local = { ...expense, remote_id: String(expense.id), id: existing?.id, date: expense.date || expense.expense_date };
        if (existing) await db.expenses.update(existing.id, local);
        else { delete local.id; await db.expenses.add(local); }
    }

    const { data: remoteFees, error: feesError } = await supabaseClient.from('fees').select('*').limit(5000);
    if (feesError) console.error('خطأ في تحميل الأتعاب:', feesError);
    for (const fee of remoteFees || []) {
        const caseRow = await db.cases.get(fee.case_id);
        if (caseRow?.office_id !== currentOfficeId) continue;
        const existing = await db.fees.get(fee.case_id);
        if (existing) await db.fees.update(fee.case_id, fee);
        else await db.fees.put(fee);
    }

    const { data: remotePayments, error: paymentsError } = await supabaseClient.from('payments').select('*').limit(5000);
    if (paymentsError) console.error('خطأ في تحميل المدفوعات:', paymentsError);
    for (const payment of remotePayments || []) {
        const caseRow = await db.cases.get(payment.case_id);
        if (caseRow?.office_id !== currentOfficeId) continue;
        const existing = await db.payments.where('remote_id').equals(String(payment.id)).first();
        const local = { ...payment, remote_id: String(payment.id), id: existing?.id };
        if (existing) await db.payments.update(existing.id, local);
        else { delete local.id; await db.payments.add(local); }
    }

    const { data: remoteLedger, error: ledgerError } = await supabaseClient.from('financial_transactions').select('*').eq('office_id', currentOfficeId).limit(5000);
    if (ledgerError) console.error('خطأ في تحميل دفتر المالية:', ledgerError);
    for (const record of remoteLedger || []) {
        const existing = await db.financialTransactions.get(record.id);
        if (existing) await db.financialTransactions.update(record.id, record);
        else await db.financialTransactions.put(record);
    }

    for (const [tableName, table] of [['legal_files', db.legalFiles], ['proceedings', db.proceedings], ['service_actions', db.serviceActions], ['approval_requests', db.approvalRequests]]) {
        const { data, error } = await supabaseClient.from(tableName).select('*').eq('office_id', currentOfficeId).limit(5000);
        if (error) { console.error(`خطأ في تحميل ${tableName}:`, error); continue; }
        for (const row of data || []) await table.put(tableName === 'legal_files' ? { ...row, status: normalizeLegalFileStatus(row.status) } : row);
    }

    const { data: remoteNotes, error: notesError } = await supabaseClient.from('notes').select('id, office_id, case_id, office_file_id, content, author_user_id, created_at, updated_at').eq('office_id', currentOfficeId).order('updated_at', { ascending: false }).limit(5000);
    if (notesError) console.error('خطأ في تحميل ملاحظات الفريق:', notesError);
    for (const note of remoteNotes || []) {
        const existing = await db.notes.get(note.id);
        if (existing) await db.notes.update(note.id, note);
        else await db.notes.put(note);
    }
}

// ========== 15. الأتعاب ==========
window.openFeesModal = async function(caseId) {
    if (!caseId) return;
    activeCaseId = caseId;
    hideModal('caseModal');
    document.getElementById('payDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('payAmount').value = '';
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseCategory').value = '';
    let fee = await db.fees.get(caseId);
    if (!fee) { fee = { case_id: caseId, total: 0, paid: 0, remaining: 0, notes: '' }; await db.fees.put(fee); }
    const payments = await db.payments.where('case_id').equals(caseId).toArray();
    const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    fee.paid = totalPaid;
    fee.remaining = (parseFloat(fee.total) || 0) - totalPaid;
    await db.fees.put(fee);
    const expenses = await db.expenses.where('case_id').equals(caseId).toArray();
    const totalExpenses = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    document.getElementById('feeTotalInput').value = fee.total || 0;
    document.getElementById('feePaidVal').innerText = totalPaid.toFixed(2);
    document.getElementById('feeRemVal').innerText = fee.remaining.toFixed(2);
    document.getElementById('feeGeneralNotes').value = fee.notes || '';
    document.getElementById('financeCollectedVal').innerText = totalPaid.toFixed(2);
    document.getElementById('financeExpensesVal').innerText = totalExpenses.toFixed(2);
    document.getElementById('financeProfitVal').innerText = (totalPaid - totalExpenses).toFixed(2);
    payments.sort((a, b) => new Date(b.date) - new Date(a.date));
    document.getElementById('paymentsHistoryList').innerHTML = payments.map(p => `<div class="d-flex justify-content-between border-bottom border-secondary py-2"><span>${new Date(p.date).toLocaleDateString('ar-EG')} — ${escapeHtml(p.note || '')}</span><strong class="text-success">${p.amount} ج.م <button class="btn btn-sm btn-outline-danger" onclick="deletePayment(${p.id})"><i class="bi bi-trash"></i></button></strong></div>`).join('') || '<div class="text-muted text-center py-3">لا توجد دفعات</div>';
    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
    document.getElementById('expensesHistoryList').innerHTML = expenses.map(e => `<div class="d-flex justify-content-between border-bottom border-secondary py-2"><span>${new Date(e.date).toLocaleDateString('ar-EG')} — ${escapeHtml(e.category || 'مصروف')}</span><strong class="text-danger">${e.amount} ج.م <button class="btn btn-sm btn-outline-danger" onclick="deleteExpense(${e.id})"><i class="bi bi-trash"></i></button></strong></div>`).join('') || '<div class="text-muted text-center py-3">لا توجد مصروفات</div>';
    await renderReceipts(caseId);
    showModal('feesModal');
};
window.updateTotalFee = async function() { if (!ownerOnly('تعديل الأتعاب')) return; const newTotal = parseFloat(document.getElementById('feeTotalInput').value) || 0; const fee = await db.fees.get(activeCaseId); if (fee) { fee.total = newTotal; fee.remaining = newTotal - fee.paid; await db.fees.put(fee); await db.pendingOperations.add({ operation: 'upsert_fee', data: fee, timestamp: Date.now() }); document.getElementById('feeRemVal').innerText = fee.remaining.toFixed(2); } };
window.updateFeeNotes = async function() { if (!ownerOnly('تعديل الأتعاب')) return; const fee = await db.fees.get(activeCaseId); if (fee) { fee.notes = document.getElementById('feeGeneralNotes').value; await db.fees.put(fee); await db.pendingOperations.add({ operation: 'upsert_fee', data: fee, timestamp: Date.now() }); } };
window.addPayment = async function() { if (!ownerOnly('إضافة دفعة')) return; if (!activeCaseId) return; const amount = parseFloat(document.getElementById('payAmount').value); const date = document.getElementById('payDate').value; const note = document.getElementById('payNote').value; if (!amount || amount <= 0 || !date) return Swal.fire({ icon: 'warning', title: 'تنبيه', text: 'أدخل مبلغًا وتاريخًا صحيحين', background: '#0f172a' }); const payment = { case_id: activeCaseId, amount, date, note, remote_id: generateUUID() }; const id = await db.payments.add(payment); await db.pendingOperations.add({ operation: 'insert_payment', data: { ...payment, id }, timestamp: Date.now() }); await db.financialTransactions.put({ id: generateUUID(), office_id: currentOfficeId, transaction_type: 'income', transaction_scope: 'case', case_id: activeCaseId, office_file_id: null, amount, transaction_date: date, category: 'دفعة أتعاب', description: note || '', created_at: new Date().toISOString() }); await openFeesModal(activeCaseId); };
window.addExpense = async function() { if (!ownerOnly('إضافة مصروف')) return; if (!activeCaseId) return; const amount = parseFloat(document.getElementById('expenseAmount').value); const date = document.getElementById('expenseDate').value; const category = document.getElementById('expenseCategory').value.trim(); if (!amount || amount <= 0 || !date) return Swal.fire({ icon: 'warning', title: 'تنبيه', text: 'أدخل قيمة المصروف وتاريخه', background: '#0f172a' }); const expense = { office_id: currentOfficeId, owner_id: activeCaseId, case_id: activeCaseId, amount, date, category, remote_id: generateUUID() }; const id = await db.expenses.add(expense); await db.pendingOperations.add({ operation: 'insert_expense', data: { ...expense, id }, timestamp: Date.now() }); await db.financialTransactions.put({ id: generateUUID(), office_id: currentOfficeId, transaction_type: 'expense', transaction_scope: 'case', case_id: activeCaseId, office_file_id: null, amount, transaction_date: date, category: category || 'مصروف', description: '', created_at: new Date().toISOString() }); await openFeesModal(activeCaseId); };
window.openOfficeExpenseModal = function() {
    if (!ownerOnly('تسجيل مصروف المكتب')) return;
    document.getElementById('officeExpenseAmount').value = '';
    document.getElementById('officeExpenseDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('officeExpenseCategory').value = '';
    document.getElementById('officeExpenseDescription').value = '';
    showModal('officeExpenseModal');
};
window.saveOfficeExpense = async function() {
    if (!ownerOnly('تسجيل مصروف المكتب')) return;
    const amount = Number(document.getElementById('officeExpenseAmount').value || 0);
    const date = document.getElementById('officeExpenseDate').value;
    const category = document.getElementById('officeExpenseCategory').value.trim() || 'مصروف مكتب';
    const description = document.getElementById('officeExpenseDescription').value.trim();
    if (amount <= 0 || !date) return Swal.fire('تنبيه', 'أدخل قيمة وتاريخ المصروف', 'warning');
    const expense = { office_id: currentOfficeId, owner_id: currentOfficeId, case_id: null, amount, date, category, description, remote_id: generateUUID() };
    const id = await db.expenses.add(expense);
    await db.pendingOperations.add({ operation: 'insert_expense', data: { ...expense, id }, timestamp: Date.now() });
    await db.financialTransactions.put({ id: generateUUID(), office_id: currentOfficeId, transaction_type: 'expense', transaction_scope: 'office', case_id: null, office_file_id: null, amount, transaction_date: date, category, description, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    hideModal('officeExpenseModal'); await loadFinancePage(); updatePendingBadge();
    Swal.fire({ icon: 'success', title: 'تم تسجيل مصروف المكتب', timer: 1400, showConfirmButton: false });
};
window.deletePayment = async function(paymentId) { if (!ownerOnly('حذف دفعة')) return; if (confirm('هل أنت متأكد من حذف الدفعة؟')) { await db.payments.delete(paymentId); await openFeesModal(activeCaseId); } };
window.deleteExpense = async function(expenseId) { if (!ownerOnly('حذف المصروف')) return; if (confirm('هل أنت متأكد من حذف المصروف؟')) { await db.expenses.delete(expenseId); await openFeesModal(activeCaseId); } };

window.printFeesPDF = async function() { if (!activeCaseId) return; const c=await db.cases.get(activeCaseId)||await db.officeFiles.get(activeCaseId); const fee=await db.fees.get(activeCaseId)||{total:0,paid:0,remaining:0}; const payments=await db.payments.where('case_id').equals(activeCaseId).toArray(); const rows=payments.map(x=>`<li>${escapeHtml(x.date)} — ${escapeHtml(x.amount)} ج.م — ${escapeHtml(x.note||'')}</li>`).join('')||'<li>لا توجد دفعات</li>'; const html=`<html dir="rtl"><meta charset="utf-8"><style>body{font-family:Arial,'Noto Sans Arabic',sans-serif;direction:rtl;padding:30px;color:#172b45}.print-head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #be9124;padding-bottom:10px;margin-bottom:16px}.print-head .office{font-weight:900;color:#12335b;font-size:20px}.print-head .meta{font-size:12px;color:#53657d}h1{text-align:center;color:#12335b}li{margin:10px 0}.print-foot{margin-top:26px;border-top:1px solid #d9e1eb;padding-top:8px;font-size:11px;color:#53657d;text-align:center}</style><div class="print-head"><div class="office">${escapeHtml(currentOfficeName||'مكتب المحاماة')}</div><div class="meta">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</div></div><h1>تقرير الأتعاب</h1><p>العميل: ${escapeHtml(c.client_name)}</p><p>إجمالي الأتعاب: ${escapeHtml(fee.total)} ج.م</p><p>المدفوع: ${escapeHtml(fee.paid)} ج.م</p><p>المتبقي: ${escapeHtml(fee.remaining)} ج.م</p><h2>الدفعات</h2><ul>${rows}</ul><div class="print-foot">نظام قيد لإدارة الملفات القانونية</div></html>`; if (ipcRenderer?.printArabicPdf) await ipcRenderer.printArabicPdf(html, `أتعاب_${c.case_code||c.file_code||'تقرير'}.pdf`); };

// ========== صفحة الأتعاب والمصروفات والمرفقات ==========
let financeRows = [];
function money(value) { return (Number(value) || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
async function getFinanceRows() {
    const ledger = await db.financialTransactions.where('office_id').equals(currentOfficeId).toArray();
    const cases = await db.cases.filter(c => !c.archived && c.office_id === currentOfficeId).toArray();
    const files = await db.officeFiles.filter(f => !f.archived && f.office_id === currentOfficeId).toArray();
    const records = [...cases.map(c => ({ ...c, record_kind: 'judicial', record_id: c.id, title: `قضية ${c.case_number || ''}/${c.case_year || ''}`, service: `${c.court_name || '-'}${c.circuit ? ` / ${c.circuit}` : ''}`, code: c.case_code || '', scope: 'case' })), ...files.map(f => ({ ...f, record_kind: 'professional', record_id: f.id, title: f.title || professionalTypeLabel(f.file_type), service: professionalTypeLabel(f.file_type), code: f.file_code || '', scope: 'file' }))];
    const rows = records.map(record => { const related = ledger.filter(x => (record.scope === 'case' ? x.case_id === record.record_id : x.office_file_id === record.record_id)); const total = related.filter(x => x.transaction_type === 'income').reduce((n,x) => n + Number(x.amount || 0), 0); const spent = related.filter(x => x.transaction_type === 'expense').reduce((n,x) => n + Number(x.amount || 0), 0); return { ...record, total, collected: total, spent, profit: total - spent }; });
    const office = ledger.filter(x => x.transaction_scope === 'office');
    rows.unshift({ record_kind: 'office', record_id: 'office', client_name: 'المكتب', title: 'الحساب العام للمكتب', service: 'مصروفات ونفقات المكتب', code: 'OFFICE', total: office.filter(x => x.transaction_type === 'income').reduce((n,x) => n+Number(x.amount||0),0), collected: office.filter(x => x.transaction_type === 'income').reduce((n,x) => n+Number(x.amount||0),0), spent: office.filter(x => x.transaction_type === 'expense').reduce((n,x) => n+Number(x.amount||0),0) }); rows[0].profit = rows[0].collected - rows[0].spent; return rows;
}
function renderFinanceRows(rows) {
    const body = document.getElementById('financeTableBody');
    if (!body) return;
    body.innerHTML = rows.map(r => `<tr><td><strong>${escapeHtml(r.client_name || '-')}</strong><div class="finance-code">${escapeHtml(r.client_phone || '')}</div></td><td>${escapeHtml(r.title)}<div class="finance-code">${escapeHtml(r.code)}</div></td><td>${escapeHtml(r.service)}</td><td>${money(r.total)}</td><td class="text-success fw-bold">${money(r.collected)}</td><td class="text-danger fw-bold">${money(r.spent)}</td><td class="fw-bold ${r.profit >= 0 ? 'text-success' : 'text-danger'}">${money(r.profit)}</td><td><button class="btn btn-sm btn-outline-primary" onclick="openFeesModal('${r.record_id}')"><i class="bi bi-pencil-square"></i> تعديل الحساب</button></td></tr>`).join('') || '<tr><td colspan="8" class="text-center py-4">لا توجد سجلات مالية</td></tr>';
}
window.loadFinancePage = async function() { showTab('financeTab'); try { financeRows = await getFinanceRows(); const total = financeRows.reduce((s, r) => s + r.total, 0), collected = financeRows.reduce((s, r) => s + r.collected, 0), spent = financeRows.reduce((s, r) => s + r.spent, 0); document.getElementById('financePageFees').innerText = money(total); document.getElementById('financePageCollected').innerText = money(collected); document.getElementById('financePageExpenses').innerText = money(spent); document.getElementById('financePageProfit').innerText = money(collected - spent); renderFinanceRows(financeRows); } catch (error) { console.error('تعذر تحميل الدفتر المالي:', error); const body = document.getElementById('financeTableBody'); if (body) body.innerHTML = `<tr><td colspan="8"><div class="alert alert-danger mb-0">تعذر تحميل الدفتر المالي: ${escapeHtml(error.message || 'خطأ غير معروف')}</div></td></tr>`; } };
window.filterFinancePage = function() { const q = (document.getElementById('financeSearchInput')?.value || '').trim().toLowerCase(); const type = document.getElementById('financeTypeFilter')?.value || ''; renderFinanceRows(financeRows.filter(r => (!type || r.record_kind === type) && (!q || [r.client_name, r.case_number, r.case_code, r.file_code, r.title, r.court_name, r.service].some(v => String(v || '').toLowerCase().includes(q))))); };
window.selectReceiptForActiveRecord = async function() { if (!activeCaseId || !ipcRenderer?.selectFile || !ipcRenderer?.copyReceipt) return Swal.fire('تنبيه', 'رفع الإيصالات متاح داخل نسخة سطح المكتب فقط', 'info'); const source = await ipcRenderer.selectFile(); if (!source) return; const result = await ipcRenderer.copyReceipt(source, activeCaseId); if (!result?.success) return Swal.fire('خطأ', result?.error || 'تعذر حفظ الإيصال', 'error'); await db.receipts.add({ record_id: activeCaseId, date: new Date().toISOString(), name: result.name, path: result.path }); await renderReceipts(activeCaseId); };
window.renderReceipts = async function(recordId) { const list = document.getElementById('receiptsHistoryList'); if (!list) return; const receipts = await db.receipts.where('record_id').equals(recordId).toArray(); list.innerHTML = receipts.map(r => `<div class="receipt-row"><span><i class="bi bi-receipt"></i> ${escapeHtml(r.name)} <small>${new Date(r.date).toLocaleDateString('ar-EG')}</small></span><span><button class="btn btn-sm btn-outline-primary" onclick="openReceipt('${r.id}')">فتح</button>${currentUserRole === 'manager' ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteReceipt('${r.id}')">حذف</button>` : ''}</span></div>`).join('') || '<span class="text-muted">لا توجد إيصالات محفوظة</span>'; };
window.openReceipt = async function(id) { const receipt = await db.receipts.get(Number(id)); if (receipt && ipcRenderer?.openLocalFile) await ipcRenderer.openLocalFile(receipt.path); };
window.deleteReceipt = async function(id) { const receipt = await db.receipts.get(Number(id)); if (!receipt || !confirm('حذف هذا الإيصال؟')) return; await db.receipts.delete(Number(id)); await renderReceipts(receipt.record_id); };

// ========== 16. حذف القضية وأرشفتها ==========
window.showCaseOptions = async function() { if (!activeCaseId) return; const caseData = await db.cases.get(activeCaseId); const result = await Swal.fire({ title: 'خيارات القضية', html: `ماذا تريد أن تفعل بالقضية: <strong>${caseData.client_name}</strong>؟`, icon: 'question', showCancelButton: true, showDenyButton: true, confirmButtonColor: '#dc3545', denyButtonColor: '#ffc107', cancelButtonColor: '#6c757d', confirmButtonText: '🗑️ حذف نهائي', denyButtonText: '📦 نقل إلى الأرشيف', cancelButtonText: 'إلغاء', background: '#0f172a', color: '#fff' }); if (result.isConfirmed) await deleteCasePermanently(activeCaseId); else if (result.isDenied) await archiveCase(activeCaseId); };
window.archiveCase = async function(id) { if (!ownerOnly('أرشفة القضية')) return; try { const caseData = await db.cases.get(id); if (ipcRenderer && ipcRenderer.archiveCaseFolder) { const folderName = `${caseData.case_code} - ${caseData.client_name}`.replace(/[<>:"\/\\|?*]/g, '_'); await ipcRenderer.archiveCaseFolder(folderName); } await db.cases.update(id, { archived: 1 }); await db.pendingOperations.add({ operation: 'update_case', data: { id: id, case_code: caseData.case_code, archived: 1 }, timestamp: Date.now() }); hideModal('caseModal'); Swal.fire({ icon: 'success', title: 'تم الأرشفة', text: 'تم نقل القضية إلى الأرشيف', background: '#0f172a', color: '#fff', timer: 1500, showConfirmButton: false }); loadRecentCases(); updatePendingBadge(); } catch (error) { console.error(error); Swal.fire({ icon: 'error', title: 'خطأ', text: 'فشلت عملية الأرشفة', background: '#0f172a', color: '#fff' }); } };
window.deleteCasePermanently = async function(id) { if (!ownerOnly('حذف القضية')) return; try { const caseData = await db.cases.get(id); if (ipcRenderer && ipcRenderer.deleteCaseFolder) { const folderName = `${caseData.case_code} - ${caseData.client_name}`.replace(/[<>:"\/\\|?*]/g, '_'); await ipcRenderer.deleteCaseFolder(folderName); } await db.cases.delete(id); await db.sessions.where('case_id').equals(id).delete(); await db.fees.delete(id); await db.payments.where('case_id').equals(id).delete(); await db.expenses.where('case_id').equals(id).delete(); await db.pendingOperations.add({ operation: 'delete_case', data: { id: id }, timestamp: Date.now() }); hideModal('caseModal'); Swal.fire({ icon: 'success', title: 'تم الحذف', text: 'تم حذف القضية نهائياً', background: '#0f172a', color: '#fff', showConfirmButton: false, timer: 2000 }); loadRecentCases(); updatePendingBadge(); } catch (error) { console.error(error); Swal.fire({ icon: 'error', title: 'خطأ', text: 'حدث خطأ أثناء الحذف', background: '#0f172a', color: '#fff' }); } };

// ========== 17. دوال إضافية ==========
async function loadRecentCases() {
    try {
        const container = document.getElementById('recentCasesList');
        if (!container) return;
        const cases = await db.cases.filter(c => !c.archived && c.office_id === currentOfficeId).reverse().limit(12).toArray();
        let html = '';
        for (let c of cases) {
            html += `<div class="case-card mb-2" onclick="openCaseDetails('${c.id}')">
            <div class="d-flex justify-content-between">
            <h6 class="gold-text mb-1">${c.client_name}</h6>
            </div>
            <div class="small text-white-50">رقم: ${c.case_number}/${c.case_year} | كود: ${c.case_code || 'غير محدد'}</div>
            </div>`;
        }
        container.innerHTML = html || '<p class="text-muted">لا توجد قضايا</p>';
    } catch (e) { console.error(e); }
}
window.searchCases = async function() { const q = document.getElementById('searchInput').value.trim().toLowerCase(); if (!q) return; try { const cases = await db.cases.filter(c => !c.archived && c.office_id === currentOfficeId).filter(c => String(c.client_name || '').toLowerCase().includes(q) || String(c.case_number || '').includes(q) || String(c.client_phone || '').includes(q) || String(c.case_code || '').toLowerCase().includes(q)).toArray(); let html = ''; for (let c of cases) { const sessions = await db.sessions.where('case_id').equals(c.id).toArray(); sessions.sort((a, b) => new Date(b.session_date) - new Date(a.session_date)); const lastStatus = sessions.length > 0 ? sessions[0].case_status : 'جديدة'; html += `<div class="col-md-4"><div class="case-card" onclick="openCaseDetails('${c.id}')"><div class="d-flex justify-content-between align-items-start"><div><h5 class="gold-text mb-1">${c.client_name}</h5><p class="mb-0 text-white-50 small">كود: ${c.case_code}</p></div><span class="case-status status-new">${lastStatus}</span></div><p class="mb-0 text-white-50 mt-2">رقم: ${c.case_number}/${c.case_year}</p></div></div>`; } document.getElementById('searchResults').innerHTML = html || '<div class="col-12 text-center text-muted">لا توجد نتائج</div>'; } catch (e) { } };

// ========== البحث الحي الموحّد (D1) ==========
// يبحث فوراً في القضايا والملفات القضائية والمهنية والجلسات والمهام والأحداث وملاحظات الفريق.
// إضافة فقط: لا يغيّر أي منطق قائم، ويعمل بالكامل على الخزين المحلي دون اتصال.
window.runLiveSearch = async function(rawQuery) {
    const host = document.getElementById('liveSearchResults');
    if (!host) return;
    const q = String(rawQuery || '').trim().toLowerCase();
    if (!q) { host.innerHTML = '<div class="text-center text-white-50 small py-3">ابدأ الكتابة لعرض النتائج الموحّدة من كل الأقسام.</div>'; return; }
    const has = (...vals) => vals.some(v => String(v ?? '').toLowerCase().includes(q));
    const section = (title, icon, items) => {
        if (!items.length) return '';
        return `<div class="mb-3"><div class="text-warning fw-bold mb-2"><i class="bi ${icon}"></i> ${title} <span class="badge bg-secondary ms-1">${items.length}</span></div>${items.join('')}</div>`;
    };
    const row = (title, subtitle, onclick) => `<div class="border rounded p-2 mb-2 bg-dark bg-opacity-25" style="cursor:pointer;" onclick="${onclick}"><div class="fw-bold gold-text">${escapeHtml(title)}</div><div class="small text-white-50">${escapeHtml(subtitle)}</div></div>`;
    try {
        const [cases, sessions, tasks, events, notes, officeFiles, legalFiles] = await Promise.all([
            db.cases.filter(c => c.office_id === currentOfficeId).toArray(),
            db.sessions.filter(s => s.office_id === currentOfficeId).toArray(),
            db.tasks.toArray(),
            db.events.toArray(),
            db.notes.filter(n => n.office_id === currentOfficeId).toArray(),
            db.officeFiles.where('office_id').equals(currentOfficeId).toArray(),
            db.legalFiles.where('office_id').equals(currentOfficeId).toArray()
        ]);
        const caseHits = cases.filter(c => has(c.client_name, c.case_number, c.case_year, c.case_code, c.client_phone, c.court_name, c.case_subject, c.opponent_name));
        const sessionHits = sessions.filter(s => has(s.case_status, s.decision, s.session_date, s.court_name, s.circuit));
        const taskHits = tasks.filter(t => (!t.office_id || t.office_id === currentOfficeId) && has(t.description, t.date));
        const eventHits = events.filter(e => has(e.title, e.date, e.type));
        const noteHits = notes.filter(n => has(n.content));
        const officeFileHits = officeFiles.filter(f => has(f.file_code, f.client_name, f.client_phone, f.file_type, f.status));
        const legalFileHits = legalFiles.filter(f => has(f.file_code, f.client_name, f.status, f.file_type));
        const html = [
            section('القضايا القضائية', 'bi-briefcase', caseHits.map(c => row(`${c.client_name || 'قضية'} — ${c.case_code || ''}`, `رقم: ${c.case_number || '-'}/${c.case_year || '-'} · ${c.court_name || ''}`, `showTab('cases'); openCaseDetails('${c.id}')`))),
            section('الملفات القضائية (النموذج الموحّد)', 'bi-folder2-open', legalFileHits.map(f => row(`${f.client_name || 'ملف'} — ${f.file_code || ''}`, `النوع: ${f.file_type || '-'} · الحالة: ${f.status || '-'}`, `showTab('cases')`))),
            section('الملفات الإجرائية والخدمية', 'bi-folder-symlink', officeFileHits.map(f => row(`${f.client_name || 'ملف'} — ${f.file_code || ''}`, `النوع: ${f.file_type || '-'} · الحالة: ${f.status || '-'}`, `showTab('cases')`))),
            section('الجلسات', 'bi-calendar-event', sessionHits.map(s => row(`${new Date(s.session_date).toLocaleDateString('ar-EG')} — ${s.case_status || ''}`, `${s.decision || 'لا يوجد قرار'}`, `showTab('sessions')`))),
            section('المهام', 'bi-list-check', taskHits.map(t => row(`${t.completed ? '✔ ' : '• '}${t.description || 'مهمة'}`, `التاريخ: ${t.date || '-'}`, `showTab('agenda')`))),
            section('الأحداث (الأجندة)', 'bi-calendar3', eventHits.map(e => row(`${e.title || 'حدث'}`, `التاريخ: ${e.date || '-'} · ${e.type || ''}`, `showTab('agenda')`))),
            section('ملاحظات الفريق', 'bi-journal-text', noteHits.map(n => row(`${(n.content || '').slice(0, 80)}`, `آخر تحديث: ${n.updated_at ? new Date(n.updated_at).toLocaleString('ar-EG') : '-'}`, `openTeamNotes()`)))
        ].join('');
        host.innerHTML = html || '<div class="text-center text-muted py-3">لا توجد نتائج مطابقة.</div>';
    } catch (error) { host.innerHTML = `<div class="text-danger small">تعذّر تنفيذ البحث: ${escapeHtml(error?.message || '')}</div>`; }
};

window.openCaseDetails = async function(id) {
    if (!id) return; try { if (!currentUserRole && currentOfficeId === OWNER_OFFICE_ID) currentUserRole = 'manager'; const c=await db.cases.get(id); if (!c) return; activeCaseId=id;
    document.getElementById('caseDetailContent').innerHTML = `<div class="record-detail"><div class="record-code">كود الملف: ${escapeHtml(c.case_code||'-')}</div><div class="record-row"><strong>رقم القضية:</strong> ${escapeHtml(c.case_number||'-')} / ${escapeHtml(c.case_year||'-')}</div><div class="record-row"><strong>المحكمة والدائرة:</strong> ${escapeHtml(c.court_name||'-')} — ${escapeHtml(c.circuit||'-')}</div><div class="record-row"><strong>نوع القضية:</strong> ${escapeHtml(c.case_type||'-')}</div>${partyCardHtml('بيانات العميل', {name:c.client_name, role:c.client_role, nationalId:c.client_national_id, phone:c.client_phone, address:c.client_address, email:c.client_email})}${partyCardHtml('بيانات الخصم', {name:c.opponent_name, role:c.opponent_role, nationalId:c.opponent_national_id, phone:c.opponent_phone, address:c.opponent_address, email:c.opponent_email})}<div class="record-row"><strong>موضوع القضية:</strong><br>${escapeHtml(c.case_subject||'-')}</div></div>`;
    const sessions=await db.sessions.where('case_id').equals(id).toArray(); sessions.sort((a,b)=>new Date(b.session_date)-new Date(a.session_date)); currentCaseForPrint={...c,sessions}; document.getElementById('caseDetailSessions').innerHTML=sessions.length?sessions.map(x=>`<div class="session-item-row"><div><span class="text-info fw-bold fs-5">${new Date(x.session_date).toLocaleString('ar-EG',{dateStyle:'full',timeStyle:'short'})}</span><span class="badge bg-light text-dark mx-3 fs-6">${escapeHtml(x.case_status)}</span><div class="fs-6 mt-2 text-white">${escapeHtml(x.decision||'لا يوجد قرار مسجل')}</div></div>${currentUserRole === 'manager' ? `<button class="btn btn-sm btn-outline-warning" onclick="event.stopPropagation(); openEditSession('${escapeHtml(x.id)}')"><i class="bi bi-pencil fs-5"></i></button>` : ''}</div>`).join(''):'<p class="text-muted">لا توجد جلسات مسجلة لهذه القضية.</p>';
    document.getElementById('caseActionsPanel').innerHTML=detailActionsHtml(true,id); showCasePanelSection('data'); } catch(e){ console.error(e); }
};
window.showCasePanelSection = function(section) {
    const dataSection = document.getElementById('caseDetailDataSection');
    const sessionsSection = document.getElementById('caseDetailSessionsSection');
    if (!dataSection || !sessionsSection) return;
    const showSessions = section === 'sessions';
    dataSection.style.display = showSessions ? 'none' : 'block';
    sessionsSection.style.display = showSessions ? 'block' : 'none';
};
window.handleOpenCaseFolder = async function() { if (!activeCaseId || !ipcRenderer) return; try { const c = await db.cases.get(activeCaseId); if (!c) return; const caseCode = assertValidCaseCode(c.case_code); const folderName = `${caseCode} - ${c.client_name}`.replace(/[<>:"\/\\|?*]/g, '_'); const res = await ipcRenderer.openCaseFolder(folderName); if (!res || !res.success) { if (ipcRenderer.createCaseFolder) { await ipcRenderer.createCaseFolder(caseCode, c.client_name, c); await ipcRenderer.openCaseFolder(folderName); } } } catch (err) { } };
// فتح نافذة بيانات العميل من لوحة القضية، مع إمكانية مراجعة الهاتف والعنوان والخصم.
window.openClientDetails = async function() {
    const c = await db.cases.get(activeCaseId); if (!c) return;
    await Swal.fire({ title: `بيانات العميل: ${escapeHtml(c.client_name || '-')}`, html: `<div class="text-end"><p><strong>الاسم:</strong> ${escapeHtml(c.client_name || '-')}</p><p><strong>الهاتف:</strong> ${escapeHtml(c.client_phone || '-')}</p><p><strong>العنوان:</strong> ${escapeHtml(c.client_address || '-')}</p><hr><p><strong>الخصم:</strong> ${escapeHtml(c.opponent_name || '-')}</p><p><strong>هاتف الخصم:</strong> ${escapeHtml(c.opponent_phone || '-')}</p><p><strong>عنوان الخصم:</strong> ${escapeHtml(c.opponent_address || '-')}</p></div>`, confirmButtonText: 'إغلاق', background: '#0f172a', color: '#fff' });
};

// فتح نموذج تعديل القضية وتعبئة بيانات العميل والخصم الموجودة محليًا.
window.openEditCaseModalFromPanel = async function() {
    const c = await db.cases.get(activeCaseId); if (!c) return;
    const values = { edit_c_name: c.client_name, edit_c_phone: c.client_phone, edit_c_national_id: c.client_national_id, edit_c_email: c.client_email, edit_c_address: c.client_address, edit_c_opponent: c.opponent_name, edit_c_opponent_role: c.opponent_role, edit_c_opponent_national_id: c.opponent_national_id, edit_c_opponent_email: c.opponent_email, edit_c_opponent_phone: c.opponent_phone, edit_c_opponent_address: c.opponent_address, edit_c_num: c.case_number, edit_c_year: c.case_year, edit_c_court: c.court_name, edit_c_circuit: c.circuit, edit_case_type: c.case_type, edit_c_subject: c.case_subject, edit_case_stage: c.proceeding_type, edit_case_importance: c.importance, edit_case_status: c.status || 'جديدة', edit_c_city: c.city, edit_c_alert_notes: c.alert_notes };
    Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value || ''; });
    document.getElementById('editAdditionalClients').innerHTML = ''; document.getElementById('editAdditionalOpponents').innerHTML = '';
    const parties = await db.caseParties.where('case_id').equals(activeCaseId).toArray();
    parties.filter(p => p.party_type === 'client' && p.name !== c.client_name).forEach(p => addEditCasePartyRow('client', p));
    parties.filter(p => p.party_type === 'opponent' && p.name !== c.opponent_name).forEach(p => addEditCasePartyRow('opponent', p));
    showModal('editCaseModal');
};

window.addEditCasePartyRow = function(type, party = {}) {
    const host = document.getElementById(type === 'client' ? 'editAdditionalClients' : 'editAdditionalOpponents'); if (!host) return;
    const key = `${type}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    host.insertAdjacentHTML('beforeend', `<div class="col-12 border rounded p-2 mt-2" data-edit-party-row="${key}"><div class="row g-2"><div class="col-md-4"><input class="form-control edit-party-name" placeholder="اسم ${type === 'client' ? 'العميل' : 'الخصم'}" value="${escapeHtml(party.name || '')}"></div><div class="col-md-3"><input class="form-control edit-party-role" placeholder="الصفة" value="${escapeHtml(party.role || '')}"></div><div class="col-md-3"><input class="form-control edit-party-phone" placeholder="الهاتف" value="${escapeHtml(party.phone || '')}"></div><div class="col-md-2"><button type="button" class="btn btn-outline-danger w-100" onclick="this.closest('[data-edit-party-row]').remove()">حذف</button></div><div class="col-md-3"><input class="form-control edit-party-power-number" placeholder="رقم التوكيل" value="${escapeHtml(party.power_of_attorney_number || '')}"></div><div class="col-md-2"><input class="form-control edit-party-power-year" placeholder="سنة التوكيل" value="${escapeHtml(party.power_of_attorney_year || '')}"></div><div class="col-md-4"><input class="form-control edit-party-notary" placeholder="مكتب التوثيق" value="${escapeHtml(party.notary_office || '')}"></div></div></div>`);
};
function collectEditCaseParties(caseId) {
    const rows = [];
    for (const type of ['client', 'opponent']) document.querySelectorAll(`#${type === 'client' ? 'editAdditionalClients' : 'editAdditionalOpponents'} [data-edit-party-row]`).forEach(row => {
        const name = row.querySelector('.edit-party-name')?.value.trim(); if (!name) return;
        rows.push({ id: generateUUID(), office_id: currentOfficeId, case_id: caseId, party_type: type, name, role: row.querySelector('.edit-party-role')?.value.trim() || '', phone: row.querySelector('.edit-party-phone')?.value.trim() || '', power_of_attorney_number: row.querySelector('.edit-party-power-number')?.value.trim() || '', power_of_attorney_year: row.querySelector('.edit-party-power-year')?.value.trim() || '', notary_office: row.querySelector('.edit-party-notary')?.value.trim() || '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    });
    return rows;
}

// اختيار عدة مستندات ثم نقلها أو نسخها إلى مجلد «مستندات العميل».
window.addCaseDocument = async function() {
    if (!activeCaseId || !ipcRenderer?.selectCaseDocument || !ipcRenderer?.copyCaseDocument) return Swal.fire('تنبيه', 'إضافة المستندات متاحة من نسخة سطح المكتب فقط', 'info');
    const c = await db.cases.get(activeCaseId); if (!c) return;
    const sourcePaths = await ipcRenderer.selectCaseDocument();
    if (!sourcePaths || !sourcePaths.length) return;
    const selected = await Swal.fire({ title: 'طريقة إضافة المستندات', input: 'radio', inputOptions: { copy: 'نسخ المستندات مع إبقاء الأصل', move: 'نقل المستندات وحذف الأصل من مكانه' }, inputValue: 'copy', showCancelButton: true, confirmButtonText: 'متابعة', cancelButtonText: 'إلغاء', background: '#0f172a', color: '#fff' });
    if (!selected.isConfirmed) return;
    const result = await ipcRenderer.copyCaseDocument(sourcePaths, c.case_code, c.client_name, selected.value || 'copy');
    if (!result?.success) return Swal.fire('خطأ', result?.error || 'تعذر إضافة المستندات', 'error');
    Swal.fire({ icon: 'success', title: selected.value === 'move' ? 'تم نقل المستندات' : 'تم نسخ المستندات', text: `عدد المستندات: ${result.count || 0}`, timer: 1800, showConfirmButton: false, background: '#07111f', color: '#fff' });
};

window.openTeamNotes = async function(caseId) {
    if (!ownerOnly('إدارة ملاحظات الفريق')) return;
    activeCaseId = caseId || null;
    const notes = caseId
        ? await db.notes.where('case_id').equals(caseId).toArray()
        : await db.notes.where('office_id').equals(currentOfficeId).toArray();
    notes.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    document.getElementById('teamNoteContent').value = '';
    document.getElementById('teamNotesList').innerHTML = notes.map(note => `<div class="border-bottom py-2"><div>${escapeHtml(note.content)}</div><small class="text-muted">${new Date(note.updated_at || note.created_at || Date.now()).toLocaleString('ar-EG')}</small></div>`).join('') || '<div class="text-muted text-center">لا توجد ملاحظات للفريق.</div>';
    showModal('teamNotesModal');
};
window.saveTeamNote = async function() {
    if (!ownerOnly('إضافة ملاحظة للفريق')) return;
    const content = document.getElementById('teamNoteContent').value.trim();
    if (!content) return Swal.fire('تنبيه', 'اكتب نص الملاحظة أولاً', 'warning');
    const note = { office_id: currentOfficeId, case_id: activeCaseId || null, office_file_id: null, content, updated_at: new Date().toISOString(), created_at: new Date().toISOString() };
    const id = await db.notes.add(note);
    await db.pendingOperations.add({ operation: 'insert_note', data: { ...note, id }, timestamp: Date.now() });
    await openTeamNotes(activeCaseId || null);
    updatePendingBadge();
};

// ========== البحث المتقدم والاختصارات السريعة ==========
let advancedSearchMode = 'view';
window.openAdvancedSearchModal = function(mode = 'view') {
    advancedSearchMode = mode;
    showModal('advancedSearchModal');
    setTimeout(() => document.getElementById('advancedQuery')?.focus(), 150);
};
window.openDocumentShortcut = function() { openAdvancedSearchModal('document'); };
window.openNewSessionShortcut = function() {
    showTab('sessions');
    setTimeout(() => document.getElementById('s_search')?.focus(), 150);
};
window.clearAdvancedSearch = function() {
    ['advancedQuery', 'advancedStatus', 'advancedFromDate', 'advancedToDate', 'advancedSessionStatus', 'advancedCourtService'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const type = document.getElementById('advancedFileType'); if (type) type.value = '';
    document.getElementById('advancedSearchSummary').textContent = '';
    document.getElementById('advancedSearchResults').innerHTML = '<div class="col-12 text-center text-muted py-4">أدخل معيارًا واحدًا على الأقل ثم نفّذ البحث.</div>';
};
window.runAdvancedSearch = async function() {
    const query = (document.getElementById('advancedQuery')?.value || '').trim().toLowerCase();
    const type = document.getElementById('advancedFileType')?.value || '';
    const status = (document.getElementById('advancedStatus')?.value || '').trim().toLowerCase();
    const sessionStatus = (document.getElementById('advancedSessionStatus')?.value || '').trim().toLowerCase();
    const courtService = (document.getElementById('advancedCourtService')?.value || '').trim().toLowerCase();
    const from = document.getElementById('advancedFromDate')?.value ? new Date(`${document.getElementById('advancedFromDate').value}T00:00:00`) : null;
    const to = document.getElementById('advancedToDate')?.value ? new Date(`${document.getElementById('advancedToDate').value}T23:59:59`) : null;
    const matchesText = (values) => !query || values.some(value => String(value || '').toLowerCase().includes(query));
    const matchesStatus = (value) => !status || String(value || '').toLowerCase().includes(status);
    const matchesDate = (date) => { if (!from && !to) return true; const d = new Date(date); return (!from || d >= from) && (!to || d <= to); };
    try {
        const results = [];
        if (type !== 'professional') {
            const cases = await db.cases.filter(c => !c.archived && c.office_id === currentOfficeId).toArray();
            const sessions = await db.sessions.where('office_id').equals(currentOfficeId).toArray();
            const sessionsByCase = sessions.reduce((map, session) => { (map[session.case_id] ||= []).push(session); return map; }, {});
            for (const c of cases) {
                const caseSessions = sessionsByCase[c.id] || [];
                const matchingSessions = caseSessions.filter(s => (!sessionStatus || String(s.case_status || '').toLowerCase().includes(sessionStatus)) && matchesDate(s.session_date));
                const caseText = [c.client_name, c.case_code, c.case_number, c.case_year, c.court_name, c.circuit, c.opponent_name, c.case_subject, ...caseSessions.flatMap(s => [s.case_status, s.decision])];
                const dateMatch = (!from && !to) || matchingSessions.length > 0;
                if ((!type || type === 'judicial') && matchesText(caseText) && matchesStatus(caseSessions[0]?.case_status) && (!courtService || [c.court_name, c.case_type].some(v => String(v || '').toLowerCase().includes(courtService))) && dateMatch) {
                    results.push({ kind: 'judicial', item: c, sessions: caseSessions, sortDate: caseSessions[0]?.session_date || c.updated_at || c.created_at });
                }
            }
        }
        if (type !== 'judicial' && db.officeFiles) {
            const files = await db.officeFiles.where('office_id').equals(currentOfficeId).toArray();
            for (const file of files) {
                const fileText = [file.client_name, file.file_code, file.title, file.description, file.file_type, file.status];
                const fileDate = file.updated_at || file.created_at;
                if ((!type || type === 'professional') && matchesText(fileText) && matchesStatus(file.status) && (!courtService || [file.title, file.file_type].some(v => String(v || '').toLowerCase().includes(courtService))) && matchesDate(fileDate)) {
                    results.push({ kind: 'professional', item: file, sessions: [], sortDate: fileDate });
                }
            }
        }
        results.sort((a, b) => new Date(b.sortDate || 0) - new Date(a.sortDate || 0));
        const summary = document.getElementById('advancedSearchSummary');
        summary.textContent = `عدد النتائج: ${results.length}${advancedSearchMode === 'document' ? ' — اختر قضية لإضافة مستند إليها' : ''}`;
        const container = document.getElementById('advancedSearchResults');
        if (!results.length) { container.innerHTML = '<div class="col-12 text-center text-muted py-4">لا توجد نتائج مطابقة لمعايير البحث.</div>'; return; }
        container.innerHTML = results.map(result => {
            const item = result.item;
            const isJudicial = result.kind === 'judicial';
            const label = isJudicial ? 'ملف قضائي' : professionalTypeLabel(item.file_type);
            const code = isJudicial ? item.case_code : item.file_code;
            const statusLabel = isJudicial ? (result.sessions[0]?.case_status || 'جديدة') : (item.status || 'قيد الإجراء');
            const action = advancedSearchMode === 'document' && isJudicial
                ? `<button class="btn btn-sm btn-outline-info" onclick="event.stopPropagation(); addCaseDocumentForId('${item.id}')"><i class="bi bi-file-earmark-plus"></i> إضافة مستند</button>`
                : `<button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); openAdvancedResult('${result.kind}','${item.id}')"><i class="bi bi-box-arrow-up-right"></i> فتح</button>`;
            return `<div class="col-md-6"><article class="card-glass advanced-result-card p-3" onclick="openAdvancedResult('${result.kind}','${item.id}')"><div class="d-flex justify-content-between gap-2"><strong>${escapeHtml(item.client_name || '-')}</strong><span class="badge bg-secondary">${escapeHtml(label)}</span></div><div class="advanced-result-meta mt-2">${escapeHtml(code || '-')} · ${escapeHtml(statusLabel)}</div><div class="advanced-result-meta">${escapeHtml(isJudicial ? `${item.court_name || '-'} · قضية ${item.case_number || '-'}/${item.case_year || '-'}` : (item.title || '-'))}</div><div class="text-end mt-2">${action}</div></article></div>`;
        }).join('');
    } catch (error) { console.error('البحث المتقدم:', error); Swal.fire('خطأ', 'تعذر تنفيذ البحث المتقدم', 'error'); }
};
window.openAdvancedResult = async function(kind, id) {
    hideModal('advancedSearchModal');
    if (kind === 'judicial') return openCaseDetails(id);
    showModal('professionalFilesModal');
    if (typeof renderProfessionalFiles === 'function') await renderProfessionalFiles();
};
window.addCaseDocumentForId = async function(id) {
    hideModal('advancedSearchModal');
    activeCaseId = id;
    await addCaseDocument();
};
window.addEventListener('keydown', (event) => {
    if (!event.ctrlKey) return;
    if (event.key.toLowerCase() === 'k') { event.preventDefault(); openAdvancedSearchModal(); }
    if (event.key.toLowerCase() === 'n' && !event.shiftKey) { event.preventDefault(); openAddCaseModal(); }
    if (event.key.toLowerCase() === 'u') { event.preventDefault(); openDocumentShortcut(); }
    if (event.key.toLowerCase() === 's') { event.preventDefault(); syncWithSupabase(); }
});

window.saveEditedCase = async function() { if (!ownerOnly('تعديل القضية')) return; const updated = { client_name: document.getElementById('edit_c_name').value, client_phone: document.getElementById('edit_c_phone').value, client_national_id: document.getElementById('edit_c_national_id')?.value || '', client_email: document.getElementById('edit_c_email')?.value || '', client_address: document.getElementById('edit_c_address')?.value || '', opponent_name: document.getElementById('edit_c_opponent').value, opponent_role: document.getElementById('edit_c_opponent_role')?.value || '', opponent_national_id: document.getElementById('edit_c_opponent_national_id')?.value || '', opponent_email: document.getElementById('edit_c_opponent_email')?.value || '', opponent_phone: document.getElementById('edit_c_opponent_phone')?.value || '', opponent_address: document.getElementById('edit_c_opponent_address')?.value || '', case_number: document.getElementById('edit_c_num').value, case_year: document.getElementById('edit_c_year').value, court_name: document.getElementById('edit_c_court').value, circuit: document.getElementById('edit_c_circuit').value, case_type: document.getElementById('edit_case_type').value, case_subject: document.getElementById('edit_c_subject').value, proceeding_type: document.getElementById('edit_case_stage')?.value || 'first_instance', importance: document.getElementById('edit_case_importance')?.value || 'normal', city: document.getElementById('edit_c_city')?.value || '', alert_notes: document.getElementById('edit_c_alert_notes')?.value || '', status: document.getElementById('edit_case_status')?.value || 'جديدة' }; const currentCase = await db.cases.get(activeCaseId); if (!currentCase) throw new Error('القضية غير موجودة'); const caseCode = assertValidCaseCode(currentCase.case_code); await db.cases.update(activeCaseId, updated); await db.pendingOperations.add({ operation: 'update_case', data: { id: activeCaseId, case_code: caseCode, ...updated }, timestamp: Date.now() }); const newParties = collectEditCaseParties(activeCaseId); if (newParties.length) { await db.caseParties.bulkAdd(newParties); for (const party of newParties) await db.pendingOperations.add({ operation: 'upsert_case_party', data: party, timestamp: Date.now() }); } hideModal('editCaseModal'); openCaseDetails(activeCaseId); Swal.fire({ icon: 'success', title: 'تم التعديل محلياً', timer: 1000, showConfirmButton: false, background: '#0f172a' }); updatePendingBadge(); };
window.calculateDate = function() { const startDate = document.getElementById('calcStartDate').value; if (!startDate) return Swal.fire('تنبيه', 'الرجاء اختيار تاريخ البداية', 'warning'); const days = parseInt(document.getElementById('calcDays').value) || 0; const date = new Date(startDate); date.setDate(date.getDate() + days); const resultStr = date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }); document.getElementById('calcResult').innerText = resultStr; window.calculatedDate = date; };
window.addCalculatedDateAsEvent = async function() { if (!window.calculatedDate) return Swal.fire('تنبيه', 'قم بحساب التاريخ أولاً', 'warning'); const dateStr = window.calculatedDate.toISOString().split('T')[0]; const title = prompt('أدخل وصف الحدث:', 'موعد قانوني'); if (title) { const id = await db.events.add({ office_id: currentOfficeId, title, date: dateStr, type: 'legal', created_at: new Date().toISOString() }); await queueEventSync(id, 'insert'); renderCalendar(); Swal.fire('تم', 'تم إضافة الحدث', 'success'); } };
window.addCalculatedDateAsTask = function() { if (!window.calculatedDate) return Swal.fire('تنبيه', 'قم بحساب التاريخ أولاً', 'warning'); const dateStr = window.calculatedDate.toISOString().split('T')[0]; const desc = prompt('أدخل وصف المهمة:', 'مهمة قانونية'); if (desc) { db.tasks.add({ description: desc, date: dateStr, completed: false }); renderCalendar(); Swal.fire('تم', 'تم إضافة المهمة', 'success'); } };

// ========== 18. إعادة تعيين التطبيق ==========
window.resetApp = async function() {
    const result = await Swal.fire({
        title: 'تأكيد إعادة التعيين',
        text: 'سيتم حذف جميع البيانات المحلية (القضايا، الجلسات، إعدادات المكتب) وإعادة تشغيل التطبيق. هل أنت متأكد؟',
                                   icon: 'warning',
                                   showCancelButton: true,
                                   confirmButtonColor: '#dc3545',
                                   confirmButtonText: 'نعم، احذف',
                                   cancelButtonText: 'إلغاء',
                                   background: '#0f172a',
                                   color: '#fff'
    });
    if (result.isConfirmed) {
        try {
            await db.delete();
            localStorage.clear();
            sessionStorage.clear();
            Swal.fire({ icon: 'success', title: 'تم المسح', text: 'سيتم إعادة تشغيل التطبيق الآن', timer: 1500, showConfirmButton: false })
            .then(() => location.reload());
        } catch (err) { Swal.fire('خطأ', 'حدث خطأ أثناء محاولة مسح البيانات', 'error'); }
    }
};

// ========== 18.b النسخ الاحتياطي والاستعادة المحلية (JSON) ==========
// تصدير كامل لبيانات المكتب من الخزين المحلي (Dexie) + إعدادات المتصفح (localStorage)
// إلى ملف JSON يختاره المالك. إضافة فقط: لا نحذف أي بيانات عند التصدير.
window.exportBackup = async function() {
    try {
        const backup = { app: 'qayd', kind: 'full-local-backup', version: 1, exported_at: new Date().toISOString(), office_id: currentOfficeId || null, office_name: currentOfficeName || null, tables: {}, settings: {} };
        for (const table of db.tables) {
            try { backup.tables[table.name] = await table.toArray(); }
            catch (e) { backup.tables[table.name] = []; console.warn(`تعذّر تصدير الجدول ${table.name}`, e?.message || e); }
        }
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) backup.settings[key] = localStorage.getItem(key);
        }
        const jsonContent = JSON.stringify(backup, null, 2);
        const defaultName = `qayd-backup-${(currentOfficeName || 'office').replace(/[^\w\u0600-\u06FF-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
        if (!window.electronAPI?.backupDatabase) return Swal.fire('غير مدعوم', 'ميزة النسخ الاحتياطي متاحة داخل تطبيق سطح المكتب فقط.', 'info');
        const result = await window.electronAPI.backupDatabase(jsonContent, defaultName);
        if (result?.success) Swal.fire({ icon: 'success', title: 'تم حفظ النسخة الاحتياطية', html: `تم حفظ الملف في:<br><small class="text-muted">${escapeHtml(result.filePath || '')}</small>`, background: '#0f172a', color: '#fff' });
        else if (result?.canceled) { /* ألغى المستخدم */ }
        else Swal.fire('تعذّر الحفظ', result?.error || 'حدث خطأ أثناء حفظ النسخة الاحتياطية', 'error');
    } catch (error) { Swal.fire('تعذّر التصدير', error?.message || 'فشل إنشاء النسخة الاحتياطية', 'error'); }
};

// استعادة كاملة من ملف JSON: نستبدل بيانات الجداول المحلية ونعيد الإعدادات.
// قبل الاستبدال نأخذ نسخة أمان سريعة داخل الذاكرة، ونطلب تأكيداً صريحاً.
window.importBackup = async function() {
    try {
        if (!window.electronAPI?.restoreDatabase) return Swal.fire('غير مدعوم', 'ميزة الاستعادة متاحة داخل تطبيق سطح المكتب فقط.', 'info');
        const picked = await window.electronAPI.restoreDatabase();
        if (!picked?.success) { if (!picked?.canceled) Swal.fire('تعذّر القراءة', picked?.error || 'لم يتم اختيار ملف صالح', 'error'); return; }
        let backup;
        try { backup = JSON.parse(picked.content); } catch (e) { return Swal.fire('ملف غير صالح', 'تعذّر تحليل محتوى ملف JSON', 'error'); }
        if (!backup || backup.kind !== 'full-local-backup' || !backup.tables) return Swal.fire('ملف غير معروف', 'هذا الملف ليس نسخة احتياطية صادرة من تطبيق قيد.', 'warning');
        const tableNames = Object.keys(backup.tables);
        const totalRows = tableNames.reduce((sum, name) => sum + (Array.isArray(backup.tables[name]) ? backup.tables[name].length : 0), 0);
        const confirm = await Swal.fire({
            title: 'تأكيد الاستعادة',
            html: `سيتم استبدال بيانات هذا الجهاز بمحتوى النسخة الاحتياطية.<br><strong>تاريخ النسخة:</strong> ${backup.exported_at ? new Date(backup.exported_at).toLocaleString('ar-EG') : 'غير معروف'}<br><strong>عدد السجلات:</strong> ${totalRows}<br><span class="text-warning">يُنصح بالاحتفاظ بنسخة احتياطية حالية أولاً.</span>`,
            icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc3545', confirmButtonText: 'استعادة الآن', cancelButtonText: 'إلغاء', background: '#0f172a', color: '#fff'
        });
        if (!confirm.isConfirmed) return;
        Swal.fire({ title: 'جارٍ الاستعادة...', allowOutsideClick: false, didOpen: () => Swal.showLoading(), background: '#0f172a', color: '#fff' });
        for (const name of tableNames) {
            const table = db.table(name);
            if (!table) continue;
            const rows = Array.isArray(backup.tables[name]) ? backup.tables[name] : [];
            await table.clear();
            if (rows.length) await table.bulkPut(rows);
        }
        if (backup.settings && typeof backup.settings === 'object') {
            for (const [key, value] of Object.entries(backup.settings)) {
                try { if (value !== null && value !== undefined) localStorage.setItem(key, value); } catch (e) { /* تجاهل مفاتيح غير قابلة للحفظ */ }
            }
        }
        Swal.close();
        await Swal.fire({ icon: 'success', title: 'تمت الاستعادة', text: 'سيتم إعادة تشغيل التطبيق الآن لتطبيق البيانات المستعادة.', timer: 1800, showConfirmButton: false, background: '#0f172a', color: '#fff' });
        location.reload();
    } catch (error) { Swal.close(); Swal.fire('تعذّرت الاستعادة', error?.message || 'فشلت عملية الاستعادة', 'error'); }
};

// ========== 19. التهيئة النهائية ==========
document.addEventListener('DOMContentLoaded', async () => {
    const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
    if (document.getElementById('s_date')) document.getElementById('s_date').value = nextWeek.toISOString().slice(0, 16);
    if (document.getElementById('newEventDate')) document.getElementById('newEventDate').value = new Date().toISOString().split('T')[0];
    if (document.getElementById('calcStartDate')) document.getElementById('calcStartDate').value = new Date().toISOString().split('T')[0];
    await renderCalendar();
    bindManualTabs();
    document.querySelectorAll('.tab-pane').forEach(pane => { pane.style.display = 'none'; });
    await initSupabase();
    const hasOffice = await checkOfficeSetup();
    if (!hasOffice) showModal('officeSetupModal');
    if (hasOffice) {
        runBackgroundSync();
        scheduleBackgroundSync();
        window.addEventListener('focus', runBackgroundSync);
        window.addEventListener('online', handleBackOnline);
    }
});

// ========== 20. مودال الإعدادات (إضافة هذه الدالة في النهاية) ==========
window.showSettingsModal = function() {
    showModal('settingsModal');
};

// ========== المجموعة C: أدوات التصميم (حالات التحميل/الفارغ + مركز الإشعارات) ==========
// C3: طبقة تحميل عامة + مولّد حالة فارغة موحّد، تُستخدم في الصفحات دون تغيير منطقها.
window.showLoadingOverlay = function() { const el = document.getElementById('globalLoadingOverlay'); if (el) el.classList.add('show'); };
window.hideLoadingOverlay = function() { const el = document.getElementById('globalLoadingOverlay'); if (el) el.classList.remove('show'); };
window.emptyStateHtml = function(message, icon) {
    return `<div class="empty-state"><i class="bi ${icon || 'bi-inbox'}"></i><div>${escapeHtml(message || 'لا توجد بيانات لعرضها.')}</div></div>`;
};

// C4: مركز الإشعارات — يجمع ما يحتاج انتباه المالك: عمليات معلقة، تعارضات، مهام متأخرة، وطلبات اعتماد الهاتف.
async function computeNotifications() {
    const todayKey = new Date().toISOString().slice(0, 10);
    const items = [];
    const pending = await db.pendingOperations.count().catch(() => 0);
    if (pending > 0) items.push({ icon: 'bi-arrow-repeat', cls: '', title: `عمليات في انتظار الرفع: ${pending}`, desc: 'ستُرفع تلقائياً عند توفر الاتصال.' });
    const lateTasks = await db.tasks.filter(t => !t.completed && t.date && t.date < todayKey && (!t.office_id || t.office_id === currentOfficeId)).toArray().catch(() => []);
    if (lateTasks.length) items.push({ icon: 'bi-list-check', cls: 'warn', title: `مهام متأخرة: ${lateTasks.length}`, desc: 'افتح الأجندة لمراجعتها.' });
    const conflicts = await db.syncConflicts.filter(c => c.office_id === currentOfficeId && c.status === 'pending').toArray().catch(() => []);
    if (conflicts.length) items.push({ icon: 'bi-exclamation-octagon', cls: 'warn', title: `تعارضات مزامنة معلقة: ${conflicts.length}`, desc: 'راجعها من بوابة المالك.' });
    const requests = await db.approvalRequests.filter(r => r.office_id === currentOfficeId && r.status === 'pending').toArray().catch(() => []);
    if (requests.length) items.push({ icon: 'bi-shield-check', cls: '', title: `طلبات اعتماد من الهاتف: ${requests.length}`, desc: 'افتح مركز اعتماد الهاتف للمراجعة.' });
    if (syncState.lastError) items.push({ icon: 'bi-wifi-off', cls: 'warn', title: 'آخر محاولة مزامنة فشلت', desc: 'ستُعاد تلقائياً؛ تحقق من الاتصال.' });
    if (!items.length) items.push({ icon: 'bi-check-circle', cls: '', title: 'لا توجد إشعارات', desc: 'كل شيء تحت السيطرة.' });
    return items;
}
async function renderNotificationsCenter() {
    const host = document.getElementById('notificationsList');
    const countEl = document.getElementById('notifCount');
    if (!host) return;
    try {
        const items = await computeNotifications();
        const actionable = items.filter(i => !i.title.startsWith('لا توجد')).length;
        if (countEl) { countEl.innerText = actionable; countEl.style.display = actionable ? 'inline-block' : 'none'; }
        host.innerHTML = items.map(i => `<div class="notif-item ${i.cls}"><i class="bi ${i.icon} ni-icon"></i><div><div class="fw-bold">${escapeHtml(i.title)}</div><div class="small text-muted">${escapeHtml(i.desc)}</div></div></div>`).join('');
    } catch (error) { host.innerHTML = `<div class="text-danger small">تعذّر تحميل الإشعارات: ${escapeHtml(error?.message || '')}</div>`; }
}
window.openNotificationsCenter = async function() { showModal('notificationsModal'); await renderNotificationsCenter(); };
window.refreshNotificationsCenter = renderNotificationsCenter;


// ========== 18. الملفات المهنية ==========
// هذه الدوال تفصل الخدمات المهنية عن القضايا القضائية وتحافظ على التوليد المحلي للكود.
function generateProfessionalFileCode(fileType) {
    // القضائي محفوظ في جدول cases؛ هذه الأكواد للملفات الإجرائية والخدمية التي لا تملك جلسات محكمة.
    const prefixMap = { prosecution_investigation: 'PI', detention_renewal: 'DR', dispute_committee: 'DC', grievance: 'GR', legal_procedure: 'PR', real_estate: 'RE', contract_writing: 'CT', company_formation: 'CO', administrative: 'AD' };
    const prefix = prefixMap[fileType];
    if (!prefix) throw new Error('نوع الملف المهني غير صالح');
    const year = String(new Date().getFullYear()).slice(-2);
    const sequence = String(Date.now()).slice(-6).padStart(6, '0');
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${year}-${sequence}-${random}`;
}
function assertValidProfessionalFileCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^(RE|CT|CO|PI|DR|DC|GR|PR|AD)-[0-9]{2}-[0-9]{6}-[A-Z0-9]{6}$/.test(normalized)) {
        throw new Error('كود الملف المهني غير صالح');
    }
    return normalized;
}
function professionalTypeLabel(type) {
    return { prosecution_investigation: 'تحقيقات النيابة', detention_renewal: 'تجديد الحبس', dispute_committee: 'لجان فض المنازعات', grievance: 'التظلمات', legal_procedure: 'إجراءات قانونية', real_estate: 'تسجيل العقارات', contract_writing: 'العقود', company_formation: 'تأسيس الشركات', administrative: 'خدمة إدارية' }[type] || 'ملف إجرائي/خدمي';
}
window.openProfessionalFileModal = async function() {
    if (!currentOfficeId) return Swal.fire('تنبيه', 'يجب إعداد المكتب أولًا', 'warning');
    const type = document.getElementById('professionalFileType');
    const title = document.getElementById('professionalFileTitle');
    const client = document.getElementById('professionalClientName');
    const phone = document.getElementById('professionalClientPhone');
    const description = document.getElementById('professionalFileDescription');
    if (type) type.value = 'prosecution_investigation';
    const modalTitle = document.getElementById('professionalFileModalTitle'); if (modalTitle) modalTitle.innerHTML = '<i class="bi bi-folder-plus"></i> إنشاء ملف إجرائي/خدمي';
    ['professionalClientRole','professionalClientNationalId','professionalClientEmail','professionalClientAddress','professionalOpponentName','professionalOpponentRole','professionalOpponentPhone','professionalOpponentNationalId','professionalOpponentEmail','professionalOpponentAddress','professionalFeeTotal','professionalFeePaid','professionalFeeNotes','professionalExpenseAmount','professionalExpenseCategory','professionalLastActionDate','professionalLastAction','professionalNextActionDate','professionalNextAction'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if (title) title.value = '';
    if (client) client.value = '';
    if (phone) phone.value = '';
    if (description) description.value = '';
    showModal('professionalFileModal');
};
// نقطة الدخول الموحدة للملفات الإجرائية والخدمية؛ يبدأ النموذج بتحقيقات النيابة.
window.openProcedureFileModal = async function() {
    await window.openProfessionalFileModal();
};
// أسماء قديمة محفوظة للتوافق مع اختصارات الإصدارات السابقة.
window.openAdministrativeFileModal = window.openProcedureFileModal;
window.openInvestigationFileModal = window.openProcedureFileModal;
window.saveProfessionalFile = async function() { const editingId = document.getElementById('editingProfessionalFileId')?.value || ''; if (editingId && !ownerOnly('تعديل الملف المهني')) return;
    try {
        if (!currentOfficeId) throw new Error('لم يتم تحديد المكتب');
        const fileType = document.getElementById('professionalFileType').value;
        const clientName = document.getElementById('professionalClientName').value.trim();
        const clientPhone = document.getElementById('professionalClientPhone').value.trim();
        const title = document.getElementById('professionalFileTitle').value.trim();
        const description = document.getElementById('professionalFileDescription').value.trim();
        if (!clientName || !clientPhone || !title) throw new Error('أدخل اسم العميل والهاتف واسم الملف');
        const fileCode = assertValidProfessionalFileCode(generateProfessionalFileCode(fileType));
        const editingId = document.getElementById('editingProfessionalFileId')?.value || '';
        const followup = { last_action_date: document.getElementById('professionalLastActionDate')?.value || null, last_action: document.getElementById('professionalLastAction')?.value.trim() || '', next_action_date: document.getElementById('professionalNextActionDate')?.value || null, next_action: document.getElementById('professionalNextAction')?.value.trim() || '' };
        const file = { id: editingId || generateUUID(), office_id: currentOfficeId, file_code: editingId ? (await db.officeFiles.get(editingId)).file_code : fileCode, file_type: fileType, title, authority_file_number: document.getElementById('professionalAuthorityFileNumber')?.value.trim() || '', authority_file_year: document.getElementById('professionalAuthorityFileYear')?.value.trim() || '', authority_name: document.getElementById('professionalAuthorityName')?.value.trim() || '', client_name: clientName, client_role: document.getElementById('professionalClientRole')?.value.trim() || '', client_phone: clientPhone, client_national_id: document.getElementById('professionalClientNationalId')?.value.trim() || '', client_email: document.getElementById('professionalClientEmail')?.value.trim() || '', client_address: document.getElementById('professionalClientAddress')?.value.trim() || '', opponent_name: document.getElementById('professionalOpponentName')?.value.trim() || '', opponent_role: document.getElementById('professionalOpponentRole')?.value.trim() || '', opponent_phone: document.getElementById('professionalOpponentPhone')?.value.trim() || '', opponent_national_id: document.getElementById('professionalOpponentNationalId')?.value.trim() || '', opponent_email: document.getElementById('professionalOpponentEmail')?.value.trim() || '', opponent_address: document.getElementById('professionalOpponentAddress')?.value.trim() || '', status: 'مفتوح', description: description || null, metadata: editingId ? ((await db.officeFiles.get(editingId)).metadata || {}) : {}, archived: false, created_at: editingId ? (await db.officeFiles.get(editingId)).created_at : new Date().toISOString(), updated_at: new Date().toISOString() };
        file.metadata.followup = followup;
        if (editingId) await db.officeFiles.update(editingId, file); else await db.officeFiles.add(file);
        const firstEvent = {
            id: generateUUID(), office_id: currentOfficeId, file_id: file.id,
            event_date: new Date().toISOString(), event_type: 'created', status: 'مفتوح',
            title: 'فتح الملف', details: 'تم إنشاء الملف في qayd', client_visible: true,
            created_at: new Date().toISOString()
        };
        if (!editingId) await db.fileEvents.add(firstEvent);
        else if (followup.last_action || followup.next_action) await db.fileEvents.add({ id: generateUUID(), office_id: currentOfficeId, file_id: editingId, event_date: followup.last_action_date || new Date().toISOString(), event_type: 'update', status: 'مفتوح', title: followup.last_action || 'تحديث الملف', details: followup.next_action || '', client_visible: true, created_at: new Date().toISOString() });
        const feeTotal = parseFloat(document.getElementById('professionalFeeTotal')?.value) || 0;
        const feePaid = parseFloat(document.getElementById('professionalFeePaid')?.value) || 0;
        if (feeTotal > 0 || feePaid > 0) {
            await db.fees.put({ case_id: file.id, total: feeTotal, paid: feePaid, remaining: feeTotal - feePaid, notes: document.getElementById('professionalFeeNotes')?.value || '' });
            if (feePaid > 0) await db.payments.add({ case_id: file.id, amount: feePaid, date: new Date().toISOString().split('T')[0], note: 'دفعة مقدمة' });
        }
        const initialExpense = parseFloat(document.getElementById('professionalExpenseAmount')?.value) || 0;
        if (initialExpense > 0) await db.expenses.add({ office_id: currentOfficeId, owner_id: file.id, case_id: file.id, amount: initialExpense, date: new Date().toISOString().split('T')[0], category: document.getElementById('professionalExpenseCategory')?.value || 'مصروف ابتدائي' });
        await db.pendingOperations.bulkAdd([
            { operation: editingId ? 'update_office_file' : 'insert_office_file', data: file, timestamp: Date.now() },
            ...(!editingId ? [{ operation: 'insert_file_event', data: firstEvent, timestamp: Date.now() }] : [])
        ]);
        if (ipcRenderer && ipcRenderer.createProfessionalFileFolder) {
            await ipcRenderer.createProfessionalFileFolder(file.file_code, file.client_name, file.file_type, file);
        }
        hideModal('professionalFileModal');
        const editingField = document.getElementById('editingProfessionalFileId'); if (editingField) editingField.value = '';
        if (typeof renderProfessionalFiles === 'function') await renderProfessionalFiles();
        await loadCasesList();
        updatePendingBadge();
        Swal.fire({ icon: 'success', title: 'تم إنشاء الملف', html: `<div>كود الملف: <strong>${file.file_code}</strong></div>`, background: '#0f172a', color: '#fff' });
    } catch (error) {
        console.error('فشل إنشاء الملف المهني:', error);
        Swal.fire('خطأ', error.message || 'تعذر إنشاء الملف المهني', 'error');
    }
};
async function renderProfessionalFiles() {
    const container = document.getElementById('professionalFilesList');
    if (!container || !currentOfficeId) return;
    const files = await db.officeFiles.where('office_id').equals(currentOfficeId).reverse().sortBy('updated_at');
    if (!files.length) { container.innerHTML = '<div class="text-muted text-center py-3">لا توجد ملفات مهنية بعد.</div>'; return; }
    container.innerHTML = files.reverse().map(file => `<div class="professional-file-row"><div><strong>${file.title}</strong><div class="small text-white-50">${professionalTypeLabel(file.file_type)} · ${file.client_name}</div></div><span class="professional-code">${file.file_code}</span><span class="badge bg-secondary">${file.status}</span></div>`).join('');
}
window.openProfessionalFilesPanel = async function() { showModal('professionalFilesModal'); await renderProfessionalFiles(); };

// ========== 19. النموذج العام للملفات القانونية ==========
const legalFileTypeLabels = { judicial: 'قضائي', real_estate: 'تسجيل عقاري', corporate: 'شركات', power_of_attorney: 'توكيل', contract: 'عقد', legal_consultation: 'استشارة', government_service: 'خدمة حكومية', enforcement: 'تنفيذ', other: 'أخرى' };
const legalFileStatusLabels = { new: 'جديد', submitting: 'قيد الرفع', in_progress: 'قيد العمل', needs_action: 'يحتاج إجراء', on_hold: 'متوقف', completed: 'مكتمل', archived: 'مؤرشف', open: 'جديد' };
function normalizeLegalFileStatus(status) { const value = String(status || '').trim(); return value === 'open' || !legalFileStatusLabels[value] ? 'new' : value; }
const proceedingTypeLabels = { first_instance: 'أول درجة', appeal: 'استئناف', cassation: 'نقض', retrial: 'إعادة نظر', opposition: 'معارضة', enforcement: 'تنفيذ', execution_objection: 'إشكال تنفيذ', other: 'أخرى' };
function generateLegalFileCode(type) { const prefix = { judicial: 'JU', real_estate: 'RE', corporate: 'CO', power_of_attorney: 'PO', contract: 'CT', legal_consultation: 'LC', government_service: 'GS', enforcement: 'EX', other: 'OT' }[type] || 'OT'; return `${prefix}-${String(new Date().getFullYear()).slice(-2)}-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`; }
window.openLegalFileModal = function() {
    if (!ownerOnly('إنشاء ملف قانوني')) return;
    ['legalFileTitle','legalFileClient','legalFilePhone','legalFileDescription','legalCourt','legalCaseNumber','legalActionType','legalAuthority','legalFollowup'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const type = document.getElementById('legalFileType'); if (type) type.value = 'judicial';
    if (type) type.onchange = () => { document.querySelectorAll('.judicial-field').forEach(el => { el.style.display = type.value === 'judicial' ? '' : 'none'; }); document.querySelectorAll('.service-field').forEach(el => { el.style.display = type.value === 'judicial' ? 'none' : ''; }); };
    document.querySelectorAll('.judicial-field').forEach(el => { el.style.display = ''; });
    document.querySelectorAll('.service-field').forEach(el => { el.style.display = 'none'; });
    showModal('legalFileModal');
};
window.saveLegalFile = async function() {
    if (!ownerOnly('إنشاء ملف قانوني')) return;
    try {
        const fileType = document.getElementById('legalFileType').value;
        const title = document.getElementById('legalFileTitle').value.trim();
        const clientName = document.getElementById('legalFileClient').value.trim();
        if (!title || !clientName) throw new Error('أدخل عنوان الملف واسم العميل');
        const now = new Date().toISOString();
        const file = { id: `MAT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, office_id: currentOfficeId, file_code: generateLegalFileCode(fileType), file_type: fileType, title, status: 'new', client_name: clientName, client_phone: document.getElementById('legalFilePhone').value.trim(), description: document.getElementById('legalFileDescription').value.trim(), opened_at: now.slice(0, 10), metadata: {}, created_at: now, updated_at: now };
        await db.legalFiles.put(file);
        await db.pendingOperations.add({ operation: 'upsert_legal_file', data: file, timestamp: Date.now() });
        if (fileType === 'judicial') {
            const proceeding = { id: `PR-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, legal_file_id: file.id, office_id: currentOfficeId, proceeding_type: document.getElementById('legalProceedingType').value, court_name: document.getElementById('legalCourt').value.trim(), case_number: document.getElementById('legalCaseNumber').value.trim(), case_year: '', status: 'open', metadata: {}, created_at: now, updated_at: now };
            await db.proceedings.put(proceeding);
            await db.pendingOperations.add({ operation: 'upsert_proceeding', data: proceeding, timestamp: Date.now() });
        } else {
            const action = { id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, legal_file_id: file.id, office_id: currentOfficeId, action_type: document.getElementById('legalActionType').value.trim() || 'فتح الملف ومراجعة المستندات', sequence_order: 1, step_status: 'pending', authority: document.getElementById('legalAuthority').value.trim(), next_followup_at: document.getElementById('legalFollowup').value || null, status: 'new', notes: '', created_at: now, updated_at: now };
            await db.serviceActions.put(action);
            await db.pendingOperations.add({ operation: 'upsert_service_action', data: action, timestamp: Date.now() });
        }
        hideModal('legalFileModal'); updatePendingBadge(); await renderLegalFiles();
        Swal.fire({ icon: 'success', title: 'تم إنشاء الملف القانوني', html: `<strong>${file.file_code}</strong>`, timer: 1800, showConfirmButton: false, background: '#0f172a', color: '#fff' });
    } catch (error) { Swal.fire('خطأ', error.message || 'تعذر إنشاء الملف', 'error'); }
};
async function renderLegalFiles() {
    const container = document.getElementById('legalFilesList'); if (!container || !currentOfficeId) return;
    const files = await db.legalFiles.where('office_id').equals(currentOfficeId).toArray(); files.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    if (!files.length) { container.innerHTML = '<div class="text-muted text-center py-4">لا توجد ملفات قانونية. ابدأ بإنشاء ملف رئيسي.</div>'; return; }
    container.innerHTML = files.map(file => { const status = normalizeLegalFileStatus(file.status); return `<div class="professional-file-row"><div><strong>${escapeHtml(file.title)}</strong><div class="small text-muted">${legalFileTypeLabels[file.file_type] || file.file_type} · ${escapeHtml(file.client_name)}</div></div><span class="professional-code">${escapeHtml(file.file_code)}</span><span class="badge bg-secondary">${legalFileStatusLabels[status]}</span><button class="btn btn-sm btn-outline-primary" onclick="openLegalFileDetails('${escapeHtml(file.id)}')">فتح الملف</button></div>`; }).join('');
}
window.openLegalFilesPanel = async function() { showModal('legalFilesModal'); await renderLegalFiles(); };
window.openLegalFileDetails = async function(fileId) {
    const file = await db.legalFiles.get(fileId); if (!file) return;
    const proceedings = await db.proceedings.where('legal_file_id').equals(fileId).toArray();
    const actions = await db.serviceActions.where('legal_file_id').equals(fileId).toArray();
    const stages = proceedings.map(p => `<div class="border rounded p-2 mb-2"><strong>${proceedingTypeLabels[p.proceeding_type] || p.proceeding_type}</strong> · ${escapeHtml(p.court_name || 'محكمة غير محددة')} · ${escapeHtml(p.case_number || 'رقم غير محدد')}<div class="small text-muted">${escapeHtml(p.status || '')}</div></div>`).join('');
    const service = actions.sort((a,b) => Number(a.sequence_order || 1) - Number(b.sequence_order || 1)).map(a => `<div class="border rounded p-2 mb-2"><strong>${escapeHtml(a.step_title || a.action_type)}</strong> · ${escapeHtml(a.authority || 'جهة غير محددة')}<div class="small text-muted">${escapeHtml(a.step_status || a.status || '')} ${a.next_followup_at ? `· متابعة ${a.next_followup_at}` : ''}${a.blocked_reason ? ` · سبب التعطيل: ${escapeHtml(a.blocked_reason)}` : ''}</div></div>`).join('');
    const status = normalizeLegalFileStatus(file.status);
    await Swal.fire({ title: file.title, html: `<div class="text-end"><p>${escapeHtml(file.client_name)} · <strong>${escapeHtml(file.file_code)}</strong> · <span class="badge bg-secondary">${legalFileStatusLabels[status]}</span></p><hr><h6>المراحل القضائية</h6>${stages || '<p class="text-muted">لا توجد مراحل إضافية.</p>'}<h6>إجراءات الخدمات</h6>${service || '<p class="text-muted">لا توجد إجراءات مسجلة.</p>'}</div>`, confirmButtonText: 'إغلاق', background: '#fff', color: '#172b45', width: 720 });
};

window.showTeamManagement = function() { if (!ownerOnly('إدارة الفريق')) return; showModal('teamManagementModal'); };
window.createDesktopInvite = async function() { if (!ownerOnly('إدارة الفريق')) return; const contact=document.getElementById('teamInviteContact').value.trim(); const role=document.getElementById('teamInviteRole').value; if(!contact) return Swal.fire('تنبيه','أدخل البريد أو الهاتف','warning'); const {data,error}=await supabaseClient.rpc('create_office_invite',{p_office_id:currentOfficeId,p_contact:contact,p_role:role,p_expires_hours:168}); if(error) return Swal.fire('خطأ',error.message,'error'); document.getElementById('teamInviteResult').textContent=`الكود: ${data.code} — صالح 7 أيام`; };
window.createDesktopRecoveryCodes = async function() { if (!ownerOnly('إنشاء رموز الاسترداد')) return; const {data,error}=await supabaseClient.rpc('create_owner_recovery_codes',{p_office_id:currentOfficeId,p_count:8}); if(error) return Swal.fire('خطأ',error.message,'error'); document.getElementById('teamRecoveryResult').textContent=data.join('\n'); };


// ========== 20. مركز اعتماد المالك وحل تعارضات المزامنة ==========
const reviewTableMap = { case: 'cases', proceeding: 'proceedings', session: 'sessions', task: 'tasks', note: 'notes', fee: 'fees', payment: 'payments', expense: 'expenses', financial_transaction: 'financial_transactions', service_action: 'service_actions', legal_file: 'legal_files' };
function reviewPayloadTable(entityType) { return reviewTableMap[entityType] || null; }
function reviewEntityLabel(entityType) { return { case: 'قضية', proceeding: 'مرحلة تقاضٍ', session: 'جلسة', task: 'مهمة', note: 'ملاحظة', fee: 'أتعاب', payment: 'متحصل/دفعة', expense: 'مصروف', financial_transaction: 'حركة مالية أو نفقة', service_action: 'إجراء خدمة', legal_file: 'ملف قانوني' }[entityType] || entityType; }
function reviewConflictLabel(status) { return { pending: 'معلق', resolved_local: 'اعتمدت النسخة المحلية', resolved_remote: 'اعتمدت النسخة البعيدة', dismissed: 'تم تجاهله' }[status] || status; }
async function ensureReviewOwner() { return currentUserRole === 'manager' && currentOfficeId === OWNER_OFFICE_ID && await ensureDesktopSupabaseSession(); }
function updateOwnerReviewBadge(count) { const badge = document.getElementById('ownerReviewBadge'); if (badge) { badge.innerText = count; badge.style.display = count ? 'inline-block' : 'none'; } }
async function loadOwnerReviewData() {
    if (!(await ensureReviewOwner())) throw new Error('مركز الاعتماد متاح لمالك المكتب فقط');
    const [{ data: requests, error: requestsError }, { data: conflicts, error: conflictsError }] = await Promise.all([
        supabaseClient.from('approval_requests').select('*').eq('office_id', currentOfficeId).eq('status', 'pending').order('created_at', { ascending: false }).limit(200),
        supabaseClient.from('sync_conflicts').select('*').eq('office_id', currentOfficeId).eq('status', 'pending').order('created_at', { ascending: false }).limit(200)
    ]);
    if (requestsError) throw requestsError; if (conflictsError) throw conflictsError;
    await db.approvalRequests.bulkPut(requests || []); await db.syncConflicts.bulkPut(conflicts || []);
    return { requests: requests || [], conflicts: conflicts || [] };
}
function formatReviewPayload(payload) { const entries = Object.entries(payload || {}).filter(([key]) => !['created_at','updated_at','office_id'].includes(key)).slice(0, 12); return entries.map(([key, value]) => `<div class="small"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''))}</div>`).join(''); }
function renderOwnerReviewData({ requests, conflicts }) {
    const requestHost = document.getElementById('ownerApprovalRequestsList'); const conflictHost = document.getElementById('ownerSyncConflictsList');
    document.getElementById('ownerReviewPendingCount').innerText = requests.length; document.getElementById('ownerConflictCount').innerText = conflicts.length; updateOwnerReviewBadge(requests.length + conflicts.length);
    if (requestHost) requestHost.innerHTML = requests.length ? requests.map(r => `<div class="border rounded p-3 mb-2"><div class="d-flex justify-content-between"><strong>${escapeHtml(reviewEntityLabel(r.entity_type))} · ${escapeHtml(r.action)}</strong><span class="small text-muted">${new Date(r.created_at).toLocaleString('ar-EG')}</span></div><div class="small text-muted mt-1">الكيان: ${escapeHtml(r.entity_id)}${r.reason ? ` · السبب: ${escapeHtml(r.reason)}` : ''}</div><div class="bg-light rounded p-2 mt-2">${formatReviewPayload(r.payload)}</div><div class="d-flex gap-2 mt-2"><button class="btn btn-sm btn-success" onclick="reviewApprovalRequest('${escapeHtml(r.id)}','approved')">اعتماد وتطبيق</button><button class="btn btn-sm btn-outline-danger" onclick="reviewApprovalRequest('${escapeHtml(r.id)}','rejected')">رفض</button></div></div>`).join('') : '<div class="text-muted py-3">لا توجد طلبات هاتف معلقة.</div>';
    if (conflictHost) conflictHost.innerHTML = conflicts.length ? conflicts.map(c => `<div class="border border-danger rounded p-3 mb-2"><div class="d-flex justify-content-between"><strong>${escapeHtml(c.entity_type)} · ${escapeHtml(c.entity_id)}</strong><span class="small text-muted">${new Date(c.created_at).toLocaleString('ar-EG')}</span></div><div class="row g-2 mt-1"><div class="col-md-6"><div class="small fw-bold text-primary">النسخة المحلية</div><div class="bg-light rounded p-2">${formatReviewPayload(c.local_payload)}</div></div><div class="col-md-6"><div class="small fw-bold text-danger">النسخة البعيدة</div><div class="bg-light rounded p-2">${formatReviewPayload(c.remote_payload)}</div></div></div><div class="d-flex gap-2 mt-2"><button class="btn btn-sm btn-primary" onclick="resolveSyncConflict('${escapeHtml(c.id)}','local')">اعتماد المحلية</button><button class="btn btn-sm btn-danger" onclick="resolveSyncConflict('${escapeHtml(c.id)}','remote')">اعتماد البعيدة</button><button class="btn btn-sm btn-outline-secondary" onclick="resolveSyncConflict('${escapeHtml(c.id)}','dismiss')">تجاهل</button></div></div>`).join('') : '<div class="text-muted py-3">لا توجد تعارضات معلقة.</div>';
}
window.refreshOwnerReviewCenter = async function() { try { const data = await loadOwnerReviewData(); renderOwnerReviewData(data); } catch (error) { Swal.fire('تعذر التحديث', error.message || 'فشل تحميل مركز الاعتماد', 'error'); } };
window.openOwnerReviewCenter = async function() { if (!(await ensureReviewOwner())) return Swal.fire('غير مسموح', 'هذه الشاشة متاحة لمالك المكتب فقط', 'warning'); showModal('ownerReviewModal'); await refreshOwnerReviewCenter(); };
async function applyReviewPayload(entityType, payload, localOnly = false, entityId = null) {
    const tableName = reviewPayloadTable(entityType); if (!tableName || !payload) throw new Error(`نوع كيان غير مدعوم: ${entityType}`);
    const table = db[({ legal_files: 'legalFiles', service_actions: 'serviceActions', proceedings: 'proceedings', approval_requests: 'approvalRequests' }[tableName] || tableName)];
    if (localOnly) { if (table) await table.put(payload); return; }
    const data = { ...payload, office_id: payload.office_id || currentOfficeId };
    if (entityId && entityType !== 'fee' && entityType !== 'payment') data.id = data.id || entityId;
    const conflict = tableName === 'fees' ? 'case_id' : 'id';
    const { error } = await supabaseClient.from(tableName).upsert(data, { onConflict: conflict }); if (error) throw error;
    if (table) await table.put(payload);
    if (entityType === 'payment' && payload.case_id && Number(payload.amount) > 0) {
        const { data: fee } = await supabaseClient.from('fees').select('case_id,total,paid,remaining,notes').eq('case_id', payload.case_id).maybeSingle();
        if (fee) await supabaseClient.from('fees').upsert({ ...fee, paid: Number(fee.paid || 0) + Number(payload.amount), remaining: Number(fee.total || 0) - Number(fee.paid || 0) - Number(payload.amount) }, { onConflict: 'case_id' });
    }
}
window.reviewApprovalRequest = async function(id, decision) {
    if (!(await ensureReviewOwner())) return;
    const request = await db.approvalRequests.get(id); if (!request) return Swal.fire('غير موجود', 'تعذر العثور على طلب الاعتماد', 'error');
    const noteResult = await Swal.fire({ title: decision === 'approved' ? 'اعتماد طلب الهاتف' : 'رفض طلب الهاتف', input: 'textarea', inputLabel: 'ملاحظة المالك (اختيارية)', inputPlaceholder: 'سبب القرار أو تعليمات للفريق', showCancelButton: true, confirmButtonText: decision === 'approved' ? 'اعتماد وتطبيق' : 'رفض الطلب', cancelButtonText: 'إلغاء', confirmButtonColor: decision === 'approved' ? '#198754' : '#dc3545' });
    if (!noteResult.isConfirmed) return;
    try {
        if (decision === 'approved') {
            const versionedTypes = new Set(['case','proceeding','session','task','note','expense','financial_transaction','service_action','legal_file']);
            if (request.base_updated_at && versionedTypes.has(request.entity_type)) {
                const tableName = reviewPayloadTable(request.entity_type);
                const { data: current } = await supabaseClient.from(tableName).select('*').eq('id', request.entity_id).eq('office_id', currentOfficeId).maybeSingle();
                if (current?.updated_at && new Date(current.updated_at) > new Date(request.base_updated_at)) {
                    await supabaseClient.from('sync_conflicts').insert({ office_id: currentOfficeId, entity_type: request.entity_type, entity_id: request.entity_id, local_payload: request.payload, remote_payload: current, base_updated_at: request.base_updated_at, status: 'pending' });
                    throw new Error('تم إيقاف الاعتماد وفتح تعارض للمراجعة لأن السجل تغيّر بعد آخر قراءة من الهاتف');
                }
            }
            await applyReviewPayload(request.entity_type, request.payload, false, request.entity_id);
        }
        const user = (await supabaseClient.auth.getUser()).data.user;
        const update = { status: decision, reviewed_by: user?.id || null, reviewed_at: new Date().toISOString(), review_note: noteResult.value || null };
        const { error } = await supabaseClient.from('approval_requests').update(update).eq('id', id).eq('office_id', currentOfficeId); if (error) throw error;
        await db.approvalRequests.update(id, update); await refreshOwnerReviewCenter(); Swal.fire({ icon: 'success', title: decision === 'approved' ? 'تم اعتماد الطلب وتطبيقه' : 'تم رفض الطلب', timer: 1600, showConfirmButton: false });
    } catch (error) { Swal.fire('لم يكتمل القرار', error.message || 'تعذر تطبيق طلب الهاتف', 'error'); }
};
window.resolveSyncConflict = async function(id, choice) {
    if (!(await ensureReviewOwner())) return;
    const conflict = await db.syncConflicts.get(id); if (!conflict) return;
    const confirm = await Swal.fire({ title: choice === 'dismiss' ? 'تجاهل التعارض؟' : `اعتماد النسخة ${choice === 'local' ? 'المحلية' : 'البعيدة'}؟`, text: 'سيتم تسجيل القرار باسم مالك المكتب.', icon: 'warning', showCancelButton: true, confirmButtonText: 'تأكيد', cancelButtonText: 'إلغاء' }); if (!confirm.isConfirmed) return;
    try {
        if (choice === 'local') await applyReviewPayload(conflict.entity_type, conflict.local_payload, false, conflict.entity_id);
        if (choice === 'remote') await applyReviewPayload(conflict.entity_type, conflict.remote_payload, true, conflict.entity_id);
        const user = (await supabaseClient.auth.getUser()).data.user; const status = choice === 'local' ? 'resolved_local' : choice === 'remote' ? 'resolved_remote' : 'dismissed';
        const update = { status, resolved_by: user?.id || null, resolved_at: new Date().toISOString(), resolution_note: `قرار المالك: ${choice}` };
        const { error } = await supabaseClient.from('sync_conflicts').update(update).eq('id', id).eq('office_id', currentOfficeId); if (error) throw error;
        await db.syncConflicts.update(id, update); await refreshOwnerReviewCenter();
    } catch (error) { Swal.fire('تعذر حل التعارض', error.message || 'فشل حفظ القرار', 'error'); }
};


// ========== 21. لوحة تحكم المالك ==========
window.loadDashboardSummary = async function() {
    if (!currentOfficeId) return;
    const today = new Date(); const todayKey = today.toISOString().slice(0, 10); const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
    const activeCases = await db.cases.filter(c => c.office_id === currentOfficeId && !c.archived).toArray();
    const legalFiles = await db.legalFiles.where('office_id').equals(currentOfficeId).toArray();
    const activeLegalFiles = legalFiles.filter(f => normalizeLegalFileStatus(f.status) !== 'archived');
    const filesNeedingAction = activeLegalFiles.filter(f => ['submitting', 'needs_action', 'on_hold'].includes(normalizeLegalFileStatus(f.status)));
    const sessions = await db.sessions.filter(s => s.office_id === currentOfficeId).toArray();
    const todaySessions = sessions.filter(s => String(s.session_date || '').slice(0, 10) === todayKey);
    const weekSessions = sessions.filter(s => { const d = new Date(s.session_date); return d >= new Date(todayKey) && d <= weekEnd; });
    const postponed = sessions.filter(s => /مؤجل|مؤجلة|postpon/i.test(String(s.case_status || '')));
    const upcomingCaseIds = new Set(sessions.filter(s => new Date(s.session_date) >= today && !/انتهت|تم الحكم|محكوم|مشطوب/i.test(String(s.case_status || ''))).map(s => String(s.case_id)));
    const withoutNext = activeCases.filter(c => !upcomingCaseIds.has(String(c.id)));
    const tasks = await db.tasks.toArray(); const lateTasks = tasks.filter(t => !t.completed && t.date && t.date < todayKey && (!t.office_id || t.office_id === currentOfficeId));
    const fees = await db.fees.toArray(); const remaining = fees.reduce((sum, f) => sum + Math.max(0, Number(f.remaining ?? Number(f.total || 0) - Number(f.paid || 0))), 0);
    const pending = await db.pendingOperations.count();
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
    set('dashActiveCases', activeCases.length); set('dashLegalFiles', activeLegalFiles.length); set('dashFilesNeedingAction', filesNeedingAction.length); set('dashTodaySessions', todaySessions.length); set('dashWeekSessions', weekSessions.length); set('dashPostponed', postponed.length); set('dashLateTasks', lateTasks.length); set('dashNoNextSession', withoutNext.length); set('dashRemainingFees', `${remaining.toFixed(2)} ج.م`); set('dashPendingOps', pending);
    await updateSyncStatusUI();
    // C4: تحديث شارة الإشعارات في لوحة التحكم.
    if (typeof renderNotificationsCenter === 'function') await renderNotificationsCenter();
    const latestNotes = await db.notes.filter(n => n.office_id === currentOfficeId).toArray(); latestNotes.sort((a,b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    const activity = document.getElementById('dashboardRecentActivity'); if (activity) activity.innerText = latestNotes.length ? `آخر ملاحظة فريق: ${latestNotes[0].content || ''}` : 'لا توجد تعديلات أو ملاحظات فريق حديثة.';
};
window.addEventListener('online', () => loadDashboardSummary()); window.addEventListener('offline', () => loadDashboardSummary());
window.refreshOwnerPortal = async function() {
    if (!currentOfficeId) return;
    try {
        const tasks = await db.tasks.toArray();
        const openTasks = tasks.filter(t => !t.completed && (!t.office_id || t.office_id === currentOfficeId)).sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')));
        const pendingLocal = await db.pendingOperations.count();
        const membersHost = document.getElementById('portalMembersList');
        const tasksHost = document.getElementById('portalTasksList');
        const noticesHost = document.getElementById('portalNotificationsList');
        const approvalsHost = document.getElementById('portalApprovalList');
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
        set('portalOpenTasks', openTasks.length); set('portalNotifications', pendingLocal);
        if (tasksHost) tasksHost.innerHTML = openTasks.slice(0, 20).map(t => `<div class="portal-list-item"><strong>${escapeHtml(t.description || 'مهمة بدون وصف')}</strong><div class="small text-muted">${escapeHtml(t.date || 'بدون موعد')}</div></div>`).join('') || '<div class="text-muted py-2">لا توجد مهام مفتوحة.</div>';
        const notes = await db.notes.filter(n => n.office_id === currentOfficeId).toArray(); notes.sort((a,b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
        if (noticesHost) noticesHost.innerHTML = notes.slice(0, 12).map(n => `<div class="portal-list-item"><strong>ملاحظة فريق</strong><div>${escapeHtml(n.content || '')}</div><div class="small text-muted">${new Date(n.updated_at || n.created_at || Date.now()).toLocaleString('ar-EG')}</div></div>`).join('') || '<div class="text-muted py-2">لا توجد إشعارات محلية.</div>';
        if (membersHost && supabaseClient) { const { data } = await supabaseClient.from('office_members').select('user_id,display_name,role,active').eq('office_id', currentOfficeId).limit(100); membersHost.innerHTML = (data || []).map(m => `<div class="portal-list-item d-flex justify-content-between"><span><strong>${escapeHtml(m.display_name || 'عضو بدون اسم')}</strong><div class="small text-muted">${escapeHtml(m.role || 'عضو')}</div></span><span class="badge ${m.active === false ? 'bg-secondary' : 'bg-success'}">${m.active === false ? 'معزول' : 'نشط'}</span></div>`).join('') || '<div class="text-muted py-2">لا يوجد أعضاء مسجلون.</div>'; }
        try { const review = await loadOwnerReviewData(); set('portalApprovalCount', review.requests.length); set('portalConflictCount', review.conflicts.length); if (approvalsHost) approvalsHost.innerHTML = review.requests.slice(0, 8).map(r => `<div class="portal-list-item"><strong>${escapeHtml(reviewEntityLabel(r.entity_type))}</strong><div class="small text-muted">${escapeHtml(r.action)} · ${new Date(r.created_at).toLocaleString('ar-EG')}</div></div>`).join('') || '<div class="text-muted py-2">لا توجد طلبات معلقة.</div>'; } catch { set('portalApprovalCount', '—'); set('portalConflictCount', '—'); if (approvalsHost) approvalsHost.innerHTML = '<div class="text-muted py-2">افتح مركز الاعتماد لتسجيل الدخول وتحديث الطلبات.</div>'; }
        const dashboardActivity = document.getElementById('dashboardRecentActivity'); if (dashboardActivity) dashboardActivity.innerHTML = notes.slice(0, 8).map(n => `<div class="portal-list-item"><strong>ملاحظة فريق</strong> — ${escapeHtml(n.content || '')}</div>`).join('') || '<div class="text-muted py-2">لا توجد تعديلات حديثة.</div>';
    } catch (error) { console.warn('تعذر تحديث بوابة المالك:', error); }
};



// إثراء شاشة تفاصيل القضية بعد الحفاظ على دوال العرض القديمة.
const legacyOpenCaseDetails = window.openCaseDetails;
window.openCaseDetails = async function(id) {
    await legacyOpenCaseDetails(id);
    const c = await db.cases.get(id);
    const parties = await db.caseParties.where('case_id').equals(id).toArray();
    const caseHost = document.getElementById('caseDetailContent');
    if (caseHost && parties.length) {
        const clients = parties.filter(p => p.party_type === 'client'); const opponents = parties.filter(p => p.party_type === 'opponent');
        const partyHtml = (title, rows) => rows.length ? `<div class="party-card"><h6 class="gold-text">${title}</h6>${rows.map(p => `<div class="border-bottom py-2"><strong>${escapeHtml(p.name)}</strong> · ${escapeHtml(p.role || '')} · ${escapeHtml(p.phone || '')}<div class="small">التوكيل: ${escapeHtml(p.power_of_attorney_number || '-')} / ${escapeHtml(p.power_of_attorney_year || '-')} · مكتب التوثيق: ${escapeHtml(p.notary_office || '-')}</div></div>`).join('')}</div>` : '';
        caseHost.innerHTML += `<div class="record-row"><strong>مرحلة التقاضي:</strong> ${escapeHtml(c?.proceeding_type || '-')} · <strong>الأهمية:</strong> ${escapeHtml(c?.importance || 'normal')} · <strong>المدينة:</strong> ${escapeHtml(c?.city || '-')}<br><strong>التنبيهات:</strong> ${escapeHtml(c?.alert_notes || '-')}</div>` + partyHtml('العملاء', clients) + partyHtml('الخصوم', opponents);
    }
    const logs = await db.sessionChangeLog.where('office_id').equals(currentOfficeId).toArray(); const caseSessions = await db.sessions.where('case_id').equals(id).toArray(); const sessionIds = new Set(caseSessions.map(s => String(s.id))); const relevant = logs.filter(l => sessionIds.has(String(l.session_id))).sort((a,b) => new Date(b.changed_at) - new Date(a.changed_at));
    if (relevant.length) document.getElementById('caseDetailSessions').insertAdjacentHTML('beforeend', `<hr><h6 class="gold-text">سجل تغييرات الجلسات</h6>${relevant.map(l => `<div class="small border-bottom py-1">${new Date(l.changed_at).toLocaleString('ar-EG')} — ${escapeHtml(l.action)}</div>`).join('')}`);
};


window.addCaseStage = async function(parentId) {
    if (!ownerOnly('إضافة مرحلة تقاضٍ')) return;
    const parent = await db.cases.get(parentId); if (!parent) return;
    const result = await Swal.fire({ title: 'إضافة مرحلة تقاضٍ مرتبطة', html: '<select id="stageInput" class="swal2-select"><option value="appeal">استئناف</option><option value="retrial">التماس إعادة نظر</option><option value="cassation">طعن</option><option value="enforcement">تنفيذ</option></select><input id="stageNumberInput" class="swal2-input" placeholder="رقم القضية في المرحلة الجديدة"><input id="stageYearInput" class="swal2-input" placeholder="سنة القضية">', focusConfirm: false, showCancelButton: true, confirmButtonText: 'إنشاء المرحلة', cancelButtonText: 'إلغاء', preConfirm: () => ({ type: document.getElementById('stageInput').value, number: document.getElementById('stageNumberInput').value.trim(), year: document.getElementById('stageYearInput').value.trim() }) });
    if (!result.isConfirmed) return;
    const code = await generateCaseCode(); const now = new Date().toISOString();
    const stage = { ...parent, id: 'C_' + Date.now(), case_code: code, case_number: result.value.number || '', case_year: result.value.year || '', proceeding_type: result.value.type, parent_case_id: parent.id, appeal_of_case_id: parent.id, root_case_id: parent.root_case_id || parent.id, created_at: now, archived: 0 };
    delete stage.updated_at; await db.cases.add(stage); await db.pendingOperations.add({ operation: 'insert_case', data: stage, timestamp: Date.now() });
    Swal.fire({ icon: 'success', title: 'تم إنشاء المرحلة', text: `كود المرحلة: ${code}`, timer: 1800, showConfirmButton: false }); await loadCasesList();
};

const previousCaseDetailWrapper = window.openCaseDetails;
window.openCaseDetails = async function(id) {
    await previousCaseDetailWrapper(id);
    if (currentUserRole === 'manager' && document.getElementById('caseActionsPanel')) document.getElementById('caseActionsPanel').insertAdjacentHTML('beforeend', '<button class="btn btn-outline-primary" onclick="addCaseStage(activeCaseId)"><i class="bi bi-diagram-3"></i> إضافة مرحلة تقاضٍ</button>');
};

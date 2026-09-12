// ========== renderer.js - النسخة النهائية المتكاملة (شريط جانبي مبسط + ترخيص 90 يوم + مودال إعدادات) ==========
window.onerror = function(message, source, lineno, colno, error) {
    console.error('خطأ شامل:', message, error);
    Swal.fire({ icon: 'error', title: 'خطأ غير متوقع', text: message, background: '#0f172a', color: '#fff' });
    return false;
};
window.onunhandledrejection = function(event) {
    console.error('وعد غير معالج:', event.reason);
    Swal.fire({ icon: 'error', title: 'خطأ غير معالج', text: event.reason?.message || 'خطأ غير معروف', background: '#0f172a', color: '#fff' });
};

// ========== 1. الإعدادات وقواعد البيانات ==========
let ipcRenderer = null;
try { if (window.electronAPI) ipcRenderer = window.electronAPI; } catch(e) { console.log('ليس في بيئة إلكترون'); }

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

let supabaseClient = null;
let currentOfficeId = null;
let currentOfficeName = null;
let activeCaseId = null, activeSessionId = null, currentCaseForPrint = null, currentDate = new Date();
let currentSelectedDateStr = null, rescheduleSessionId = null;

const OWNER_EMAIL = 'mahmoud.abdelhamyd@gmail.com';
const OWNER_LICENSE_KEY = 'OWNER-PERMANENT-QAYD';
const OWNER_LICENSE_EXPIRY = '9999-12-31';

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function isOwnerEmail(value) { return normalizeEmail(value) === OWNER_EMAIL; }

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

    const officeId = generateUUID();
    await db.offices.clear();
    await db.offices.add({ office_id: officeId, office_name: officeName, pin, email: email || null, license_key: licenseKey, license_expiry: licenseExpiry });
    currentOfficeId = officeId;
    currentOfficeName = officeName;
    updateSidebarOfficeName(officeName);
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
            await supabaseClient.from('offices').insert([{ office_id: officeId, office_name: officeName, email: email || null, pin }]);
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
        updateSidebarOfficeName(currentOfficeName);

        if (!DEV_MODE) {
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
        updatePendingBadge();
        checkUpcomingNotifications();
        setInterval(checkUpcomingNotifications, 3600000);
        await loadAndDisplayLicenseStatus();
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
    allCasesList = await db.cases.filter(c => !c.archived && c.office_id === currentOfficeId).toArray();
    const professionalFiles = await db.officeFiles.where('office_id').equals(currentOfficeId).filter(f => !f.archived).toArray();
    allOfficeRecords = [...allCasesList.map(c => ({ ...c, record_type: 'judicial' })), ...professionalFiles.map(f => ({ ...f, record_type: f.file_type }))];
    filterCasesList();
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
          <div class="small mt-1">${escapeHtml(record.title || record.case_subject || '')}</div>
          <div class="small">${escapeHtml(judicial ? (record.court_name || 'محكمة غير محددة') : 'ملف بلا جلسات محكمة')}${judicial && record.case_type ? ` | ${escapeHtml(record.case_type)}` : ''}</div>
          <div class="small text-warning mt-1">الكود: ${escapeHtml(record.case_code || record.file_code || 'غير محدد')} · المرجع: ${escapeHtml(reference)}</div>
        </div>`;
    }).join('') : '<div class="text-center text-white-50 py-4">لا توجد ملفات مطابقة للبحث أو الفلاتر.</div>';
}
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
window.editProfessionalFile = async function(id) { const file = await db.officeFiles.get(id); if (!file) return; const f = file.metadata?.followup || {}; document.getElementById('editingProfessionalFileId').value = id; document.getElementById('professionalFileType').value = file.file_type; document.getElementById('professionalFileTitle').value = file.title || ''; document.getElementById('professionalClientName').value = file.client_name || ''; document.getElementById('professionalClientRole').value = file.client_role || ''; document.getElementById('professionalClientPhone').value = file.client_phone || ''; document.getElementById('professionalClientNationalId').value = file.client_national_id || ''; document.getElementById('professionalClientEmail').value = file.client_email || ''; document.getElementById('professionalClientAddress').value = file.client_address || ''; document.getElementById('professionalOpponentName').value = file.opponent_name || ''; document.getElementById('professionalOpponentRole').value = file.opponent_role || ''; document.getElementById('professionalOpponentPhone').value = file.opponent_phone || ''; document.getElementById('professionalOpponentNationalId').value = file.opponent_national_id || ''; document.getElementById('professionalOpponentEmail').value = file.opponent_email || ''; document.getElementById('professionalOpponentAddress').value = file.opponent_address || ''; document.getElementById('professionalFileDescription').value = file.description || ''; document.getElementById('professionalLastActionDate').value = f.last_action_date || ''; document.getElementById('professionalLastAction').value = f.last_action || ''; document.getElementById('professionalNextActionDate').value = f.next_action_date || ''; document.getElementById('professionalNextAction').value = f.next_action || ''; document.getElementById('professionalFileSaveButton').textContent = 'حفظ التعديلات'; showModal('professionalFileModal'); };
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
    return `<div class="detail-action-grid"><button class="btn btn-outline-info" onclick="openPartyDetails('client')"><i class="bi bi-person-vcard"></i> بيانات العميل</button><button class="btn btn-outline-danger" onclick="openPartyDetails('opponent')"><i class="bi bi-person-badge"></i> بيانات الخصم</button><button class="btn btn-outline-info" onclick="${isJudicial ? 'addCaseDocument()' : `addProfessionalDocument('${q}')`}"><i class="bi bi-file-earmark-plus"></i> مستند +</button><button class="btn btn-outline-warning" onclick="${isJudicial ? 'addCaseDocument()' : `addProfessionalDocument('${q}')`}"><i class="bi bi-journal-plus"></i> مذكرة أو صحيفة +</button><button class="btn btn-outline-primary" onclick="${isJudicial ? "showCasePanelSection('sessions')" : `openProfessionalActionModal('${q}')`}"><i class="bi bi-calendar-check"></i> ${isJudicial ? 'الجلسات' : 'الإجراءات'}</button><button class="btn btn-success" onclick="openFeesModal(activeCaseId)"><i class="bi bi-cash-coin"></i> الأتعاب</button><button class="btn btn-outline-warning" onclick="${isJudicial ? 'openEditCaseModalFromPanel()' : `editProfessionalFile('${q}')`}"><i class="bi bi-pencil"></i> تعديل</button><button class="btn btn-outline-danger" onclick="${isJudicial ? 'showCaseOptions()' : `deleteProfessionalFile('${q}')`}"><i class="bi bi-trash"></i> حذف</button><button class="btn btn-outline-secondary" onclick="${isJudicial ? 'archiveCase(activeCaseId)' : `archiveProfessionalFile('${q}')`}"><i class="bi bi-archive"></i> أرشفة</button></div>`;
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

window.openAddCaseModal = () => showModal('addCaseModal');
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
                        // يجب توليد الكود قبل إنشاء الكائن وقبل أي كتابة في IndexedDB.
                        case_code: await generateCaseCode(),
                            archived: 0
    };

        // التحقق النهائي قبل الحفظ المحلي؛ لا نسمح بإنشاء قضية ناقصة الكود.
    caseData.case_code = assertValidCaseCode(caseData.case_code);
    await db.cases.add(caseData);
    if (supabaseClient && currentOfficeId) {
        try {
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
            document.getElementById('s_client').value = c.client_name;
            document.getElementById('s_client_role').value = c.client_role;
            document.getElementById('s_opponent').value = c.opponent_name || 'لا يوجد';
        }
    } catch (e) { }
};
window.saveSession = async function() {
    if (!activeCaseId || !document.getElementById('s_date').value) { Swal.fire('تنبيه', 'اختر قضية وأدخل التاريخ', 'warning'); return; }
    const sessionData = { id: 'S_' + Date.now(), office_id: currentOfficeId, case_id: activeCaseId, session_date: document.getElementById('s_date').value, case_status: document.getElementById('s_case_status').value, decision: document.getElementById('s_decision').value };
    await db.sessions.add(sessionData);
    await db.pendingOperations.add({ operation: 'insert_session', data: sessionData, timestamp: Date.now() });
    Swal.fire({ icon: 'success', title: 'تم الحفظ محلياً', background: '#0f172a', showConfirmButton: false, timer: 1500 });
    document.getElementById('s_decision').value = '';
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
            if (c) html += `<div class="session-card" onclick="openCaseDetails('${c.id}')"><div class="d-flex justify-content-between"><span class="gold-text">${new Date(s.session_date).toLocaleString('ar-EG', { dateStyle: 'full', timeStyle: 'short' })}</span><span class="case-status status-new">${s.case_status}</span></div><div class="mt-2"><strong>${c.client_name}</strong> - ${c.case_number}/${c.case_year}</div><div class="mt-1 text-white">${s.decision || ''}</div></div>`;
        }
        document.getElementById('upcomingSessionsList').innerHTML = html || '<div class="text-muted">لا توجد جلسات في هذه الفترة</div>';
    } catch (e) { }
};
window.openEditSession = async function(id) {
    activeSessionId = id;
    const s = await db.sessions.get(id);
    if (!s) return;
    document.getElementById('edit_s_date').value = s.session_date.slice(0, 16);
    document.getElementById('edit_s_status').value = s.case_status;
    document.getElementById('edit_s_decision').value = s.decision || '';
    hideModal('caseModal'); showModal('editSessionModal');
};
window.cancelEditSession = function() { hideModal('editSessionModal'); openCaseDetails(activeCaseId); };
window.saveEditedSession = async function() {
    const updated = { session_date: document.getElementById('edit_s_date').value, case_status: document.getElementById('edit_s_status').value, decision: document.getElementById('edit_s_decision').value };
    await db.sessions.update(activeSessionId, updated);
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
window.toggleTask = async function(id, status) { await db.tasks.update(id, { completed: status }); showDayDetails(currentSelectedDateStr); renderCalendar(); };
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
    try { if (type === 'task') await db.tasks.add({ description: t, date: d, completed: false }); else await db.events.add({ title: t, date: d, type: 'other' }); document.getElementById('newEventTitle').value = ''; renderCalendar(); } catch (e) { }
};
window.addQuickItemToDay = async function() {
    const t = document.getElementById('quickItemTitle').value, type = document.getElementById('quickItemType').value;
    if (!t || !currentSelectedDateStr) return;
    try { if (type === 'task') await db.tasks.add({ description: t, date: currentSelectedDateStr, completed: false }); else await db.events.add({ title: t, date: currentSelectedDateStr, type: 'other' }); document.getElementById('quickItemTitle').value = ''; showDayDetails(currentSelectedDateStr); renderCalendar(); } catch (e) { }
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
window.printCasePDF = async function() { if (!currentCaseForPrint) return; const rows=(currentCaseForPrint.sessions||[]).map(x=>`<li>${new Date(x.session_date).toLocaleString('ar-EG')} — ${escapeHtml(x.case_status||'')} — ${escapeHtml(x.decision||'')}</li>`).join('')||'<li>لا توجد جلسات مسجلة</li>'; const html=`<html dir="rtl"><meta charset="utf-8"><style>body{font-family:Arial,'Noto Sans Arabic',sans-serif;direction:rtl;padding:30px;color:#172b45}h1{text-align:center;color:#12335b}li{margin:10px 0}</style><h1>تقرير القضية</h1><p>العميل: ${escapeHtml(currentCaseForPrint.client_name)}</p><p>رقم القضية: ${escapeHtml(currentCaseForPrint.case_number)}/${escapeHtml(currentCaseForPrint.case_year)}</p><p>المحكمة: ${escapeHtml(currentCaseForPrint.court_name)}</p><p>كود القضية: ${escapeHtml(currentCaseForPrint.case_code||'')}</p><h2>سجل الجلسات</h2><ul>${rows}</ul></html>`; if (ipcRenderer?.printArabicPdf) await ipcRenderer.printArabicPdf(html, `قضية_${currentCaseForPrint.case_number||'تقرير'}.pdf`); };

// ========== 14. المزامنة مع Supabase ==========
// تسجيل الدخول إلى Supabase من سطح المكتب باستخدام نفس البريد وPIN المحليين.
// لا نرسل PIN إلى أي مكان خارج طلب Auth؛ بعد نجاح الدخول تستخدم RPC سياسات المكتب.
async function ensureDesktopSupabaseSession() {
    if (!supabaseClient) await initSupabase();
    if (!supabaseClient || !currentOfficeId) return false;
    const office = await db.offices.where('office_id').equals(currentOfficeId).first();
    if (!office?.email || !office?.pin) return false;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user?.email?.toLowerCase() === String(office.email).toLowerCase()) return true;
    const { error } = await supabaseClient.auth.signInWithPassword({ email: office.email, password: office.pin });
    if (error) {
        console.warn('تعذر تسجيل دخول مزامنة سطح المكتب:', error.message);
        return false;
    }
    return true;
}

function newSyncOperationId() {
    return generateUUID();
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
    const cases = await db.cases.where('office_id').equals(currentOfficeId).toArray();
    for (const record of cases) await pushDesktopRecord('cases', record.id, 'upsert', record);

    const sessions = await db.sessions.where('office_id').equals(currentOfficeId).toArray();
    for (const record of sessions) await pushDesktopRecord('sessions', record.id, 'insert', record);

    const tasks = await db.tasks.toArray();
    for (const record of tasks) await pushDesktopRecord('tasks', record.id, 'insert', { ...record, id: undefined });

    const expenses = await db.expenses.where('office_id').equals(currentOfficeId).toArray();
    for (const record of expenses) {
        const payload = { ...record, expense_date: record.expense_date || record.date };
        await pushDesktopRecord('expenses', record.id, 'insert', payload);
    }

    const fees = await db.fees.toArray();
    for (const record of fees) await pushDesktopRecord('fees', record.case_id, 'upsert', record);

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
        loadCasesList();
        loadUpcomingSessions('week');
        renderCalendar();

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
        Swal.fire({ icon: 'success', title: 'تم', text: 'تمت المزامنة', background: '#0f172a', color: '#fff', showConfirmButton: false, timer: 2000 });
    } catch (err) { console.error(err); Swal.close(); Swal.fire('خطأ', 'فشلت المزامنة', 'error'); }
};

async function uploadToSupabase() {
    const pendingOps = await db.pendingOperations.toArray();
    for (let op of pendingOps) {
        try {
            if (op.operation === 'insert_case') {
                const { id, ...caseData } = op.data;
                const { error } = await supabaseClient.from('cases').insert([caseData]).select('case_code');
                if (error) throw error;
            } else if (op.operation === 'update_case') {
                const { id, case_code, ...updateData } = op.data;
                const { error } = await supabaseClient.from('cases').update(updateData).eq('case_code', case_code);
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
        }
    }
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
window.updateTotalFee = async function() { const newTotal = parseFloat(document.getElementById('feeTotalInput').value) || 0; const fee = await db.fees.get(activeCaseId); if (fee) { fee.total = newTotal; fee.remaining = newTotal - fee.paid; await db.fees.put(fee); document.getElementById('feeRemVal').innerText = fee.remaining.toFixed(2); } };
window.updateFeeNotes = async function() { const fee = await db.fees.get(activeCaseId); if (fee) { fee.notes = document.getElementById('feeGeneralNotes').value; await db.fees.put(fee); } };
window.addPayment = async function() { if (!activeCaseId) return; const amount = parseFloat(document.getElementById('payAmount').value); const date = document.getElementById('payDate').value; const note = document.getElementById('payNote').value; if (!amount || amount <= 0 || !date) return Swal.fire({ icon: 'warning', title: 'تنبيه', text: 'أدخل مبلغًا وتاريخًا صحيحين', background: '#0f172a' }); await db.payments.add({ case_id: activeCaseId, amount, date, note }); await openFeesModal(activeCaseId); };
window.addExpense = async function() { if (!activeCaseId) return; const amount = parseFloat(document.getElementById('expenseAmount').value); const date = document.getElementById('expenseDate').value; const category = document.getElementById('expenseCategory').value.trim(); if (!amount || amount <= 0 || !date) return Swal.fire({ icon: 'warning', title: 'تنبيه', text: 'أدخل قيمة المصروف وتاريخه', background: '#0f172a' }); await db.expenses.add({ office_id: currentOfficeId, owner_id: activeCaseId, case_id: activeCaseId, amount, date, category }); await openFeesModal(activeCaseId); };
window.deletePayment = async function(paymentId) { if (confirm('هل أنت متأكد من حذف الدفعة؟')) { await db.payments.delete(paymentId); await openFeesModal(activeCaseId); } };
window.deleteExpense = async function(expenseId) { if (confirm('هل أنت متأكد من حذف المصروف؟')) { await db.expenses.delete(expenseId); await openFeesModal(activeCaseId); } };

window.printFeesPDF = async function() { if (!activeCaseId) return; const c=await db.cases.get(activeCaseId)||await db.officeFiles.get(activeCaseId); const fee=await db.fees.get(activeCaseId)||{total:0,paid:0,remaining:0}; const payments=await db.payments.where('case_id').equals(activeCaseId).toArray(); const rows=payments.map(x=>`<li>${escapeHtml(x.date)} — ${escapeHtml(x.amount)} ج.م — ${escapeHtml(x.note||'')}</li>`).join('')||'<li>لا توجد دفعات</li>'; const html=`<html dir="rtl"><meta charset="utf-8"><style>body{font-family:Arial,'Noto Sans Arabic',sans-serif;direction:rtl;padding:30px;color:#172b45}h1{text-align:center;color:#12335b}li{margin:10px 0}</style><h1>تقرير الأتعاب</h1><p>العميل: ${escapeHtml(c.client_name)}</p><p>إجمالي الأتعاب: ${escapeHtml(fee.total)} ج.م</p><p>المدفوع: ${escapeHtml(fee.paid)} ج.م</p><p>المتبقي: ${escapeHtml(fee.remaining)} ج.م</p><h2>الدفعات</h2><ul>${rows}</ul></html>`; if (ipcRenderer?.printArabicPdf) await ipcRenderer.printArabicPdf(html, `أتعاب_${c.case_code||c.file_code||'تقرير'}.pdf`); };

// ========== صفحة الأتعاب والمصروفات والمرفقات ==========
let financeRows = [];
function money(value) { return (Number(value) || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
async function getFinanceRows() {
    const cases = await db.cases.filter(c => !c.archived && c.office_id === currentOfficeId).toArray();
    const files = await db.officeFiles.filter(f => !f.archived && f.office_id === currentOfficeId).toArray();
    const rows = [];
    for (const record of [...cases.map(c => ({ ...c, record_kind: 'judicial', record_id: c.id, title: `قضية ${c.case_number || ''}/${c.case_year || ''}`, service: `${c.court_name || '-'}${c.circuit ? ` / ${c.circuit}` : ''}`, code: c.case_code || '' })), ...files.map(f => ({ ...f, record_kind: 'professional', record_id: f.id, title: f.title || professionalTypeLabel(f.file_type), service: professionalTypeLabel(f.file_type), code: f.file_code || '' }))]) {
        const fee = await db.fees.get(record.record_id) || { total: 0 };
        const payments = await db.payments.where('case_id').equals(record.record_id).toArray();
        const expenses = await db.expenses.where('case_id').equals(record.record_id).toArray();
        const collected = payments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        const spent = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        rows.push({ ...record, total: Number(fee.total) || 0, collected, spent, profit: collected - spent });
    }
    return rows;
}
function renderFinanceRows(rows) {
    const body = document.getElementById('financeTableBody');
    if (!body) return;
    body.innerHTML = rows.map(r => `<tr><td><strong>${escapeHtml(r.client_name || '-')}</strong><div class="finance-code">${escapeHtml(r.client_phone || '')}</div></td><td>${escapeHtml(r.title)}<div class="finance-code">${escapeHtml(r.code)}</div></td><td>${escapeHtml(r.service)}</td><td>${money(r.total)}</td><td class="text-success fw-bold">${money(r.collected)}</td><td class="text-danger fw-bold">${money(r.spent)}</td><td class="fw-bold ${r.profit >= 0 ? 'text-success' : 'text-danger'}">${money(r.profit)}</td><td><button class="btn btn-sm btn-outline-primary" onclick="openFeesModal('${r.record_id}')"><i class="bi bi-pencil-square"></i> تعديل الحساب</button></td></tr>`).join('') || '<tr><td colspan="8" class="text-center py-4">لا توجد سجلات مالية</td></tr>';
}
window.loadFinancePage = async function() { showTab('financeTab'); financeRows = await getFinanceRows(); const total = financeRows.reduce((s, r) => s + r.total, 0), collected = financeRows.reduce((s, r) => s + r.collected, 0), spent = financeRows.reduce((s, r) => s + r.spent, 0); document.getElementById('financePageFees').innerText = money(total); document.getElementById('financePageCollected').innerText = money(collected); document.getElementById('financePageExpenses').innerText = money(spent); document.getElementById('financePageProfit').innerText = money(collected - spent); renderFinanceRows(financeRows); };
window.filterFinancePage = function() { const q = (document.getElementById('financeSearchInput')?.value || '').trim().toLowerCase(); const type = document.getElementById('financeTypeFilter')?.value || ''; renderFinanceRows(financeRows.filter(r => (!type || r.record_kind === type) && (!q || [r.client_name, r.case_number, r.case_code, r.file_code, r.title, r.court_name, r.service].some(v => String(v || '').toLowerCase().includes(q))))); };
window.selectReceiptForActiveRecord = async function() { if (!activeCaseId || !ipcRenderer?.selectFile || !ipcRenderer?.copyReceipt) return Swal.fire('تنبيه', 'رفع الإيصالات متاح داخل نسخة سطح المكتب فقط', 'info'); const source = await ipcRenderer.selectFile(); if (!source) return; const result = await ipcRenderer.copyReceipt(source, activeCaseId); if (!result?.success) return Swal.fire('خطأ', result?.error || 'تعذر حفظ الإيصال', 'error'); await db.receipts.add({ record_id: activeCaseId, date: new Date().toISOString(), name: result.name, path: result.path }); await renderReceipts(activeCaseId); };
window.renderReceipts = async function(recordId) { const list = document.getElementById('receiptsHistoryList'); if (!list) return; const receipts = await db.receipts.where('record_id').equals(recordId).toArray(); list.innerHTML = receipts.map(r => `<div class="receipt-row"><span><i class="bi bi-receipt"></i> ${escapeHtml(r.name)} <small>${new Date(r.date).toLocaleDateString('ar-EG')}</small></span><span><button class="btn btn-sm btn-outline-primary" onclick="openReceipt('${r.id}')">فتح</button><button class="btn btn-sm btn-outline-danger" onclick="deleteReceipt('${r.id}')">حذف</button></span></div>`).join('') || '<span class="text-muted">لا توجد إيصالات محفوظة</span>'; };
window.openReceipt = async function(id) { const receipt = await db.receipts.get(Number(id)); if (receipt && ipcRenderer?.openLocalFile) await ipcRenderer.openLocalFile(receipt.path); };
window.deleteReceipt = async function(id) { const receipt = await db.receipts.get(Number(id)); if (!receipt || !confirm('حذف هذا الإيصال؟')) return; await db.receipts.delete(Number(id)); await renderReceipts(receipt.record_id); };

// ========== 16. حذف القضية وأرشفتها ==========
window.showCaseOptions = async function() { if (!activeCaseId) return; const caseData = await db.cases.get(activeCaseId); const result = await Swal.fire({ title: 'خيارات القضية', html: `ماذا تريد أن تفعل بالقضية: <strong>${caseData.client_name}</strong>؟`, icon: 'question', showCancelButton: true, showDenyButton: true, confirmButtonColor: '#dc3545', denyButtonColor: '#ffc107', cancelButtonColor: '#6c757d', confirmButtonText: '🗑️ حذف نهائي', denyButtonText: '📦 نقل إلى الأرشيف', cancelButtonText: 'إلغاء', background: '#0f172a', color: '#fff' }); if (result.isConfirmed) await deleteCasePermanently(activeCaseId); else if (result.isDenied) await archiveCase(activeCaseId); };
window.archiveCase = async function(id) { try { const caseData = await db.cases.get(id); if (ipcRenderer && ipcRenderer.archiveCaseFolder) { const folderName = `${caseData.case_code} - ${caseData.client_name}`.replace(/[<>:"\/\\|?*]/g, '_'); await ipcRenderer.archiveCaseFolder(folderName); } await db.cases.update(id, { archived: 1 }); await db.pendingOperations.add({ operation: 'update_case', data: { id: id, case_code: caseData.case_code, archived: 1 }, timestamp: Date.now() }); hideModal('caseModal'); Swal.fire({ icon: 'success', title: 'تم الأرشفة', text: 'تم نقل القضية إلى الأرشيف', background: '#0f172a', color: '#fff', timer: 1500, showConfirmButton: false }); loadRecentCases(); updatePendingBadge(); } catch (error) { console.error(error); Swal.fire({ icon: 'error', title: 'خطأ', text: 'فشلت عملية الأرشفة', background: '#0f172a', color: '#fff' }); } };
window.deleteCasePermanently = async function(id) { try { const caseData = await db.cases.get(id); if (ipcRenderer && ipcRenderer.deleteCaseFolder) { const folderName = `${caseData.case_code} - ${caseData.client_name}`.replace(/[<>:"\/\\|?*]/g, '_'); await ipcRenderer.deleteCaseFolder(folderName); } await db.cases.delete(id); await db.sessions.where('case_id').equals(id).delete(); await db.fees.delete(id); await db.payments.where('case_id').equals(id).delete(); await db.expenses.where('case_id').equals(id).delete(); await db.pendingOperations.add({ operation: 'delete_case', data: { id: id }, timestamp: Date.now() }); hideModal('caseModal'); Swal.fire({ icon: 'success', title: 'تم الحذف', text: 'تم حذف القضية نهائياً', background: '#0f172a', color: '#fff', showConfirmButton: false, timer: 2000 }); loadRecentCases(); updatePendingBadge(); } catch (error) { console.error(error); Swal.fire({ icon: 'error', title: 'خطأ', text: 'حدث خطأ أثناء الحذف', background: '#0f172a', color: '#fff' }); } };

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
window.openCaseDetails = async function(id) {
    if (!id) return; try { const c=await db.cases.get(id); if (!c) return; activeCaseId=id;
    document.getElementById('caseDetailContent').innerHTML = `<div class="record-detail"><div class="record-code">كود الملف: ${escapeHtml(c.case_code||'-')}</div><div class="record-row"><strong>رقم القضية:</strong> ${escapeHtml(c.case_number||'-')} / ${escapeHtml(c.case_year||'-')}</div><div class="record-row"><strong>المحكمة والدائرة:</strong> ${escapeHtml(c.court_name||'-')} — ${escapeHtml(c.circuit||'-')}</div><div class="record-row"><strong>نوع القضية:</strong> ${escapeHtml(c.case_type||'-')}</div>${partyCardHtml('بيانات العميل', {name:c.client_name, role:c.client_role, nationalId:c.client_national_id, phone:c.client_phone, address:c.client_address, email:c.client_email})}${partyCardHtml('بيانات الخصم', {name:c.opponent_name, role:c.opponent_role, nationalId:c.opponent_national_id, phone:c.opponent_phone, address:c.opponent_address, email:c.opponent_email})}<div class="record-row"><strong>موضوع القضية:</strong><br>${escapeHtml(c.case_subject||'-')}</div></div>`;
    const sessions=await db.sessions.where('case_id').equals(id).toArray(); sessions.sort((a,b)=>new Date(b.session_date)-new Date(a.session_date)); currentCaseForPrint={...c,sessions}; document.getElementById('caseDetailSessions').innerHTML=sessions.length?sessions.map(x=>`<div class="session-item-row"><div><span class="text-info fw-bold fs-5">${new Date(x.session_date).toLocaleString('ar-EG',{dateStyle:'full',timeStyle:'short'})}</span><span class="badge bg-light text-dark mx-3 fs-6">${escapeHtml(x.case_status)}</span><div class="fs-6 mt-2 text-white">${escapeHtml(x.decision||'لا يوجد قرار مسجل')}</div></div><button class="btn btn-sm btn-outline-warning" onclick="event.stopPropagation(); openEditSession('${escapeHtml(x.id)}')"><i class="bi bi-pencil fs-5"></i></button></div>`).join(''):'<p class="text-muted">لا توجد جلسات مسجلة لهذه القضية.</p>';
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
    const values = { edit_c_name: c.client_name, edit_c_phone: c.client_phone, edit_c_national_id: c.client_national_id, edit_c_email: c.client_email, edit_c_address: c.client_address, edit_c_opponent: c.opponent_name, edit_c_opponent_role: c.opponent_role, edit_c_opponent_national_id: c.opponent_national_id, edit_c_opponent_email: c.opponent_email, edit_c_opponent_phone: c.opponent_phone, edit_c_opponent_address: c.opponent_address, edit_c_num: c.case_number, edit_c_year: c.case_year, edit_c_court: c.court_name, edit_c_circuit: c.circuit, edit_case_type: c.case_type, edit_c_subject: c.case_subject };
    Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value || ''; });
    showModal('editCaseModal');
};

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

window.saveEditedCase = async function() { const updated = { client_name: document.getElementById('edit_c_name').value, client_phone: document.getElementById('edit_c_phone').value, client_national_id: document.getElementById('edit_c_national_id')?.value || '', client_email: document.getElementById('edit_c_email')?.value || '', client_address: document.getElementById('edit_c_address')?.value || '', opponent_name: document.getElementById('edit_c_opponent').value, opponent_role: document.getElementById('edit_c_opponent_role')?.value || '', opponent_national_id: document.getElementById('edit_c_opponent_national_id')?.value || '', opponent_email: document.getElementById('edit_c_opponent_email')?.value || '', opponent_phone: document.getElementById('edit_c_opponent_phone')?.value || '', opponent_address: document.getElementById('edit_c_opponent_address')?.value || '', case_number: document.getElementById('edit_c_num').value, case_year: document.getElementById('edit_c_year').value, court_name: document.getElementById('edit_c_court').value, circuit: document.getElementById('edit_c_circuit').value, case_type: document.getElementById('edit_case_type').value, case_subject: document.getElementById('edit_c_subject').value }; const currentCase = await db.cases.get(activeCaseId); if (!currentCase) throw new Error('القضية غير موجودة'); const caseCode = assertValidCaseCode(currentCase.case_code); await db.cases.update(activeCaseId, updated); await db.pendingOperations.add({ operation: 'update_case', data: { id: activeCaseId, case_code: caseCode, ...updated }, timestamp: Date.now() }); hideModal('editCaseModal'); openCaseDetails(activeCaseId); Swal.fire({ icon: 'success', title: 'تم التعديل محلياً', timer: 1000, showConfirmButton: false, background: '#0f172a' }); updatePendingBadge(); };
window.calculateDate = function() { const startDate = document.getElementById('calcStartDate').value; if (!startDate) return Swal.fire('تنبيه', 'الرجاء اختيار تاريخ البداية', 'warning'); const days = parseInt(document.getElementById('calcDays').value) || 0; const date = new Date(startDate); date.setDate(date.getDate() + days); const resultStr = date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }); document.getElementById('calcResult').innerText = resultStr; window.calculatedDate = date; };
window.addCalculatedDateAsEvent = function() { if (!window.calculatedDate) return Swal.fire('تنبيه', 'قم بحساب التاريخ أولاً', 'warning'); const dateStr = window.calculatedDate.toISOString().split('T')[0]; const title = prompt('أدخل وصف الحدث:', 'موعد قانوني'); if (title) { db.events.add({ title, date: dateStr, type: 'legal' }); renderCalendar(); Swal.fire('تم', 'تم إضافة الحدث', 'success'); } };
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
});

// ========== 20. مودال الإعدادات (إضافة هذه الدالة في النهاية) ==========
window.showSettingsModal = function() {
    showModal('settingsModal');
};


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
window.saveProfessionalFile = async function() {
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
        const file = { id: editingId || generateUUID(), office_id: currentOfficeId, file_code: editingId ? (await db.officeFiles.get(editingId)).file_code : fileCode, file_type: fileType, title, client_name: clientName, client_role: document.getElementById('professionalClientRole')?.value.trim() || '', client_phone: clientPhone, client_national_id: document.getElementById('professionalClientNationalId')?.value.trim() || '', client_email: document.getElementById('professionalClientEmail')?.value.trim() || '', client_address: document.getElementById('professionalClientAddress')?.value.trim() || '', opponent_name: document.getElementById('professionalOpponentName')?.value.trim() || '', opponent_role: document.getElementById('professionalOpponentRole')?.value.trim() || '', opponent_phone: document.getElementById('professionalOpponentPhone')?.value.trim() || '', opponent_national_id: document.getElementById('professionalOpponentNationalId')?.value.trim() || '', opponent_email: document.getElementById('professionalOpponentEmail')?.value.trim() || '', opponent_address: document.getElementById('professionalOpponentAddress')?.value.trim() || '', status: 'مفتوح', description: description || null, metadata: editingId ? ((await db.officeFiles.get(editingId)).metadata || {}) : {}, archived: false, created_at: editingId ? (await db.officeFiles.get(editingId)).created_at : new Date().toISOString(), updated_at: new Date().toISOString() };
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

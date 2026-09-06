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
        return `<div class="case-card-item" data-id="${record.id}" onclick="${judicial ? `selectCase('${record.id}')` : `selectProfessionalFile('${record.id}')`}">
          <div class="d-flex justify-content-between gap-2"><strong class="gold-text">${escapeHtml(record.client_name || record.title)}</strong><span class="badge ${judicial ? 'bg-primary' : 'bg-success'}">${label}</span></div>
          <div class="small mt-1">${escapeHtml(record.title || record.case_subject || '')}</div>
          <div class="small">${escapeHtml(judicial ? (record.court_name || 'محكمة غير محددة') : 'ملف بلا جلسات محكمة')}${judicial && record.case_type ? ` | ${escapeHtml(record.case_type)}` : ''}</div>
          <div class="small text-warning mt-1">الكود: ${escapeHtml(record.case_code || record.file_code || 'غير محدد')} · المرجع: ${escapeHtml(reference)}</div>
        </div>`;
    }).join('') : '<div class="text-center text-white-50 py-4">لا توجد ملفات مطابقة للبحث أو الفلاتر.</div>';
}
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
window.selectProfessionalFile = async function(id) {
    const file = await db.officeFiles.get(id); if (!file) return;
    document.getElementById('caseDetailContent').innerHTML = `<div class="mb-2"><span class="text-warning fw-bold">كود الملف:</span> <span class="badge bg-dark text-warning border border-warning px-2 py-1">${escapeHtml(file.file_code)}</span></div><div><strong>العميل:</strong> ${escapeHtml(file.client_name)}</div><div><strong>الخدمة:</strong> ${professionalTypeLabel(file.file_type)}</div><div><strong>اسم الملف:</strong> ${escapeHtml(file.title)}</div><div><strong>الحالة:</strong> ${escapeHtml(file.status)}</div><div><strong>الوصف:</strong> ${escapeHtml(file.description || '-')}</div>`;
    const events = await db.fileEvents.where('file_id').equals(id).toArray();
    document.getElementById('caseDetailSessions').innerHTML = events.length ? events.sort((a,b) => new Date(b.event_date) - new Date(a.event_date)).map(e => `<div class="small border-bottom py-1">${new Date(e.event_date).toLocaleString('ar-EG')} - ${escapeHtml(e.title)} (${escapeHtml(e.status)})</div>`).join('') : 'لا توجد تحديثات';
    document.getElementById('caseActionsPanel').innerHTML = `<span class="badge bg-success">ملف مهني / تحقيقات — لا توجد جلسات محكمة</span><button class="btn btn-sm btn-outline-success" onclick="openFeesModal('${file.id}')"><i class="bi bi-cash-stack"></i> الأتعاب والمصروفات</button>`;
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
        client_email: document.getElementById('client_email').value,
        client_role: document.getElementById('client_role').value,
        opponent_name: document.getElementById('opponent_name').value,
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
        for (let e of events) html += `<div class="p-2 mb-2 bg-dark rounded border border-success">${e.title}</div>`;
        html += `<hr class="border-secondary"><h6 class="gold-text"><i class="bi bi-list-check"></i> المهام</h6>`;
        if (tasks.length === 0) html += `<p class="small text-muted">لا يوجد</p>`;
        for (let t of tasks) html += `<div class="p-2 mb-2 bg-dark rounded border border-warning d-flex justify-content-between align-items-center"><span style="text-decoration:${t.completed ? 'line-through' : 'none'}">${t.description}</span><input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTask('${t.id}', this.checked)"></div>`;
        document.getElementById('dayModalContent').innerHTML = html;
        showModal('dayModal');
    } catch (e) { console.error(e); }
};
window.toggleTask = async function(id, status) { await db.tasks.update(id, { completed: status }); showDayDetails(currentSelectedDateStr); renderCalendar(); };
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
        for (let e of events) html += `<div class="p-2 mb-2 bg-dark rounded border-start border-success border-4"><span class="text-success small">${e.date}</span><br>${e.title}</div>`;
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
window.printCasePDF = function() { if (!currentCaseForPrint) return; const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }); doc.setFont('Helvetica', 'normal'); let y = 30, margin = 20; doc.text('نظام إدارة القضايا', doc.internal.pageSize.width / 2, y, { align: 'center' }); y += 15; doc.text(`العميل: ${currentCaseForPrint.client_name}`, margin, y, { align: 'right' }); y += 8; doc.text(`رقم القضية: ${currentCaseForPrint.case_number}/${currentCaseForPrint.case_year}`, margin, y, { align: 'right' }); y += 8; doc.text(`المحكمة: ${currentCaseForPrint.court_name}`, margin, y, { align: 'right' }); y += 8; doc.text(`كود القضية: ${currentCaseForPrint.case_code || ''}`, margin, y, { align: 'right' }); y += 12; doc.text('سجل الجلسات:', margin, y, { align: 'right' }); y += 8; if (currentCaseForPrint.sessions && currentCaseForPrint.sessions.length > 0) { currentCaseForPrint.sessions.forEach(s => { const dateStr = new Date(s.session_date).toLocaleDateString('ar-EG'); doc.text(`${dateStr} - ${s.case_status}`, margin, y, { align: 'right' }); y += 6; if (s.decision) { doc.text(`القرار: ${s.decision}`, margin + 5, y, { align: 'right' }); y += 6; } y += 4; if (y > 280) { doc.addPage(); y = 30; } }); } else { doc.text('لا توجد جلسات مسجلة', margin, y, { align: 'right' }); } doc.save(`قضية_${currentCaseForPrint.case_number}.pdf`); };

// ========== 14. المزامنة مع Supabase ==========
window.syncWithSupabase = async function() {
    if (!navigator.onLine) return Swal.fire({ icon: 'warning', title: 'تنبيه', text: 'أنت غير متصل بالإنترنت', background: '#0f172a', color: '#fff' });
    if (!supabaseClient) await initSupabase();
    if (!supabaseClient) return Swal.fire('خطأ', 'لم يتم تهيئة اتصال Supabase', 'error');
    await setSupabaseOfficeId(currentOfficeId);
    Swal.fire({ title: 'جاري المزامنة...', allowOutsideClick: false, didOpen: () => Swal.showLoading(), background: '#0f172a', color: '#fff' });
    try {
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

window.printFeesPDF = async function() { if (!activeCaseId) return; const c = await db.cases.get(activeCaseId) || await db.officeFiles.get(activeCaseId); const fee = await db.fees.get(activeCaseId); const payments = await db.payments.where('case_id').equals(activeCaseId).toArray(); const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' }); let y = 20, margin = 15; doc.setFontSize(18); doc.text('تقرير وكشف حساب أتعاب', doc.internal.pageSize.width / 2, y, { align: 'center' }); y += 15; doc.setFontSize(12); doc.text(`العميل: ${c.client_name}`, margin, y, { align: 'right' }); y += 8; doc.text(`رقم القضية/اسم الملف: ${c.case_number ? `${c.case_number}/${c.case_year}` : (c.title || '-')}`, margin, y, { align: 'right' }); y += 8; doc.text(`الكود: ${c.case_code || c.file_code || ''}`, margin, y, { align: 'right' }); y += 15; doc.setFontSize(14); doc.text(`إجمالي المتفق عليه: ${fee.total} ج.م`, margin, y, { align: 'right' }); y += 8; doc.text(`إجمالي المدفوع: ${fee.paid} ج.م`, margin, y, { align: 'right' }); y += 8; doc.text(`المبلغ المتبقي: ${fee.remaining} ج.م`, margin, y, { align: 'right' }); y += 15; doc.setFontSize(12); doc.text('سجل الدفعات والأقساط:', margin, y, { align: 'right' }); y += 8; payments.sort((a, b) => new Date(a.date) - new Date(b.date)); if (payments.length > 0) { payments.forEach((p, index) => { const dateStr = new Date(p.date).toLocaleDateString('ar-EG'); doc.text(`${index + 1}- [${dateStr}] : ${p.amount} ج.م   (${p.note || ''})`, margin, y, { align: 'right' }); y += 8; if (y > 190) { doc.addPage(); y = 20; } }); } else { doc.text('لا توجد دفعات مسجلة', margin, y, { align: 'right' }); } if (fee.notes) { y += 10; doc.text(`ملاحظات: ${fee.notes}`, margin, y, { align: 'right' }); } doc.save(`أتعاب_${c.case_code || c.file_code || c.case_number || 'حساب'}.pdf`); };

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
window.openCaseDetails = async function(id) { if (!id) return; try { const c = await db.cases.get(id); if (!c) return; activeCaseId = id; document.getElementById('caseDetailsContent').innerHTML = `<div class="d-flex justify-content-between align-items-center mb-3"><div><span class="client-name-large">${c.client_name}</span><span class="role-badge me-3">${c.client_role || 'صفة غير محددة'}</span></div><span class="fs-5 text-warning fw-bold border border-warning px-3 py-1 rounded bg-dark">${c.case_code || '-'}</span></div><div class="row mt-3 text-white fs-5"><div class="col-6 mb-3"><strong>رقم القضية:</strong> <span class="text-light">${c.case_number} / ${c.case_year}</span></div><div class="col-6 mb-3"><strong>المحكمة/الدائرة:</strong> <span class="text-light">${c.court_name || ''} ${c.circuit ? '- الدائرة ' + c.circuit : ''}</span></div><div class="col-6 mb-3"><strong>نوع القضية:</strong> <span class="text-light">${c.case_type || 'غير محدد'}</span></div><div class="col-6 mb-3"><strong>الخصم:</strong> <span class="text-light">${c.opponent_name || '-'}</span></div><div class="col-6 mb-3"><strong>الهاتف:</strong> <span class="text-light">${c.client_phone || '-'}</span></div><div class="col-12 mt-2"><strong>الموضوع:</strong> <br><span class="text-light">${c.case_subject || '-'}</span></div></div>`; const sessions = await db.sessions.where('case_id').equals(id).toArray(); sessions.sort((a, b) => new Date(b.session_date) - new Date(a.session_date)); currentCaseForPrint = { ...c, sessions: sessions }; let sHtml = ''; if (sessions.length > 0) { for (let s of sessions) { sHtml += `<div class="session-item-row"><div><span class="text-info fw-bold fs-5">${new Date(s.session_date).toLocaleString('ar-EG', { dateStyle: 'full', timeStyle: 'short' })}</span><span class="badge bg-light text-dark mx-3 fs-6">${s.case_status}</span><div class="fs-6 mt-2 text-white">${s.decision || 'لا يوجد قرار مسجل'}</div></div><button class="btn btn-sm btn-outline-warning" onclick="event.stopPropagation(); openEditSession('${s.id}')"><i class="bi bi-pencil fs-5"></i></button></div>`; } } else { sHtml = '<p class="text-muted">لا توجد جلسات مسجلة لهذه القضية.</p>'; } document.getElementById('caseSessionsContent').innerHTML = sHtml; document.getElementById('modalActionButtons').innerHTML = `${ipcRenderer && ipcRenderer.createCaseFolder ? '<button class="btn btn-info" onclick="handleOpenCaseFolder()"><i class="bi bi-folder-fill"></i> مجلد</button>' : ''}<button class="btn btn-success" onclick="openFeesModal(activeCaseId)"><i class="bi bi-cash-coin"></i> الأتعاب</button><button class="btn btn-outline-warning" onclick="openEditCaseModalFromPanel()"><i class="bi bi-pencil"></i> تعديل</button><button class="btn btn-danger" onclick="showCaseOptions()"><i class="bi bi-archive"></i> حذف / أرشفة</button>`; showModal('caseModal'); } catch (e) { console.error(e); } };
window.handleOpenCaseFolder = async function() { if (!activeCaseId || !ipcRenderer) return; try { const c = await db.cases.get(activeCaseId); if (!c) return; const caseCode = assertValidCaseCode(c.case_code); const folderName = `${caseCode} - ${c.client_name}`.replace(/[<>:"\/\\|?*]/g, '_'); const res = await ipcRenderer.openCaseFolder(folderName); if (!res || !res.success) { if (ipcRenderer.createCaseFolder) { await ipcRenderer.createCaseFolder(caseCode, c.client_name, c); await ipcRenderer.openCaseFolder(folderName); } } } catch (err) { } };
window.saveEditedCase = async function() { const updated = { client_name: document.getElementById('edit_c_name').value, client_phone: document.getElementById('edit_c_phone').value, opponent_name: document.getElementById('edit_c_opponent').value, case_number: document.getElementById('edit_c_num').value, case_year: document.getElementById('edit_c_year').value, court_name: document.getElementById('edit_c_court').value, circuit: document.getElementById('edit_c_circuit').value, case_type: document.getElementById('edit_case_type').value, case_subject: document.getElementById('edit_c_subject').value }; const currentCase = await db.cases.get(activeCaseId); if (!currentCase) throw new Error('القضية غير موجودة'); const caseCode = assertValidCaseCode(currentCase.case_code); await db.cases.update(activeCaseId, updated); await db.pendingOperations.add({ operation: 'update_case', data: { id: activeCaseId, case_code: caseCode, ...updated }, timestamp: Date.now() }); hideModal('editCaseModal'); openCaseDetails(activeCaseId); Swal.fire({ icon: 'success', title: 'تم التعديل محلياً', timer: 1000, showConfirmButton: false, background: '#0f172a' }); updatePendingBadge(); };
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
    const prefixMap = { real_estate: 'RE', contract_writing: 'CT', company_formation: 'CO', prosecution_investigation: 'PI', detention_renewal: 'DR', administrative: 'AD' };
    const prefix = prefixMap[fileType];
    if (!prefix) throw new Error('نوع الملف المهني غير صالح');
    const year = String(new Date().getFullYear()).slice(-2);
    const sequence = String(Date.now()).slice(-6).padStart(6, '0');
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${year}-${sequence}-${random}`;
}
function assertValidProfessionalFileCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^(RE|CT|CO|PI|DR|AD)-[0-9]{2}-[0-9]{6}-[A-Z0-9]{6}$/.test(normalized)) {
        throw new Error('كود الملف المهني غير صالح');
    }
    return normalized;
}
function professionalTypeLabel(type) {
    return { real_estate: 'تسجيل شهر عقاري', contract_writing: 'كتابة عقد', company_formation: 'تأسيس شركة', prosecution_investigation: 'تحقيق نيابة', detention_renewal: 'تجديد حبس', administrative: 'خدمة مهنية إدارية' }[type] || 'خدمة مهنية';
}
window.openProfessionalFileModal = async function() {
    if (!currentOfficeId) return Swal.fire('تنبيه', 'يجب إعداد المكتب أولًا', 'warning');
    const type = document.getElementById('professionalFileType');
    const title = document.getElementById('professionalFileTitle');
    const client = document.getElementById('professionalClientName');
    const phone = document.getElementById('professionalClientPhone');
    const description = document.getElementById('professionalFileDescription');
    if (type) type.value = 'real_estate';
    const modalTitle = document.getElementById('professionalFileModalTitle'); if (modalTitle) modalTitle.innerHTML = '<i class="bi bi-briefcase"></i> إنشاء ملف خدمة مهنية';
    ['professionalFeeTotal','professionalFeePaid','professionalFeeNotes','professionalExpenseAmount','professionalExpenseCategory'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if (title) title.value = '';
    if (client) client.value = '';
    if (phone) phone.value = '';
    if (description) description.value = '';
    showModal('professionalFileModal');
};
window.openInvestigationFileModal = async function() {
    await window.openProfessionalFileModal();
    const type = document.getElementById('professionalFileType'); if (type) type.value = 'prosecution_investigation';
    const modalTitle = document.getElementById('professionalFileModalTitle'); if (modalTitle) modalTitle.innerHTML = '<i class="bi bi-shield-exclamation"></i> إنشاء ملف تحقيقات';
};
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
        const file = {
            id: generateUUID(), office_id: currentOfficeId, file_code: fileCode, file_type: fileType,
            title, client_name: clientName, client_phone: clientPhone, status: 'مفتوح',
            description: description || null, metadata: {}, archived: false,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };
        await db.officeFiles.add(file);
        const firstEvent = {
            id: generateUUID(), office_id: currentOfficeId, file_id: file.id,
            event_date: new Date().toISOString(), event_type: 'created', status: 'مفتوح',
            title: 'فتح الملف', details: 'تم إنشاء الملف في qayd', client_visible: true,
            created_at: new Date().toISOString()
        };
        await db.fileEvents.add(firstEvent);
        const feeTotal = parseFloat(document.getElementById('professionalFeeTotal')?.value) || 0;
        const feePaid = parseFloat(document.getElementById('professionalFeePaid')?.value) || 0;
        if (feeTotal > 0 || feePaid > 0) {
            await db.fees.put({ case_id: file.id, total: feeTotal, paid: feePaid, remaining: feeTotal - feePaid, notes: document.getElementById('professionalFeeNotes')?.value || '' });
            if (feePaid > 0) await db.payments.add({ case_id: file.id, amount: feePaid, date: new Date().toISOString().split('T')[0], note: 'دفعة مقدمة' });
        }
        const initialExpense = parseFloat(document.getElementById('professionalExpenseAmount')?.value) || 0;
        if (initialExpense > 0) await db.expenses.add({ office_id: currentOfficeId, owner_id: file.id, case_id: file.id, amount: initialExpense, date: new Date().toISOString().split('T')[0], category: document.getElementById('professionalExpenseCategory')?.value || 'مصروف ابتدائي' });
        await db.pendingOperations.bulkAdd([
            { operation: 'insert_office_file', data: file, timestamp: Date.now() },
            { operation: 'insert_file_event', data: firstEvent, timestamp: Date.now() }
        ]);
        if (ipcRenderer && ipcRenderer.createProfessionalFileFolder) {
            await ipcRenderer.createProfessionalFileFolder(file.file_code, file.client_name, file.file_type, file);
        }
        hideModal('professionalFileModal');
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

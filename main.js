const { app, BrowserWindow, ipcMain, Notification, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// يجب أن يستخدم تطبيق qayd نفس مشروع Supabase الثابت الذي يقرأ منه موقع ostazlaw وصفحة «تابع قضيتك».
const SUPABASE_URL = "https://mgvyieyismzzvdejsvcv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndnlpZXlpc216enZkZWpzdmN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NDI2NTMsImV4cCI6MjA5OTExODY1M30.xE-K83Ku3ei3GlFkwKivtBzGMDyK60R6MnYr2eEFz-I";

process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع:', error);
    dialog.showErrorBox('خطأ غير متوقع', error.message);
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400, height: 900,
        icon: path.join(__dirname, 'icons/icon.png'),
                                   webPreferences: {
                                       preload: path.join(__dirname, 'preload.js'),
                                   contextIsolation: true,
                                   nodeIntegration: false
                                   }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ========== دوال المجلدات والقوالب (كما هي) ==========
ipcMain.handle('create-case-folder', async (event, caseCode, clientName, caseData) => {
    try {
        // حماية المستوى الرئيسي: لا يُنشأ مجلد أو ملف قضية خارج صيغة كود qayd المعتمدة.
        if (typeof caseCode !== 'string' || !/^JELR-[0-9]{2}-[0-9]{4}-[A-Z0-9]{6}$/.test(caseCode.trim())) {
            return { success: false, error: 'لا يمكن إنشاء مجلد بدون case_code صالح من qayd' };
        }
        if (!caseData || caseData.case_code !== caseCode.trim()) {
            return { success: false, error: 'بيانات المجلد لا تطابق case_code المرسل' };
        }
        const docsPath = app.getPath('documents');
        const baseDir = path.join(docsPath, 'مكتب المحامي', 'القضايا');
        const folderName = `${caseCode} - ${clientName}`.replace(/[<>:"\/\\|?*]/g, '_');
        const folderPath = path.join(baseDir, folderName);
        fs.mkdirSync(baseDir, { recursive: true });
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            fs.mkdirSync(path.join(folderPath, 'مستندات العميل'), { recursive: true });
            fs.mkdirSync(path.join(folderPath, 'المذكرات والاحكام'), { recursive: true });
            fs.writeFileSync(path.join(folderPath, 'بيانات_القضية.json'), JSON.stringify(caseData, null, 2));
            fs.writeFileSync(path.join(folderPath, 'الأتعاب.csv'), 'المبلغ,التاريخ,ملاحظات\n');
        }
        return { success: true, path: folderPath };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('open-case-folder', async (event, folderName) => {
    try {
        const docsPath = app.getPath('documents');
        const baseDir = path.join(docsPath, 'مكتب المحامي', 'القضايا');
        const archiveDir = path.join(docsPath, 'مكتب المحامي', 'أرشيف');
        let folderPath = path.join(baseDir, folderName);
        if (fs.existsSync(folderPath)) { await shell.openPath(folderPath); return { success: true }; }
        folderPath = path.join(archiveDir, folderName);
        if (fs.existsSync(folderPath)) { await shell.openPath(folderPath); return { success: true }; }
        return { success: false, error: 'المجلد غير موجود' };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('archive-case-folder', async (event, folderName) => {
    try {
        const docsPath = app.getPath('documents');
        const baseDir = path.join(docsPath, 'مكتب المحامي', 'القضايا');
        const archiveDir = path.join(docsPath, 'مكتب المحامي', 'أرشيف');
        const oldPath = path.join(baseDir, folderName);
        const newPath = path.join(archiveDir, folderName);
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
        if (fs.existsSync(oldPath)) {
            if (fs.existsSync(newPath)) {
                let counter = 1, newPathWithSuffix;
                do { newPathWithSuffix = path.join(archiveDir, `${folderName} (${counter})`); counter++; } while (fs.existsSync(newPathWithSuffix));
                fs.renameSync(oldPath, newPathWithSuffix);
                return { success: true };
            } else { fs.renameSync(oldPath, newPath); return { success: true }; }
        }
        return { success: false, error: 'المجلد الأصلي غير موجود' };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('delete-case-folder', async (event, folderName) => {
    try {
        const docsPath = app.getPath('documents');
        const paths = [path.join(docsPath, 'مكتب المحامي', 'القضايا', folderName), path.join(docsPath, 'مكتب المحامي', 'أرشيف', folderName)];
        for (const p of paths) if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); return { success: true }; }
        return { success: false, error: 'المجلد غير موجود' };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('open-template', async (event, folderName, templateName) => {
    try {
        const docsPath = app.getPath('documents');
        const caseFolderPath = path.join(docsPath, 'مكتب المحامي', 'القضايا', folderName);
        if (!fs.existsSync(caseFolderPath)) return { error: 'مجلد القضية غير موجود' };
        const templatesDir = path.join(__dirname, 'templates');
        const templatePath = path.join(templatesDir, templateName);
        if (!fs.existsSync(templatePath)) return { error: 'القالب غير موجود' };
        const targetPath = path.join(caseFolderPath, templateName);
        if (!fs.existsSync(targetPath)) fs.copyFileSync(templatePath, targetPath);
        await shell.openPath(targetPath);
        return { success: true };
    } catch (err) { return { error: err.message }; }
});

ipcMain.handle('open-notes', async (event, folderName) => {
    try {
        const docsPath = app.getPath('documents');
        const caseFolderPath = path.join(docsPath, 'مكتب المحامي', 'القضايا', folderName);
        if (!fs.existsSync(caseFolderPath)) return { error: 'مجلد القضية غير موجود' };
        const notesPath = path.join(caseFolderPath, 'ملاحظات.txt');
        if (!fs.existsSync(notesPath)) fs.writeFileSync(notesPath, 'ملاحظات القضية\n');
        await shell.openPath(notesPath);
        return { success: true };
    } catch (err) { return { error: err.message }; }
});

// حماية مجلدات الملفات الإجرائية والخدمية: لا يُنشأ مجلد إلا بكود ملف صالح.
// الأنواع القديمة تبقى مدعومة للتوافق، والملفات الجديدة تستخدم PI/DR/DC/GR/PR أو RE/CT/CO.
ipcMain.handle('create-professional-file-folder', async (event, fileCode, clientName, fileType, fileData) => {
    try {
        if (typeof fileCode !== 'string' || !/^(RE|CT|CO|PI|DR|AD)-[0-9]{2}-[0-9]{6}-[A-Z0-9]{6}$/.test(fileCode.trim())) {
            return { success: false, error: 'لا يمكن إنشاء مجلد خدمة مهنية بدون كود صالح' };
        }
        if (!fileData || fileData.file_code !== fileCode.trim()) {
            return { success: false, error: 'بيانات المجلد لا تطابق كود الملف' };
        }
        const folders = { prosecution_investigation: 'تحقيقات النيابة', detention_renewal: 'تجديد الحبس', dispute_committee: 'لجان فض المنازعات', grievance: 'التظلمات', legal_procedure: 'الإجراءات القانونية', real_estate: 'تسجيل العقارات', contract_writing: 'العقود', company_formation: 'تأسيس الشركات', administrative: 'خدمات إدارية' };
        const category = folders[fileType] || folders.administrative;
        const docsPath = app.getPath('documents');
        const baseDir = path.join(docsPath, 'مكتب المحامي', 'الخدمات', category);
        const folderName = `${fileCode} - ${clientName}`.replace(/[<>:"/\\|?*]/g, '_');
        const folderPath = path.join(baseDir, folderName);
        fs.mkdirSync(path.join(folderPath, 'مستندات العميل'), { recursive: true });
        fs.mkdirSync(path.join(folderPath, 'نماذج المكتب'), { recursive: true });
        fs.mkdirSync(path.join(folderPath, 'نسخ نهائية'), { recursive: true });
        fs.writeFileSync(path.join(folderPath, 'بيانات_الملف.json'), JSON.stringify(fileData, null, 2));
        return { success: true, path: folderPath };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('open-professional-file-folder', async (event, fileCode, clientName, fileType) => {
    try {
        if (typeof fileCode !== 'string' || !/^(RE|CT|CO|PI|DR|DC|GR|PR|AD)-[0-9]{2}-[0-9]{6}-[A-Z0-9]{6}$/.test(fileCode.trim())) return { success: false, error: 'كود غير صالح' };
        const folders = { prosecution_investigation: 'تحقيقات النيابة', detention_renewal: 'تجديد الحبس', dispute_committee: 'لجان فض المنازعات', grievance: 'التظلمات', legal_procedure: 'الإجراءات القانونية', real_estate: 'تسجيل العقارات', contract_writing: 'العقود', company_formation: 'تأسيس الشركات', administrative: 'خدمات إدارية' };
        const folderPath = path.join(app.getPath('documents'), 'مكتب المحامي', 'الخدمات', folders[fileType] || folders.administrative, `${fileCode} - ${clientName}`.replace(/[<>:"/\\|?*]/g, '_'));
        if (!fs.existsSync(folderPath)) return { success: false, error: 'المجلد غير موجود' };
        await shell.openPath(folderPath);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
});



// نافذة مضيفة مؤقتة لحوارات Linux الأصلية. بعض مديري النوافذ يتجاهلون parent
// بعد أول استخدام، لذلك نستخدم نافذة صغيرة قابلة للتركيز لكل حوار ثم نغلقها.
function createDialogHost(parent) {
    const host = new BrowserWindow({
        width: 1,
        height: 1,
        show: false,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        focusable: true,
        parent: parent && !parent.isDestroyed() ? parent : undefined,
        webPreferences: { sandbox: true }
    });
    host.setAlwaysOnTop(true, 'floating');
    host.show();
    host.focus();
    return host;
}

// إعادة تركيز التطبيق قبل النوافذ الأصلية في Linux؛ بعض مديري النوافذ لا يكتفون بعلاقة parent وحدها.
function bringMainWindowToFront(parent) {
    if (!parent || parent.isDestroyed()) return;
    app.focus({ steal: true });
    if (parent.isMinimized()) parent.restore();
    parent.show();
    parent.setFocusable(true);
    parent.focus();
}

// منتقي الملفات تابع لنافذة التطبيق ويستعيد التركيز بعدها؛ هذا يمنع ظهوره خلف التطبيق عند إعادة فتحه.
async function showFilePicker(event, options) {
    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    let host;
    if (parent && !parent.isDestroyed()) {
        bringMainWindowToFront(parent);
        host = createDialogHost(parent);
    }
    try {
        const result = await dialog.showOpenDialog(host || parent, options);
        return result.canceled ? null : (options.properties?.includes('multiSelections') ? result.filePaths : result.filePaths[0]);
    } finally {
        if (host && !host.isDestroyed()) host.close();
        if (parent && !parent.isDestroyed()) { parent.show(); parent.focus(); }
    }
}

ipcMain.handle('select-file', async (event) => showFilePicker(event, { properties: ['openFile'], filters: [{ name: 'صور ومستندات', extensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'] }] }));
// اختيار أي مستند مكتبي لإضافته إلى مجلد القضية دون حذف أو نقل الملف الأصلي.
ipcMain.handle('select-case-document', async (event) => showFilePicker(event, {
    // السماح باختيار عدة مستندات، وتشمل المذكرات والصحف والدعاوى بصيغها المكتبية الشائعة.
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'مستندات القضية والمذكرات والصحف', extensions: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp', 'txt'] }]
}));

// نقل أو نسخ عدة مستندات إلى مجلد «مستندات العميل» بعد التحقق من كود القضية.
ipcMain.handle('copy-case-document', async (event, sourcePaths, caseCode, clientName, mode = 'copy') => {
    try {
        const paths = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths];
        if (!paths.length || paths.some(source => !source || !fs.existsSync(source))) return { success: false, error: 'أحد المستندات المصدر غير موجود' };
        if (typeof caseCode !== 'string' || !/^JELR-[0-9]{2}-[0-9]{4}-[A-Z0-9]{6}$/.test(caseCode.trim())) return { success: false, error: 'كود القضية غير صالح' };
        const safeClient = String(clientName || 'عميل').replace(/[<>:"/\\|?*]/g, '_');
        const targetDir = path.join(app.getPath('documents'), 'مكتب المحامي', 'القضايا', `${caseCode.trim()} - ${safeClient}`, 'مستندات العميل');
        fs.mkdirSync(targetDir, { recursive: true });
        const copied = [];
        for (const source of paths) {
            const originalName = path.basename(source).replace(/[<>:"/\\|?*]/g, '_');
            const ext = path.extname(originalName);
            const stem = path.basename(originalName, ext);
            const targetPath = path.join(targetDir, `${stem}_${Date.now()}_${copied.length + 1}${ext}`);
            if (mode === 'move') fs.renameSync(source, targetPath); else fs.copyFileSync(source, targetPath);
            copied.push({ name: path.basename(targetPath), path: targetPath, mode });
        }
        return { success: true, files: copied, count: copied.length };
    } catch (err) { return { success: false, error: err.message }; }
});

// اختيار مستندات الخدمات المهنية، مع دعم الاختيار المتعدد.
ipcMain.handle('select-professional-document', async (event) => showFilePicker(event, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'مستندات الملف والمذكرات والصحف', extensions: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp', 'txt'] }] }));

ipcMain.handle('copy-professional-document', async (event, sourcePaths, fileCode, clientName, fileType, mode = 'copy') => {
    try {
        const paths = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths];
        if (!paths.length || paths.some(source => !source || !fs.existsSync(source))) return { success: false, error: 'أحد المستندات المصدر غير موجود' };
        if (typeof fileCode !== 'string' || !/^(RE|CT|CO|PI|DR|DC|GR|PR|AD)-[0-9]{2}-[0-9]{6}-[A-Z0-9]{6}$/.test(fileCode.trim())) return { success: false, error: 'كود الملف غير صالح' };
        const folders = { prosecution_investigation: 'تحقيقات النيابة', detention_renewal: 'تجديد الحبس', dispute_committee: 'لجان فض المنازعات', grievance: 'التظلمات', legal_procedure: 'الإجراءات القانونية', real_estate: 'تسجيل العقارات', contract_writing: 'العقود', company_formation: 'تأسيس الشركات', administrative: 'خدمات إدارية' };
        const dir = path.join(app.getPath('documents'), 'مكتب المحامي', 'الخدمات', folders[fileType] || 'الإجراءات القانونية', `${fileCode} - ${String(clientName || 'عميل').replace(/[<>:"/\|?*]/g, '_')}`, 'مستندات العميل');
        fs.mkdirSync(dir, { recursive: true });
        const files = [];
        for (const sourcePath of paths) {
            const ext = path.extname(sourcePath); const stem = path.basename(sourcePath, ext).replace(/[<>:"/\\|?*]/g, '_');
            const name = `${stem}_${Date.now()}_${files.length + 1}${ext}`; const target = path.join(dir, name);
            if (mode === 'move') fs.renameSync(sourcePath, target); else fs.copyFileSync(sourcePath, target);
            files.push({ path: target, name });
        }
        return { success: true, files, count: files.length, path: files[0]?.path, name: files[0]?.name };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('print-arabic-pdf', async (event, html, filename) => {
    let printWindow, host;
    try {
        const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        printWindow = new BrowserWindow({ show: false, parent, modal: true, webPreferences: { offscreen: true } });
        await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        const pdf = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
        if (parent && !parent.isDestroyed()) { bringMainWindowToFront(parent); host = createDialogHost(parent); }
        const save = await dialog.showSaveDialog(host || parent, { title: 'حفظ ملف PDF', defaultPath: filename || 'تقرير.pdf', filters: [{ name: 'ملفات PDF', extensions: ['pdf'] }] });
        if (save.canceled || !save.filePath) return { canceled: true };
        fs.writeFileSync(save.filePath, pdf);
        parent.show(); parent.focus();
        return { success: true, path: save.filePath };
    } catch (err) { return { success: false, error: err.message }; }
    finally {
        if (host && !host.isDestroyed()) host.close();
        if (printWindow && !printWindow.isDestroyed()) printWindow.close();
        if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
    }
});

ipcMain.handle('copy-receipt', async (event, sourcePath, recordId) => {
    try {
        if (!sourcePath || !recordId || !fs.existsSync(sourcePath)) return { success: false, error: 'ملف الإيصال غير موجود' };
        const safeId = String(recordId).replace(/[^a-zA-Z0-9_-]/g, '_');
        const dir = path.join(app.getPath('documents'), 'مكتب المحامي', 'المرفقات المالية', safeId);
        fs.mkdirSync(dir, { recursive: true });
        const ext = path.extname(sourcePath).toLowerCase() || '.dat';
        const target = path.join(dir, `إيصال_${Date.now()}${ext}`);
        fs.copyFileSync(sourcePath, target);
        return { success: true, path: target, name: path.basename(target) };
    } catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('open-local-file', async (event, filePath) => {
    try { return { success: true, error: await shell.openPath(filePath) }; } catch (err) { return { success: false, error: err.message }; }
});



ipcMain.on('show-notification', (event, title, body) => { new Notification({ title, body }).show(); });

ipcMain.handle('get-supabase-keys', () => {
    return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
});

ipcMain.handle('get-dev-mode', () => {
    return !app.isPackaged; // true أثناء التطوير (npm start)
});

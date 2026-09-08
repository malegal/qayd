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

// حماية مجلدات الخدمات المهنية: لا يُنشأ مجلد إلا بكود RE أو CO أو AD صالح.
ipcMain.handle('create-professional-file-folder', async (event, fileCode, clientName, fileType, fileData) => {
    try {
        if (typeof fileCode !== 'string' || !/^(RE|CT|CO|PI|DR|AD)-[0-9]{2}-[0-9]{6}-[A-Z0-9]{6}$/.test(fileCode.trim())) {
            return { success: false, error: 'لا يمكن إنشاء مجلد خدمة مهنية بدون كود صالح' };
        }
        if (!fileData || fileData.file_code !== fileCode.trim()) {
            return { success: false, error: 'بيانات المجلد لا تطابق كود الملف' };
        }
        const folders = { real_estate: 'الشهر العقاري', contract_writing: 'كتابة العقود', company_formation: 'تأسيس الشركات', prosecution_investigation: 'تحقيقات النيابة', detention_renewal: 'تجديد الحبس', administrative: 'خدمات إدارية' };
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
        if (typeof fileCode !== 'string' || !/^(RE|CT|CO|PI|DR|AD)-[0-9]{2}-[0-9]{6}-[A-Z0-9]{6}$/.test(fileCode.trim())) return { success: false, error: 'كود غير صالح' };
        const folders = { real_estate: 'الشهر العقاري', contract_writing: 'كتابة العقود', company_formation: 'تأسيس الشركات', prosecution_investigation: 'تحقيقات النيابة', detention_renewal: 'تجديد الحبس', administrative: 'خدمات إدارية' };
        const folderPath = path.join(app.getPath('documents'), 'مكتب المحامي', 'الخدمات', folders[fileType] || folders.administrative, `${fileCode} - ${clientName}`.replace(/[<>:"/\\|?*]/g, '_'));
        if (!fs.existsSync(folderPath)) return { success: false, error: 'المجلد غير موجود' };
        await shell.openPath(folderPath);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
});



ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'صور ومستندات', extensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'] }] });
    return result.canceled ? null : result.filePaths[0];
});
// اختيار أي مستند مكتبي لإضافته إلى مجلد القضية دون حذف أو نقل الملف الأصلي.
ipcMain.handle('select-case-document', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'مستندات القضية', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp', 'txt'] }]
    });
    return result.canceled ? null : result.filePaths[0];
});

// نسخ المستند إلى مجلد «مستندات العميل» بعد التحقق من كود القضية.
ipcMain.handle('copy-case-document', async (event, sourcePath, caseCode, clientName) => {
    try {
        if (!sourcePath || !fs.existsSync(sourcePath)) return { success: false, error: 'المستند المصدر غير موجود' };
        if (typeof caseCode !== 'string' || !/^JELR-[0-9]{2}-[0-9]{4}-[A-Z0-9]{6}$/.test(caseCode.trim())) return { success: false, error: 'كود القضية غير صالح' };
        const safeCode = caseCode.trim();
        const safeClient = String(clientName || 'عميل').replace(/[<>:"/\\|?*]/g, '_');
        const targetDir = path.join(app.getPath('documents'), 'مكتب المحامي', 'القضايا', `${safeCode} - ${safeClient}`, 'مستندات العميل');
        fs.mkdirSync(targetDir, { recursive: true });
        const originalName = path.basename(sourcePath).replace(/[<>:"/\\|?*]/g, '_');
        const ext = path.extname(originalName);
        const stem = path.basename(originalName, ext);
        const targetName = `${stem}_${Date.now()}${ext}`;
        const targetPath = path.join(targetDir, targetName);
        fs.copyFileSync(sourcePath, targetPath);
        return { success: true, path: targetPath, name: targetName };
    } catch (err) { return { success: false, error: err.message }; }
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

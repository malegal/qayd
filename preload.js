const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // إدارة المجلدات
  createCaseFolder: (caseCode, clientName, caseData) => ipcRenderer.invoke('create-case-folder', caseCode, clientName, caseData),
                                openCaseFolder: (folderName) => ipcRenderer.invoke('open-case-folder', folderName),
                                archiveCaseFolder: (folderName) => ipcRenderer.invoke('archive-case-folder', folderName),
                                deleteCaseFolder: (folderName) => ipcRenderer.invoke('delete-case-folder', folderName),
  // مجلدات الملفات المهنية منفصلة عن مجلدات القضايا القضائية.
  createProfessionalFileFolder: (fileCode, clientName, fileType, fileData) => ipcRenderer.invoke('create-professional-file-folder', fileCode, clientName, fileType, fileData),
  openProfessionalFileFolder: (fileCode, clientName, fileType) => ipcRenderer.invoke('open-professional-file-folder', fileCode, clientName, fileType),
                                saveFeesCSV: (folderName, csvContent) => ipcRenderer.invoke('save-fees-csv', folderName, csvContent),
                                showNotification: (title, body) => ipcRenderer.send('show-notification', title, body),
                                selectFile: () => ipcRenderer.invoke('select-file'),
                                // إضافة مستند إلى مجلد القضية المحلي دون كشف IPC مباشرة للواجهة.
                                selectCaseDocument: () => ipcRenderer.invoke('select-case-document'),
                                copyCaseDocument: (sourcePath, caseCode, clientName) => ipcRenderer.invoke('copy-case-document', sourcePath, caseCode, clientName),
                                selectProfessionalDocument: () => ipcRenderer.invoke('select-professional-document'),
                                copyProfessionalDocument: (sourcePath, fileCode, clientName, fileType) => ipcRenderer.invoke('copy-professional-document', sourcePath, fileCode, clientName, fileType),
                                printArabicPdf: (html, filename) => ipcRenderer.invoke('print-arabic-pdf', html, filename),
                                copyReceipt: (sourcePath, recordId) => ipcRenderer.invoke('copy-receipt', sourcePath, recordId),
                                openLocalFile: (filePath) => ipcRenderer.invoke('open-local-file', filePath),
                                openTemplate: (folderName, templateName) => ipcRenderer.invoke('open-template', folderName, templateName),
                                openNotes: (folderName) => ipcRenderer.invoke('open-notes', folderName),
                                // Supabase keys
                                getSupabaseKeys: () => ipcRenderer.invoke('get-supabase-keys'),
                                // وضع التطوير
                                getDevMode: () => ipcRenderer.invoke('get-dev-mode')
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // إدارة المجلدات
  createCaseFolder: (caseCode, clientName, caseData) => ipcRenderer.invoke('create-case-folder', caseCode, clientName, caseData),
                                openCaseFolder: (folderName) => ipcRenderer.invoke('open-case-folder', folderName),
                                archiveCaseFolder: (folderName) => ipcRenderer.invoke('archive-case-folder', folderName),
                                deleteCaseFolder: (folderName) => ipcRenderer.invoke('delete-case-folder', folderName),
                                saveFeesCSV: (folderName, csvContent) => ipcRenderer.invoke('save-fees-csv', folderName, csvContent),
                                showNotification: (title, body) => ipcRenderer.send('show-notification', title, body),
                                selectFile: () => ipcRenderer.invoke('select-file'),
                                openTemplate: (folderName, templateName) => ipcRenderer.invoke('open-template', folderName, templateName),
                                openNotes: (folderName) => ipcRenderer.invoke('open-notes', folderName),
                                // Supabase keys
                                getSupabaseKeys: () => ipcRenderer.invoke('get-supabase-keys'),
                                // وضع التطوير
                                getDevMode: () => ipcRenderer.invoke('get-dev-mode')
});

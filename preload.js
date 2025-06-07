const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    startCapture: () => ipcRenderer.send('start-capture'),
    stopCapture: () => ipcRenderer.send('stop-capture'),
    closeFloatingWindow: () => ipcRenderer.send('close-floating-window'),
    sendFrame: (frame) => ipcRenderer.send('frame-captured', frame),
    sendError: (error) => ipcRenderer.send('capture-error', error),
    onUpdateDetection: (callback) => {
        ipcRenderer.on('update-detection', (event, data) => callback(event, data));
        return () => ipcRenderer.removeListener('update-detection', callback);
    }
}); 
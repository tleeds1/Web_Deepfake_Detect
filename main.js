const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const io = require('socket.io-client');

let mainWindow;
let floatingWindow;
let captureWindow;
let socket;
let isCapturing = false;

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 200,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Create a simple HTML file for the main window
    const htmlContent = `
        <!DOCTYPE html>
        <html>
            <head>
                <style>
                    body {
                        background: #1a1a1a;
                        color: white;
                        font-family: Arial, sans-serif;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        padding: 20px;
                    }
                    .button {
                        background: #4F46E5;
                        color: white;
                        padding: 12px 24px;
                        border-radius: 50px;
                        border: none;
                        cursor: pointer;
                        font-size: 16px;
                        margin: 10px;
                        transition: all 0.3s ease;
                    }
                    .button:hover {
                        background: #4338CA;
                        transform: translateY(-2px);
                    }
                    .button:disabled {
                        background: #9CA3AF;
                        cursor: not-allowed;
                        transform: none;
                    }
                    #status {
                        color: #9CA3AF;
                        margin-top: 10px;
                        font-size: 14px;
                    }
                </style>
            </head>
            <body>
                <button id="startBtn" class="button" disabled>Start Detection</button>
                <button id="stopBtn" class="button" style="display: none;">Stop Detection</button>
                <div id="status">Connecting to server...</div>
            </body>
            <script>
                const startBtn = document.getElementById('startBtn');
                const stopBtn = document.getElementById('stopBtn');
                const status = document.getElementById('status');

                startBtn.addEventListener('click', () => {
                    window.electronAPI.startCapture();
                });

                stopBtn.addEventListener('click', () => {
                    window.electronAPI.stopCapture();
                });

                // Update UI based on connection status
                function updateConnectionStatus(isConnected) {
                    console.log('Updating connection status:', isConnected);
                    startBtn.disabled = !isConnected;
                    status.textContent = isConnected ? 'Connected to server' : 'Disconnected from server';
                    status.style.color = isConnected ? '#4F46E5' : '#EF4444';
                }

                // Initial state
                updateConnectionStatus(false);
            </script>
        </html>
    `;

    // Write the HTML content to a temporary file
    const fs = require('fs');
    const tempHtmlPath = path.join(__dirname, 'temp.html');
    fs.writeFileSync(tempHtmlPath, htmlContent);

    // Load the HTML file
    mainWindow.loadFile(tempHtmlPath);

    // Clean up the temporary file after loading
    mainWindow.webContents.on('did-finish-load', () => {
        fs.unlinkSync(tempHtmlPath);
    });

    // Initialize socket connection with explicit IPv4 address
    socket = io('http://127.0.0.1:5000', {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
        transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        mainWindow.webContents.executeJavaScript(`
            console.log('Socket connected, enabling button');
            updateConnectionStatus(true);
        `);
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        mainWindow.webContents.executeJavaScript(`
            console.log('Socket connection error, disabling button');
            updateConnectionStatus(false);
        `);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        mainWindow.webContents.executeJavaScript(`
            console.log('Socket disconnected, disabling button');
            updateConnectionStatus(false);
        `);
        stopCapture();
    });

    socket.on('detection_result', (data) => {
        console.log('Received detection result:', data);
        if (floatingWindow) {
            floatingWindow.webContents.send('update-detection', data);
        }
    });

    // Force a connection status check after a short delay
    setTimeout(() => {
        mainWindow.webContents.executeJavaScript(`
            console.log('Checking initial connection status');
            updateConnectionStatus(${socket.connected});
        `);
    }, 1000);

    // Add error handler for the main window
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.executeJavaScript(`
            document.getElementById('startBtn').disabled = true;
            console.log('Waiting for server connection...');
        `);
    });
}

function createFloatingWindow() {
    floatingWindow = new BrowserWindow({
        width: 250,
        height: 100,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    floatingWindow.loadFile('floating_window.html');
    floatingWindow.setAlwaysOnTop(true, 'floating');
}

async function startCapture() {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });

        if (sources.length === 0) {
            throw new Error('No screen sources found');
        }

        captureWindow = new BrowserWindow({
            width: 800,
            height: 600,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            }
        });

        // Create a temporary HTML file for the capture window
        const captureHtmlContent = `
            <!DOCTYPE html>
            <html>
                <body>
                    <video id="video" autoplay></video>
                    <canvas id="canvas" style="display: none;" width="320" height="240"></canvas>
                    <script>
                        const video = document.getElementById('video');
                        const canvas = document.getElementById('canvas');
                        const ctx = canvas.getContext('2d');
                        let captureInterval;

                        async function startCapture() {
                            try {
                                const stream = await navigator.mediaDevices.getUserMedia({
                                    audio: false,
                                    video: {
                                        mandatory: {
                                            chromeMediaSource: 'desktop',
                                            chromeMediaSourceId: '${sources[0].id}',
                                            minWidth: 320,
                                            maxWidth: 320,
                                            minHeight: 240,
                                            maxHeight: 240
                                        }
                                    }
                                });
                                
                                video.srcObject = stream;
                                await video.play();
                                
                                // Clear any existing interval
                                if (captureInterval) {
                                    clearInterval(captureInterval);
                                }

                                // Start capturing frames
                                captureInterval = setInterval(() => {
                                    if (video.videoWidth === 0 || video.videoHeight === 0) return;
                                    
                                    // Draw the current frame to canvas
                                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                                    
                                    // Convert to JPEG with lower quality for better performance
                                    const frame = canvas.toDataURL('image/jpeg', 0.5);
                                    
                                    // Send the frame to the main process
                                    window.electronAPI.sendFrame(frame);
                                }, 1000); // Capture every second

                            } catch (err) {
                                console.error('Capture error:', err);
                                window.electronAPI.sendError(err.message);
                            }
                        }

                        // Start capture when the page loads
                        startCapture();

                        // Cleanup when the window is closed
                        window.addEventListener('beforeunload', () => {
                            if (captureInterval) {
                                clearInterval(captureInterval);
                            }
                            if (video.srcObject) {
                                video.srcObject.getTracks().forEach(track => track.stop());
                            }
                        });
                    </script>
                </body>
            </html>
        `;

        // Write the HTML content to a temporary file
        const fs = require('fs');
        const tempCaptureHtmlPath = path.join(__dirname, 'temp_capture.html');
        fs.writeFileSync(tempCaptureHtmlPath, captureHtmlContent);

        // Load the HTML file
        await captureWindow.loadFile(tempCaptureHtmlPath);

        // Clean up the temporary file after loading
        captureWindow.webContents.on('did-finish-load', () => {
            fs.unlinkSync(tempCaptureHtmlPath);
        });

        isCapturing = true;
        mainWindow.webContents.executeJavaScript(`
            document.getElementById('startBtn').style.display = 'none';
            document.getElementById('stopBtn').style.display = 'block';
        `);

        if (!floatingWindow) {
            createFloatingWindow();
        }

    } catch (err) {
        console.error('Error starting capture:', err);
        mainWindow.webContents.executeJavaScript(`
            alert('Error starting capture: ' + ${JSON.stringify(err.message)});
        `);
    }
}

function stopCapture() {
    if (captureWindow) {
        // Send a message to the capture window to cleanup
        captureWindow.webContents.executeJavaScript(`
            if (window.captureInterval) {
                clearInterval(window.captureInterval);
            }
            if (document.getElementById('video').srcObject) {
                document.getElementById('video').srcObject.getTracks().forEach(track => track.stop());
            }
        `);
        captureWindow.close();
        captureWindow = null;
    }
    isCapturing = false;
    mainWindow.webContents.executeJavaScript(`
        document.getElementById('startBtn').style.display = 'block';
        document.getElementById('stopBtn').style.display = 'none';
    `);
}

app.whenReady().then(() => {
    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.on('start-capture', () => {
    startCapture();
});

ipcMain.on('stop-capture', () => {
    stopCapture();
});

ipcMain.on('close-floating-window', () => {
    if (floatingWindow) {
        floatingWindow.close();
        floatingWindow = null;
    }
});

ipcMain.on('frame-captured', (event, frame) => {
    if (isCapturing && socket && socket.connected) {
        console.log('Sending frame to server');
        socket.emit('screen_frame', frame, (response) => {
            console.log('Server response:', response);
        });
    } else {
        console.log('Socket not connected or not capturing');
    }
});

ipcMain.on('capture-error', (event, error) => {
    console.error('Capture error:', error);
    mainWindow.webContents.executeJavaScript(`
        alert('Error capturing screen: ' + ${JSON.stringify(error)});
    `);
    stopCapture();
}); 
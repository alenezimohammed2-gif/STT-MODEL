const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SonioxClient = require('./src/soniox-client');
const TextOutput = require('./src/text-output');
const config = require('./src/config');

// Debug log
const logFile = path.join(process.env.LOCALAPPDATA || process.env.TEMP || 'C:\\Temp', 'stt-debug.log');
function debugLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch (e) { /* ignore */ }
  console.log(msg);
}

let mainWindow = null;
let tray = null;
let sonioxClient = null;
let textOutput = null;
let isRecording = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: config.WINDOW_WIDTH,
    height: config.WINDOW_HEIGHT,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.center();

  mainWindow.on('close', (event) => {
    // Minimize to tray instead of closing
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Create a simple tray icon
  const iconSize = 16;

  // Create a simple colored icon programmatically
  const canvas = Buffer.alloc(iconSize * iconSize * 4);
  for (let y = 0; y < iconSize; y++) {
    for (let x = 0; x < iconSize; x++) {
      const idx = (y * iconSize + x) * 4;
      const cx = x - iconSize / 2;
      const cy = y - iconSize / 2;
      const dist = Math.sqrt(cx * cx + cy * cy);
      if (dist < iconSize / 2 - 1) {
        canvas[idx] = 41;      // R
        canvas[idx + 1] = 128; // G
        canvas[idx + 2] = 185; // B
        canvas[idx + 3] = 255; // A
      } else {
        canvas[idx + 3] = 0;   // Transparent
      }
    }
  }
  const trayIcon = nativeImage.createFromBuffer(canvas, { width: iconSize, height: iconSize });

  tray = new Tray(trayIcon);
  tray.setToolTip('تحويل الكلام إلى نص');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'فتح البرنامج',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'بدء/إيقاف التسجيل',
      click: () => {
        toggleRecording();
      }
    },
    { type: 'separator' },
    {
      label: 'إغلاق البرنامج',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  const apiKey = process.env.SONIOX_API_KEY;

  if (!apiKey) {
    mainWindow.webContents.send('error', 'مفتاح API غير موجود. أضف SONIOX_API_KEY في ملف .env');
    return;
  }

  isRecording = true;
  mainWindow.webContents.send('recording-state-changed', true);

  textOutput = new TextOutput();
  sonioxClient = new SonioxClient(apiKey);

  sonioxClient.onToken((text) => {
    debugLog(`TOKEN RECEIVED: "${text}"`);
    textOutput.typeText(text);
    mainWindow.webContents.send('transcription', { text, isFinal: true });
  });


  sonioxClient.onCorrection((deleteCount, newText) => {
    debugLog(`CORRECTION: delete ${deleteCount}, type "${newText}"`);
    textOutput.correctText(deleteCount, newText);
  });

  sonioxClient.onError((message) => {
    mainWindow.webContents.send('error', message);
  });

  sonioxClient.onDisconnected(() => {
    if (isRecording) {
      isRecording = false;
      mainWindow.webContents.send('recording-state-changed', false);
    }
  });

  try {
    await sonioxClient.connect();
  } catch (err) {
    console.error('Failed to connect to Soniox:', err);
    isRecording = false;
    mainWindow.webContents.send('recording-state-changed', false);
    mainWindow.webContents.send('error', 'فشل الاتصال بخدمة Soniox');
  }
}

function stopRecording() {
  isRecording = false;
  mainWindow.webContents.send('recording-state-changed', false);

  if (sonioxClient) {
    sonioxClient.disconnect();
    sonioxClient = null;
  }

  if (textOutput) {
    textOutput.reset();
    textOutput.destroy();
    textOutput = null;
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Register global hotkey
  const registered = globalShortcut.register(config.HOTKEY, () => {
    toggleRecording();
  });

  if (!registered) {
    console.error(`Failed to register hotkey: ${config.HOTKEY}`);
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('error', `فشل تسجيل اختصار ${config.HOTKEY}. قد يكون مستخدماً من برنامج آخر.`);
    });
  } else {
    console.log(`Hotkey registered successfully: ${config.HOTKEY}`);
  }

  // IPC handlers
  ipcMain.on('audio-chunk', (_event, chunk) => {
    if (sonioxClient && isRecording) {
      const buffer = Buffer.from(chunk);
      sonioxClient.sendAudio(buffer);
    }
  });

  ipcMain.on('toggle-recording', () => {
    toggleRecording();
  });

  ipcMain.on('window-minimize', () => {
    mainWindow.hide();
  });

  ipcMain.on('window-close', () => {
    app.isQuitting = true;
    app.quit();
  });

  // Auto-start on login (when packaged)
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      enabled: true
    });
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (sonioxClient) {
    sonioxClient.disconnect();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SonioxClient = require('./src/soniox-client');
const TextOutput = require('./src/text-output');
const config = require('./src/config');

let mainWindow = null;
let sonioxClient = null;
let textOutput = null;
let isRecording = false;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: config.WINDOW_WIDTH,
    height: config.WINDOW_HEIGHT,
    x: width - config.WINDOW_WIDTH - 20,
    y: height - config.WINDOW_HEIGHT - 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setVisibleOnAllWorkspaces(true);
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
    textOutput.typeText(text);
    mainWindow.webContents.send('transcription', { text, isFinal: true });
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

  textOutput = null;
}

app.whenReady().then(() => {
  createWindow();

  const registered = globalShortcut.register(config.HOTKEY, () => {
    toggleRecording();
  });

  if (!registered) {
    console.error(`Failed to register hotkey: ${config.HOTKEY}`);
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('error', `فشل تسجيل اختصار ${config.HOTKEY}. قد يكون مستخدماً من برنامج آخر.`);
    });
  }

  ipcMain.on('audio-chunk', (_event, chunk) => {
    if (sonioxClient && isRecording) {
      const buffer = Buffer.from(chunk);
      sonioxClient.sendAudio(buffer);
    }
  });

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

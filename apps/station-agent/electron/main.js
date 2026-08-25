// MES Missioner Electron — main process
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let viteProc = null;

// ── Log file ────────────────────────────────────────────────────────────────
const isDev = process.argv.includes('--dev');
const logDir = app.getPath('userData');
const logPath = path.join(logDir, 'mes_missioner.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logPath, line); } catch {}
}

// Override console methods to write to log file
const origError = console.error;
const origWarn = console.warn;
const origLog = console.log;
console.error = (...args) => { origError(...args); log(`ERROR: ${args.map(a => String(a)).join(' ')}`); };
console.warn = (...args) => { origWarn(...args); log(`WARN: ${args.map(a => String(a)).join(' ')}`); };
console.log = (...args) => { origLog(...args); log(`INFO: ${args.map(a => String(a)).join(' ')}`); };

log('MES Missioner Electron starting...');
log(`Log file: ${logPath}`);

// ── Vite wait helper ─────────────────────────────────────────────────────────
function waitForVite(url, timeout = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const iv = setInterval(() => {
      http.get(url, (res) => {
        if (res.statusCode === 200) { clearInterval(iv); resolve(); }
      }).on('error', () => {});
      if (Date.now() - start > timeout) { clearInterval(iv); resolve(); }
    }, 300);
  });
}

// ── Start Vite dev server ─────────────────────────────────────────────────────
function startVite() {
  const viteBin = path.join(__dirname, '../node_modules/vite/bin/vite.js');
  viteProc = spawn(process.execPath, [viteBin, '--port', '5179', '--host'], {
    stdio: 'ignore',
    shell: true,
    detached: false,
    cwd: path.join(__dirname, '..'),
  });
  viteProc.on('error', (err) => console.error('[Vite]', err.message));
}

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: false,
    title: 'MES Missioner',
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'MES Missioner',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow.reload() },
        { label: 'Toggle DevTools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Station',
      submenu: [
        { label: 'Open Station Logs', click: () => { log('Opening log file...'); shell.openPath(logPath); } },
        { type: 'separator' },
        { label: 'Restart Sync', click: () => mainWindow.webContents.send('sync-restart') },
        { label: 'Clear Local DB', click: () => mainWindow.webContents.send('db-clear') },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // Load: dev server in dev mode, dist/index.html in production
  if (isDev) {
    mainWindow.loadURL('http://localhost:5179');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (isDev) {
    console.log('[Electron] Starting Vite dev server...');
    startVite();
    await waitForVite('http://localhost:5179');
    console.log('[Electron] Vite ready. Creating window...');
  } else {
    console.log('[Electron] Production mode. Loading dist build...');
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (viteProc) viteProc.kill();
  app.quit();
});

app.on('activate', () => { if (mainWindow === null) createWindow(); });

process.on('exit', () => { if (viteProc) viteProc.kill(); });

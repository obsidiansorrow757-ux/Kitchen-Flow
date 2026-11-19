// KitchenFlow — Electron main process
// Wraps app/index.html in a desktop window and gives it real file dialogs,
// a native menu, unsaved-changes protection, and remembered window size.
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'KitchenFlow';
const MIN_SPLASH_MS = 2200; // how long the intro shows at minimum
const FILE_FILTERS = [
  { name: 'Kitchen Layout', extensions: ['json'] },
  { name: 'All Files', extensions: ['*'] }
];

let win = null;
let splash = null;
let splashShownAt = 0;
let onSplashShown = null;
let isDirty = false;
let forceClose = false;
let startupFile = null;

/* ---------- window size/position memory ---------- */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return null; }
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch (e) { /* not critical */ }
}

/* ---------- a .json passed on the command line (e.g. "Open with") ---------- */
function fileFromArgs(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.find(a => /\.json$/i.test(a) && fs.existsSync(a)) || null;
}

/* ---------- single instance: a second launch hands its file to the open window ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = fileFromArgs(argv);
    if (f) win.webContents.send('menu', 'open-path', f);
  });
}

function send(action, arg) {
  if (win && !win.isDestroyed()) win.webContents.send('menu', action, arg);
}

function buildMenu() {
  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { label: 'Exit', click: () => win && win.close() }
      ]
    },
    {
      // Undo/Redo/Select All are left to the app's own shortcuts (Ctrl+Z/Y/A),
      // so typing in a side-panel field still undoes text the normal way.
      label: '&Edit',
      submenu: [
        { label: 'Undo', click: () => send('undo') },
        { label: 'Redo', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: 'Zoom to Fit', click: () => send('fit') },
        { label: 'Front View', click: () => send('front') },
        { label: '3D View', click: () => send('3d') },
        { label: 'Slab Layout', click: () => send('slab') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() }
      ]
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About ' + APP_NAME,
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: 'About ' + APP_NAME,
            message: APP_NAME,
            detail: 'Version ' + app.getVersion() + '\nElectron ' + process.versions.electron
          })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createSplash() {
  splash = new BrowserWindow({
    width: 640,
    height: 380,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  splash.once('ready-to-show', () => splash && splash.show());
  splash.once('show', () => { splashShownAt = Date.now(); if (onSplashShown) onSplashShown(); });
  splash.on('closed', () => { splash = null; });
  splash.loadFile(path.join(__dirname, 'app', 'splash.html'), { query: { v: app.getVersion() } });
}

function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    width: (st && st.bounds && st.bounds.width) || 1500,
    height: (st && st.bounds && st.bounds.height) || 920,
    x: st && st.bounds ? st.bounds.x : undefined,
    y: st && st.bounds ? st.bounds.y : undefined,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#222222',
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  // Keep the main window hidden behind the intro until it's drawn and the
  // intro has had its minimum time, then fade the intro out and swap.
  let revealed = false;
  function reveal() {
    if (revealed || !win || win.isDestroyed()) return;
    revealed = true;
    const swap = () => {
      if (!win || win.isDestroyed()) return;
      if (st && st.maximized) win.maximize();
      win.show();
      win.focus();
      setTimeout(() => { if (splash && !splash.isDestroyed()) splash.destroy(); }, 120);
    };
    if (splash && !splash.isDestroyed()) {
      splash.webContents.executeJavaScript('splashOut()').catch(() => {});
      setTimeout(swap, 330);
    } else swap();
  }
  let mainReady = false;
  function tryReveal() {
    if (!mainReady) return;
    if (!splashShownAt && splash && !splash.isDestroyed()) return; // wait for the intro to appear first
    setTimeout(reveal, Math.max(0, MIN_SPLASH_MS - (Date.now() - splashShownAt)));
  }
  onSplashShown = tryReveal;
  win.once('ready-to-show', () => { mainReady = true; tryReveal(); });
  setTimeout(reveal, 15000); // safety net: never leave the app hidden

  // The page sets its own title through the bridge; don't let <title> override it.
  win.on('page-title-updated', e => e.preventDefault());

  // Dropping a file on the window must never navigate away from the app.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', e => {
    if (isDirty && !forceClose) {
      e.preventDefault();
      const r = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: APP_NAME,
        message: 'Save changes to this layout before closing?'
      });
      if (r === 0) send('save-then-close');
      else if (r === 1) { forceClose = true; win.close(); }
      return;
    }
    saveWindowState();
  });
  win.on('closed', () => { win = null; });

  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

/* ---------- IPC: file access for the page ---------- */
ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open Layout', filters: FILE_FILTERS, properties: ['openFile'] });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  return { path: p, text: fs.readFileSync(p, 'utf8') };
});
ipcMain.handle('file:read', async (_e, p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
ipcMain.handle('file:save', async (_e, p, data) => {
  fs.writeFileSync(p, data, 'utf8');
  return p;
});
ipcMain.handle('file:save-as', async (_e, data, defaultName) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save Layout As',
    defaultPath: defaultName || 'kitchen-layout.json',
    filters: FILE_FILTERS
  });
  if (r.canceled || !r.filePath) return null;
  let p = r.filePath;
  if (!/\.json$/i.test(p)) p += '.json';
  fs.writeFileSync(p, data, 'utf8');
  return p;
});
ipcMain.handle('dialog:save-changes', async () => {
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: APP_NAME,
    message: 'Save changes to the current layout first?'
  });
  return r.response; // 0 save, 1 discard, 2 cancel
});
ipcMain.handle('app:startup-file', () => {
  const f = startupFile;
  startupFile = null;
  return f;
});
ipcMain.on('app:set-dirty', (_e, v) => { isDirty = !!v; });
ipcMain.on('app:set-title', (_e, t) => { if (win) win.setTitle(String(t)); });
ipcMain.on('app:close-now', () => { forceClose = true; if (win) win.close(); });

app.whenReady().then(() => {
  startupFile = fileFromArgs(process.argv);
  buildMenu();
  createSplash();
  createWindow();
});
app.on('window-all-closed', () => app.quit());

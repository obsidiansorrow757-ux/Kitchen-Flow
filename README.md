# KitchenFlow — desktop app

Electron wrapper around `app/index.html`. The HTML is unchanged except for one
`<script src="desktop-bridge.js">` line at the bottom, so you can keep editing it
the same way and it still runs in a browser.

## Layout
- `app/index.html` — the app (edit this like before)
- `app/desktop-bridge.js` — desktop-only extras: native Save / Save As / Open, unsaved-changes prompts, drag-and-drop open, menu
- `main.js` / `preload.js` — Electron window, menu, file dialogs
- `app/splash.html` + `app/kitchenflow-logo.png` — the intro screen shown while the app loads
- `build/icon.ico` — app icon
- `.github/workflows/build-windows.yml` — builds the Windows installer on GitHub

## Build on GitHub (recommended)
1. Create a new repo (e.g. `KitchenFlow`) and push this folder to `main`.
2. Actions tab → **Build Windows App** runs automatically.
3. Download the **KitchenFlow-Windows** artifact:
   - `KitchenFlow-Setup-1.0.0.exe` — installer (Start menu + desktop shortcut)
   - `KitchenFlow-Portable-1.0.0.exe` — single exe, no install

Bump `version` in `package.json` for each release.

## Build / run on your PC
```
npm install
npm start        # run it
npm run dist     # build the installer + portable exe into dist/
```

Windows SmartScreen will warn on first run because the exe isn't code-signed —
"More info → Run anyway".

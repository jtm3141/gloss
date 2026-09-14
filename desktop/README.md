# gloss desktop app

A native desktop window around the exact same files the website serves. There
is deliberately no second UI codebase: `npm run copy-web` copies the static
website build (`web/out`) into `desktop/web`, and the Electron shell loads it.
Same design on web and desktop is guaranteed structurally, not by discipline.

## Layout

```
desktop/
  main.js            Electron main process: opens one window on web/index.html
  scripts/
    copy-web.mjs     Copies web/out -> desktop/web (runs before every package)
  assets/
    icon.ico         Windows icon (icon.png wrapped; see below)
    icon.png         Source icon (also used for Linux builds later)
  web/               (gitignored) the copied static site
  release/           (gitignored) packaged installers
```

## Build the Windows installer

Prerequisites: Node 24+ and a built website (`npm run build` in `web/`).

```powershell
cd desktop
npm ci
npm run dist        # -> release/gloss Setup 0.1.0.exe (one-click NSIS installer)
```

`npm run pack` builds an unpacked directory instead (faster, for smoke-testing
the shell without making an installer). `npx electron smoke.cjs` loads the
packaged page from `file://` in a hidden window and verifies the dictionary
actually loads — run it after `copy-web`/`pack`/`dist`.

The installer is a per-user, one-click NSIS install: no admin rights needed,
Start Menu + Desktop shortcuts, standard Add/Remove Programs uninstall entry.

## How the app finds its data

The page loads `gloss.db.gz` and the sql.js WASM module with **relative**
URLs (`web/lib/db.ts`), so the identical bundle works from `https://` (the
website) and from `file://` (this shell). No server, no extra plumbing.

## Extending to other platforms

### macOS

The packaging config already declares the mac target (DMG, x64+arm64,
`public.app-category.reference`). From a Mac:

```sh
npm run copy-web && npx electron-builder --mac --publish never
```

Two things are still needed before distributing: an `assets/icon.icns`
(Convert the PNG: `sips`/`iconutil` on a Mac, or add it here later) and
signing/notarization — an Apple Developer account, `CSC_LINK`/`CSC_KEY_PASSWORD`
env vars, and `notarytool` credentials. Unsigned DMGs still install, but
Gatekeeper will warn. This is the only platform-specific work; the UI and
data layers are untouched.

### Linux

```sh
npm run copy-web && npx electron-builder --linux --publish never
```

Produces an AppImage (and deb/rpm targets are one config line each).
`assets/icon.png` is already the icon Linux needs. No code changes.

### A generic Python-based app (any OS with Python)

Two supported shapes, both reusing the same frontend files so the design
stays identical:

**A. pywebview shell (recommended, thinnest).** Install `pywebview`, point it
at the `web/out` directory (served over a local URL or loaded from disk),
and the existing page runs as-is — sql.js and the gzipped database already
live in the frontend, so Python ships zero data-layer code:

```python
import webview
webview.create_window("gloss", url="path/to/web/out/index.html")
webview.start()
```

Package with PyInstaller or briefcase for a double-clickable app.

**B. Python data backend.** For a fully native-Python stack, keep the
frontend and swap the data layer: `web/lib/db.ts` is the interface contract
(`loadDb`, `defineWord`, `suggest`, `dbMeta`). A Python shell (pywebview,
Eel, or Qt WebEngine) can expose the same four functions over its JS bridge
backed by the existing `gloss-dict` Python binding and the C core, with the
page calling the bridge instead of sql.js. The UI markup and CSS do not
change.

## Icon

`assets/icon.png` is the source. `assets/icon.ico` is generated from it by
wrapping the PNG in the ICO container (Windows accepts PNG-compressed ICO
entries):

```sh
node scripts/make-ico.mjs assets/icon.png assets/icon.ico
```

When adding macOS support, generate `assets/icon.icns` from the same PNG.

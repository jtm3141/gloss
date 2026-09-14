// gloss desktop shell (Electron main process).
//
// The entire UI is the static website build in ./web (copied from web/out
// by `npm run copy-web`). There is no second codebase: the desktop app and
// the website are the same files, so the design can never drift between
// them. The dictionary database ships inside ./web and is loaded by the
// page itself via sql.js, exactly as on the web.

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const WEB_DIR = path.join(__dirname, "web");

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    title: "gloss",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(WEB_DIR, "index.html"));

  // Footer links point at https:// — open those in the system browser
  // instead of navigating the dictionary window away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("https:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

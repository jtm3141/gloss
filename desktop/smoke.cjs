// Smoke test for the packaged desktop shell.
// Loads desktop/web/index.html from file:// in a hidden Electron window and
// waits for the page's own dictionary load to finish (the loading indicator
// disappears when loadDb() resolves). Fails if the page reports an error.
// Run: npx electron smoke.cjs   (after `npm run copy-web`)
const { app, BrowserWindow } = require("electron");
const path = require("path");

const WEB_INDEX = path.join(__dirname, "web", "index.html");
const TIMEOUT_MS = 120000;

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(WEB_INDEX);
  const start = Date.now();
  for (;;) {
    const state = await win.webContents.executeJavaScript(
      `(() => {
        const err = document.querySelector(".status.error");
        if (err) return "error:" + err.textContent;
        if (document.querySelector(".status")) return "loading";
        return document.querySelector(".wordmark") ? "ready" : "unknown";
      })()`
    );
    if (state === "ready") {
      console.log("ELECTRON SMOKE OK: page loaded the dictionary from file://");
      break;
    }
    if (state.startsWith("error")) {
      console.error("ELECTRON SMOKE FAIL:", state);
      process.exitCode = 1;
      break;
    }
    if (Date.now() - start > TIMEOUT_MS) {
      console.error("ELECTRON SMOKE FAIL: timed out in state", state);
      process.exitCode = 1;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  app.quit();
}

main().catch((e) => {
  console.error("ELECTRON SMOKE FAIL:", e.message);
  process.exitCode = 1;
  app.quit();
});

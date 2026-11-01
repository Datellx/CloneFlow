// Clone Flow desktop app (Mac and Windows) — the organization's Clone Flow in its own window: screen sharing,
// microphone and the "cloneflow://" links in invitations open here. The product itself runs on the Clone Flow website.
const { app, BrowserWindow, ipcMain, shell, Menu, session, desktopCapturer, net } = require("electron");
const fs = require("fs");
const path = require("path");

const CFG_FILE = () => path.join(app.getPath("userData"), "server.json");
const DEFAULT_SERVER = (() => { try { return require("./config.json").server; } catch { return "https://cloneflow.datellx.com"; } })();
let mainWindow = null;
let pendingPath = null;

function server() {
  try { return JSON.parse(fs.readFileSync(CFG_FILE(), "utf8")).server || DEFAULT_SERVER; } catch { return DEFAULT_SERVER; }
}
function setServer(url) {
  if (!/^https?:\/\//.test(url || "")) return false;
  fs.mkdirSync(path.dirname(CFG_FILE()), { recursive: true });
  fs.writeFileSync(CFG_FILE(), JSON.stringify({ server: url.replace(/\/+$/, "") }));
  return true;
}
function sameOrigin(url) {
  try { return new URL(url).origin === new URL(server()).origin; } catch { return false; }
}

async function reachable() {
  try {
    const r = await net.fetch(server() + "/api/system/status", { method: "GET" });
    return r.ok;
  } catch { return false; }
}

async function open(p = "/") {
  if (!mainWindow) createWindow();
  if (await reachable()) mainWindow.loadURL(server() + p);
  else mainWindow.loadFile(path.join(__dirname, "offline.html"));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360, height: 880, minWidth: 980, minHeight: 640, title: "Clone Flow", backgroundColor: "#fbf7f6",
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  // Links to other sites (Microsoft / Google / GitHub sign-in included) open in this window only when they come back
  // to the server; everything else goes to the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) { mainWindow.loadURL(url); return { action: "deny" }; }
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function fromDeepLink(url) {
  // cloneflow://join/<code>  →  <server>/join/<code>
  try {
    const u = new URL(url);
    const p = "/" + [u.host, u.pathname.replace(/^\/+/, "")].filter(Boolean).join("/");
    return p + (u.search || "");
  } catch { return "/"; }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" },
      { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }] },
    { role: "windowMenu" },
    { label: "Help", submenu: [
      { label: "Clone Flow website", click: () => shell.openExternal(server()) },
      { label: "Change server address…", click: () => mainWindow && mainWindow.loadFile(path.join(__dirname, "offline.html")) },
    ] },
  ]));
}

ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("app:server", () => server());
ipcMain.handle("app:set-server", (_e, url) => setServer(url));
ipcMain.handle("app:retry", () => open(pendingPath || "/login"));

app.setAsDefaultProtocolClient("cloneflow");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith("cloneflow://"));
    if (link) open(fromDeepLink(link));
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.on("open-url", (e, url) => { e.preventDefault(); pendingPath = fromDeepLink(url); if (app.isReady()) open(pendingPath); });
  app.whenReady().then(() => {
    app.setAboutPanelOptions({ applicationName: "Clone Flow", applicationVersion: app.getVersion(),
      copyright: "© 2026 Datellx LLC" });
    buildMenu();
    // "Show me on my screen": hand the page the screen the person is sharing (macOS shows its own picker when available).
    session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
        const screen = sources.find((s) => s.id.startsWith("screen:")) || sources[0];
        callback(screen ? { video: screen } : {});
      } catch { callback({}); }
    }, { useSystemPicker: true });
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(sameOrigin(wc.getURL()) && ["media", "display-capture", "clipboard-sanitized-write", "fullscreen", "notifications"].includes(permission));
    });
    createWindow();
    open(pendingPath || "/login");
  });
  app.on("activate", () => { if (!mainWindow) open("/"); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

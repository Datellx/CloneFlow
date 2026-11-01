const { contextBridge, ipcRenderer } = require("electron");
// A separate global from the old local-engine app (window.cloneflowDesktop), so the web app keeps behaving as the hosted product.
contextBridge.exposeInMainWorld("cloneflowApp", {
  isApp: true,
  platform: process.platform,
  version: () => ipcRenderer.invoke("app:version"),
  server: () => ipcRenderer.invoke("app:server"),
  setServer: (url) => ipcRenderer.invoke("app:set-server", url),
  retry: () => ipcRenderer.invoke("app:retry"),
});

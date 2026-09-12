const { contextBridge, ipcRenderer } = require('electron');

// Puente mínimo para el popup del ícono de la bandeja (ver trayMenu.html):
// solo necesita poder avisarle al proceso principal qué botón se apretó.
// Ventana aparte de la principal, así que tiene su propio preload en vez de
// reusar electron/preload.js (que expone muchísima más superficie que esto
// no necesita ni debería tener).
contextBridge.exposeInMainWorld('trayMenu', {
  action: (action) => ipcRenderer.send('trayMenu:action', action),
  dismiss: () => ipcRenderer.send('trayMenu:dismiss'),
});

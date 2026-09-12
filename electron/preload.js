const { contextBridge, ipcRenderer } = require('electron');

// Puente seguro entre el proceso principal (Node) y el renderer (React).
// El renderer NUNCA tiene acceso directo a Node/fs; todo pasa por aquí.
contextBridge.exposeInMainWorld('hardLauncher', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChanged: (cb) => {
      const listener = (_e, isMaximized) => cb(isMaximized);
      ipcRenderer.on('window:maximizedChanged', listener);
      return () => ipcRenderer.removeListener('window:maximizedChanged', listener);
    },
    // Disparado desde el popup del ícono de bandeja (ver electron/main.js,
    // trayMenu:action) cuando el usuario elige "Inicio" o "Instancias"
    // estando el launcher oculto: llega la ruta a la que navegar una vez
    // que la ventana ya está de vuelta al frente.
    onNavigate: (cb) => {
      const listener = (_e, route) => cb(route);
      ipcRenderer.on('nav:goto', listener);
      return () => ipcRenderer.removeListener('nav:goto', listener);
    },
    // Ídem para "Ajustes", que no es una ruta sino el modal de ajustes.
    onOpenSettings: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('nav:openSettings', listener);
      return () => ipcRenderer.removeListener('nav:openSettings', listener);
    },
  },
  auth: {
    createOffline: (username, skinUrl) => ipcRenderer.invoke('auth:createOffline', username, skinUrl),
    loginMicrosoft: () => ipcRenderer.invoke('auth:loginMicrosoft'),
    listAccounts: () => ipcRenderer.invoke('auth:listAccounts'),
    setActive: (id) => ipcRenderer.invoke('auth:setActive', id),
    removeAccount: (id) => ipcRenderer.invoke('auth:removeAccount', id),
    getActive: () => ipcRenderer.invoke('auth:getActive'),
    // Elegir un archivo .png de skin desde el disco: devuelve una data URL
    // lista para guardar como skinUrl (createOffline o updateSkin), o null
    // si el usuario canceló el selector.
    pickSkinFile: () => ipcRenderer.invoke('auth:pickSkinFile'),
    updateSkin: (accountId, skinUrl) => ipcRenderer.invoke('auth:updateSkin', accountId, skinUrl),
    // Caché persistente de caras/skins (ver src/auth/faceCache.js). Devuelve
    // lo que ya haya guardado en disco al instante; si hacía falta refrescar,
    // el resultado nuevo llega después por 'onFaceUpdated'.
    getFace: (accountId, remoteUrl) => ipcRenderer.invoke('auth:getFace', accountId, remoteUrl),
    onFaceUpdated: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('auth:faceUpdated', listener);
      return () => ipcRenderer.removeListener('auth:faceUpdated', listener);
    },
  },
  // Lista de servidores recomendados: fija, definida en código (ver
  // src/store/serverListStore.js). No hay add/remove acá a propósito — la
  // única forma de cambiar la lista es editando ese archivo.
  recommendedServers: {
    list: () => ipcRenderer.invoke('recommendedServers:list'),
    ping: (host, port) => ipcRenderer.invoke('recommendedServers:ping', host, port),
    // Esto sí modifica algo del lado del jugador (el servers.dat de cada
    // instancia ya creada) — a diferencia de list/ping, que solo leen.
    addToAllInstances: (serverId) => ipcRenderer.invoke('recommendedServers:addToAllInstances', serverId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (partial) => ipcRenderer.invoke('settings:update', partial),
    pickJavaExecutable: () => ipcRenderer.invoke('settings:pickJavaExecutable'),
  },
  system: {
    getTotalMemoryMB: () => ipcRenderer.invoke('system:getTotalMemoryMB'),
    getVersion: () => ipcRenderer.invoke('system:getVersion'),
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onEvent: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('updater:event', listener);
      return () => ipcRenderer.removeListener('updater:event', listener);
    },
  },
  storage: {
    info: () => ipcRenderer.invoke('storage:info'),
    openFolder: (folderPath) => ipcRenderer.invoke('storage:openFolder', folderPath),
  },
  instances: {
    list: () => ipcRenderer.invoke('instances:list'),
    create: (data) => ipcRenderer.invoke('instances:create', data),
    duplicate: (id) => ipcRenderer.invoke('instances:duplicate', id),
    update: (id, data) => ipcRenderer.invoke('instances:update', id, data),
    delete: (id) => ipcRenderer.invoke('instances:delete', id),
    repair: (id) => ipcRenderer.invoke('instances:repair', id),
    onRepairProgress: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on('instances:repairProgress', listener);
      return () => ipcRenderer.removeListener('instances:repairProgress', listener);
    },
    onRepairLog: (cb) => {
      const listener = (_e, line) => cb(line);
      ipcRenderer.on('instances:repairLog', listener);
      return () => ipcRenderer.removeListener('instances:repairLog', listener);
    },
    get: (id) => ipcRenderer.invoke('instances:get', id),
    getSize: (id) => ipcRenderer.invoke('instances:getSize', id),
    openFolder: (id) => ipcRenderer.invoke('instances:openFolder', id),
    listWorlds: (id) => ipcRenderer.invoke('instances:listWorlds', id),
    duplicateWorld: (id, worldPath) => ipcRenderer.invoke('instances:duplicateWorld', id, worldPath),
    renameWorld: (id, worldPath, newName) => ipcRenderer.invoke('instances:renameWorld', id, worldPath, newName),
    updateWorldSettings: (id, worldPath, changes) =>
      ipcRenderer.invoke('instances:updateWorldSettings', id, worldPath, changes),
    deleteWorld: (id, worldPath) => ipcRenderer.invoke('instances:deleteWorld', id, worldPath),
    openWorldFolder: (id, worldPath) => ipcRenderer.invoke('instances:openWorldFolder', id, worldPath),
    exportWorldForServer: (id, worldPath, worldName) =>
      ipcRenderer.invoke('instances:exportWorldForServer', id, worldPath, worldName),
    listScreenshots: (id) => ipcRenderer.invoke('instances:listScreenshots', id),
    deleteScreenshot: (id, filePath) => ipcRenderer.invoke('instances:deleteScreenshot', id, filePath),
    readImageAsDataUrl: (id, filePath) => ipcRenderer.invoke('instances:readImageAsDataUrl', id, filePath),
    addLocalFiles: (id) => ipcRenderer.invoke('instances:addLocalFiles', id),
    // Paso "Import instance" (Crear instancia): elegir la carpeta de otro
    // launcher, y luego importar todas las instancias que se detecten ahí.
    pickLauncherFolder: () => ipcRenderer.invoke('instances:pickLauncherFolder'),
    importFromLauncherPath: (launcherPath) => ipcRenderer.invoke('instances:importFromLauncherPath', launcherPath),
    onImportProgress: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on('instances:importProgress', listener);
      return () => ipcRenderer.removeListener('instances:importProgress', listener);
    },
  },
  versions: {
    list: () => ipcRenderer.invoke('versions:list'),
  },
  loaders: {
    list: (loader, mcVersion) => ipcRenderer.invoke('loaders:list', loader, mcVersion),
  },
  modrinth: {
    search: (params) => ipcRenderer.invoke('modrinth:search', params),
    project: (id) => ipcRenderer.invoke('modrinth:project', id),
    versions: (id, params) => ipcRenderer.invoke('modrinth:versions', id, params),
    categories: () => ipcRenderer.invoke('modrinth:categories'),
    loaders: () => ipcRenderer.invoke('modrinth:loaders'),
    gameVersions: () => ipcRenderer.invoke('modrinth:gameVersions'),
    installMod: (instanceId, versionData) => ipcRenderer.invoke('modrinth:installMod', instanceId, versionData),
    toggleContent: (instanceId, fileName, enabled) =>
      ipcRenderer.invoke('modrinth:toggleContent', instanceId, fileName, enabled),
    removeContent: (instanceId, fileName) => ipcRenderer.invoke('modrinth:removeContent', instanceId, fileName),
    installModpack: (mrpackPath, name) => ipcRenderer.invoke('modrinth:installModpack', mrpackPath, name),
    // Paso "Install modpack" (Crear instancia): instalar un modpack de
    // Modrinth elegido por búsqueda (sin archivo local), o elegir un
    // .mrpack ya descargado.
    installModpackFromVersion: (versionData, name) =>
      ipcRenderer.invoke('modrinth:installModpackFromVersion', versionData, name),
    pickMrpackFile: () => ipcRenderer.invoke('modrinth:pickMrpackFile'),
    // Cada "on*" devuelve una función de limpieza: el componente React que se
    // suscribe DEBE llamarla en su cleanup (return del useEffect), o cada vez
    // que el componente se remonte quedará otro listener duplicado escuchando
    // el mismo evento (efecto observado: la misma línea de log repetida N veces).
    onInstallProgress: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on('modrinth:installProgress', listener);
      return () => ipcRenderer.removeListener('modrinth:installProgress', listener);
    },
  },
  game: {
    // directConnect ({host, port}) es opcional: lo manda el botón "Jugar" de
    // un servidor recomendado (ver MinecraftServerList.jsx) para entrar
    // directo a ese server en vez de abrir el menú principal.
    launch: (instanceId, directConnect) => ipcRenderer.invoke('game:launch', instanceId, directConnect),
    // Cierra el proceso en curso de esa instancia y espera a que termine de
    // verdad (ver launcher.stopInstance) antes de resolver.
    stop: (instanceId) => ipcRenderer.invoke('game:stop', instanceId),
    onDownloadProgress: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on('game:downloadProgress', listener);
      return () => ipcRenderer.removeListener('game:downloadProgress', listener);
    },
    onLog: (cb) => {
      const listener = (_e, line) => cb(line);
      ipcRenderer.on('game:log', listener);
      return () => ipcRenderer.removeListener('game:log', listener);
    },
    onExit: (cb) => {
      const listener = (_e, code) => cb(code);
      ipcRenderer.on('game:exit', listener);
      return () => ipcRenderer.removeListener('game:exit', listener);
    },
  },
});

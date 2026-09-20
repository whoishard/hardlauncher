const { contextBridge, ipcRenderer } = require('electron');

// Puente seguro entre el proceso principal (Node) y el renderer (React).
// El renderer NUNCA tiene acceso directo a Node/fs; todo pasa por aquí.
contextBridge.exposeInMainWorld('hardLauncher', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    // Cierra la ventana con la cruz de la barra de título propia: ya NO
    // sale del launcher, lo manda a la bandeja (ver mainWindow.on('close',
    // ...) en electron/main.js). Para salir de verdad (ej. "Rechazar y
    // salir" de los Términos y Condiciones) está quit() más abajo.
    close: () => ipcRenderer.invoke('window:close'),
    // Cierra el launcher DE VERDAD, sin pasar por la bandeja — a diferencia
    // de close() de arriba. Lo usa, por ejemplo, TermsModal.jsx cuando el
    // usuario rechaza los Términos: ahí sí tiene que terminar el proceso,
    // no quedar corriendo escondido sin que nadie los haya aceptado.
    quit: () => ipcRenderer.invoke('app:quit'),
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
    // Avisa cuando game:launch tuvo que refrescar solo el token de una
    // cuenta premium antes de jugar (ver electron/main.js) — el store lo
    // usa para releer las cuentas y que el estado en memoria (username,
    // vencimiento, etc.) no quede desactualizado hasta el próximo reinicio.
    onAccountsChanged: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('auth:accountsChanged', listener);
      return () => ipcRenderer.removeListener('auth:accountsChanged', listener);
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
  // Contador global de "jugadores en línea" (ver src/core/onlinePresence.js).
  // get() sirve para pintar un valor apenas monta el componente, sin
  // esperar al primer 'onUpdate'; después de eso, onUpdate ya cubre
  // cualquier cambio en tiempo real por el resto de la sesión.
  onlinePlayers: {
    get: () => ipcRenderer.invoke('onlinePlayers:get'),
    onUpdate: (cb) => {
      const listener = (_e, count) => cb(count);
      ipcRenderer.on('onlinePlayers:update', listener);
      return () => ipcRenderer.removeListener('onlinePlayers:update', listener);
    },
    // "Tu ping" del badge de Inicio (ver src/core/onlinePresence.js): la
    // latencia de este launcher contra el mismo servicio que alimenta el
    // contador de arriba, no el ping a ningún server de Minecraft.
    getPing: () => ipcRenderer.invoke('onlinePlayers:getPing'),
    onPingUpdate: (cb) => {
      const listener = (_e, ping) => cb(ping);
      ipcRenderer.on('onlinePlayers:pingUpdate', listener);
      return () => ipcRenderer.removeListener('onlinePlayers:pingUpdate', listener);
    },
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
    getSafeMode: () => ipcRenderer.invoke('app:getSafeMode'),
    setSafeMode: (value) => ipcRenderer.invoke('app:setSafeMode', value),
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
    reorder: (orderedIds) => ipcRenderer.invoke('instances:reorder', orderedIds),
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
    showScreenshotInFolder: (id, filePath) => ipcRenderer.invoke('instances:showScreenshotInFolder', id, filePath),
    readImageAsDataUrl: (id, filePath) => ipcRenderer.invoke('instances:readImageAsDataUrl', id, filePath),
    addLocalFiles: (id, contentType) => ipcRenderer.invoke('instances:addLocalFiles', id, contentType),
    // Pestaña "Archivos": explorador integrado de la carpeta de la instancia.
    // `relativePath` siempre viaja como ruta relativa con '/' (raíz = '' o '.').
    listFiles: (id, relativePath) => ipcRenderer.invoke('instances:listFiles', id, relativePath),
    createFolder: (id, relativePath, name) => ipcRenderer.invoke('instances:createFolder', id, relativePath, name),
    renamePath: (id, relativePath, newName) => ipcRenderer.invoke('instances:renamePath', id, relativePath, newName),
    deletePaths: (id, relativePaths) => ipcRenderer.invoke('instances:deletePaths', id, relativePaths),
    revealPath: (id, relativePath) => ipcRenderer.invoke('instances:revealPath', id, relativePath),
    openPath: (id, relativePath) => ipcRenderer.invoke('instances:openPath', id, relativePath),
    readTextFile: (id, relativePath) => ipcRenderer.invoke('instances:readTextFile', id, relativePath),
    writeTextFile: (id, relativePath, content) => ipcRenderer.invoke('instances:writeTextFile', id, relativePath, content),
    importFiles: (id, relativePath) => ipcRenderer.invoke('instances:importFiles', id, relativePath),
    importFilesFromPaths: (id, relativePath, filePaths) =>
      ipcRenderer.invoke('instances:importFilesFromPaths', id, relativePath, filePaths),
    // Ajustes de instancia → Instalación → "Actualizar versión": primero
    // se pide el plan de compatibilidad (qué se actualiza solo, qué no
    // tiene versión compatible, qué no se puede comprobar por ser
    // contenido agregado a mano) y recién después, con la decisión del
    // usuario ya confirmada, se aplica de verdad.
    checkVersionUpdate: (id, target) => ipcRenderer.invoke('instances:checkVersionUpdate', id, target),
    applyVersionUpdate: (id, target, decision) =>
      ipcRenderer.invoke('instances:applyVersionUpdate', id, target, decision),
    onVersionUpdateProgress: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on('instances:versionUpdateProgress', listener);
      return () => ipcRenderer.removeListener('instances:versionUpdateProgress', listener);
    },
    // Paso "Import instance" (Crear instancia): primero se revisa sola qué
    // launchers compatibles están instalados y qué instancias tiene cada
    // uno; opcionalmente se puede agregar además alguna otra carpeta a
    // mano; y por último se importan solo las instancias puntuales que el
    // usuario haya tildado.
    detectLaunchers: () => ipcRenderer.invoke('instances:detectLaunchers'),
    pickLauncherFolder: () => ipcRenderer.invoke('instances:pickLauncherFolder'),
    scanLauncherFolder: (folderPath) => ipcRenderer.invoke('instances:scanLauncherFolder', folderPath),
    importSelected: (instanceDirs) => ipcRenderer.invoke('instances:importSelected', instanceDirs),
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
    refreshContentMeta: (instanceId) => ipcRenderer.invoke('modrinth:refreshContentMeta', instanceId),
    updateContent: (instanceId, fileName) => ipcRenderer.invoke('modrinth:updateContent', instanceId, fileName),
    changeContentVersion: (instanceId, fileName, versionId) =>
      ipcRenderer.invoke('modrinth:changeContentVersion', instanceId, fileName, versionId),
    updateAllContent: (instanceId) => ipcRenderer.invoke('modrinth:updateAllContent', instanceId),
    toggleContentFreeze: (instanceId, fileName, frozen) =>
      ipcRenderer.invoke('modrinth:toggleContentFreeze', instanceId, fileName, frozen),
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
    // quickPlaySingleplayer (nombre de carpeta del mundo) es opcional
    // también, y es el mismo mecanismo pero para el botón "Jugar" de un
    // mundo puntual en la pestaña "Mundos" (ver InstanceDetailView.jsx).
    launch: (instanceId, directConnect, quickPlaySingleplayer) =>
      ipcRenderer.invoke('game:launch', instanceId, directConnect, quickPlaySingleplayer),
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

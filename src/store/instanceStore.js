const Store = require('electron-store');
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const settingsStore = require('./settingsStore');
const serverListStore = require('./serverListStore');
const { buildServersDat, addServerToDat } = require('../core/nbtWriter');
const { readLevelInfo, writeLevelInfo } = require('../core/worldNbt');

const store = new Store({ name: 'instances' });

function getInstancesRoot() {
  const root = path.join(app.getPath('userData'), 'instances');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function listInstances() {
  return store.get('instances', []);
}

function getInstance(id) {
  return listInstances().find((i) => i.id === id) || null;
}

/** Calcula el tamaño en disco (bytes) de cualquier carpeta, recorriéndola
 * entera. Compartido por getInstanceSize (carpeta de la instancia) y las
 * funciones de mundos de abajo (carpeta de un mundo puntual dentro de
 * /saves). Mismo algoritmo que storageInfo.folderSize, pero vive acá para no
 * crear una dependencia circular (storageInfo ya depende de instanceStore). */
function getFolderSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* archivo removido entre el listado y el stat, se ignora */
        }
      }
    }
  }
  return total;
}

function getInstanceSize(id) {
  const instance = getInstance(id);
  if (!instance) return 0;
  return getFolderSize(instance.dir);
}

/**
 * data: {
 *   name, icon, mcVersion, versionType ('release'|'snapshot'),
 *   loader ('vanilla'|'fabric'|'forge'|'neoforge'|'quilt'), loaderVersion,
 *   memoryMin, memoryMax, jvmArgs, resolutionWidth, resolutionHeight
 * }
 */
function createInstance(data) {
  const id = uuidv4();
  const dir = path.join(getInstancesRoot(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'resourcepacks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shaderpacks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'datapacks'), { recursive: true });

  // Se precarga la lista de "servidores recomendados" (ver
  // src/store/serverListStore.js) en la lista de Multijugador de la
  // instancia apenas se crea, mismo mecanismo que usa el juego real
  // (servers.dat) — así ya aparecen ahí sin que el jugador tenga que
  // agregarlos a mano. Solo pasa una vez, al crear: si el jugador después
  // borra alguno desde el juego, no se lo vuelve a agregar solo.
  try {
    const recommended = serverListStore.listServers();
    if (recommended.length > 0) {
      fs.writeFileSync(path.join(dir, 'servers.dat'), buildServersDat(recommended));
    }
  } catch (err) {
    console.error('No se pudo precargar servers.dat en la instancia nueva:', err);
  }

  const defaults = settingsStore.getSettings();
  const instance = {
    id,
    name: data.name || 'Nueva Instancia',
    icon: data.icon || null,
    mcVersion: data.mcVersion,
    versionType: data.versionType || 'release',
    loader: data.loader || 'vanilla',
    loaderVersion: data.loaderVersion || null,
    memoryMin: data.memoryMin || defaults.defaultMemoryMin,
    memoryMax: data.memoryMax || defaults.defaultMemoryMax,
    jvmArgs: data.jvmArgs || defaults.defaultJvmArgs || '',
    resolutionWidth: data.resolutionWidth || defaults.defaultResolutionWidth,
    resolutionHeight: data.resolutionHeight || defaults.defaultResolutionHeight,

    // --- Ajustes avanzados por instancia (pantalla "Ajustes de la
    // instancia", inspirada en el panel de Modrinth App). Cada "customX"
    // controla si esta instancia pisa el valor global de Ajustes → Valores
    // por defecto, o si sigue heredándolo — igual que "Custom Java
    // installation" / "Custom memory allocation" / etc. en Modrinth. ---
    customWindow: false,
    fullscreen: !!defaults.defaultFullscreen,
    customJava: false,
    javaPath: null,
    customMemory: false,

    // Los cuatro campos de abajo heredan el "valor por defecto" global de
    // Ajustes → Valores por defecto (ver settingsStore) apenas se crea la
    // instancia — mismo comportamiento que los "global overrides" de
    // Modrinth App: si el jugador dejó algo cargado ahí, las instancias
    // nuevas arrancan ya usándolo (con el toggle "custom" prendido para que
    // launcher.js lo aplique), y pueden pisarlo después a mano desde el
    // panel de Ajustes de la propia instancia sin afectar el valor global.
    customJvmArgs: !!defaults.defaultJvmArgs,
    customEnvVars: !!defaults.defaultEnvVars,
    envVars: defaults.defaultEnvVars || '',
    customHooks: !!(defaults.defaultPreLaunchHook || defaults.defaultWrapperHook || defaults.defaultPostExitHook),
    preLaunchHook: defaults.defaultPreLaunchHook || '',
    wrapperHook: defaults.defaultWrapperHook || '',
    postExitHook: defaults.defaultPostExitHook || '',

    content: [], // mods/resourcepacks/shaders instalados: { fileName, type, projectId, versionId, enabled }
    createdAt: Date.now(),
    lastPlayed: null,
    totalPlaytime: 0, // ms jugados acumulados en esta instancia
    dir,
  };

  const instances = listInstances();
  instances.push(instance);
  store.set('instances', instances);
  return instance;
}

/**
 * Agrega un servidor (de la lista de "servidores recomendados", ver
 * src/store/serverListStore.js) al servers.dat de TODAS las instancias que
 * ya existen — a diferencia del precargado de createInstance (que solo pasa
 * una vez, al crear), esto es para el botón "Agregar a todas las
 * instancias" de un servidor recomendado en Inicio: sirve para sumarlo a
 * instancias viejas que ya existían antes de que ese servidor se agregara
 * a la lista fija, sin tener que borrarlas y crearlas de nuevo.
 *
 * No pisa el servers.dat entero: se lee el de cada instancia (si tiene) y
 * se le agrega la entrada nueva de forma aditiva (ver addServerToDat), así
 * que cualquier servidor que el jugador haya agregado a mano queda intacto.
 * Si el servidor ya estaba ahí (mismo host:port), esa instancia se cuenta
 * como "ya lo tenía" en vez de agregarse de nuevo.
 */
function addServerToAllInstances(server) {
  const instances = listInstances();
  let added = 0;
  let alreadyPresent = 0;
  let failed = 0;

  for (const instance of instances) {
    try {
      if (!fs.existsSync(instance.dir)) fs.mkdirSync(instance.dir, { recursive: true });
      const datPath = path.join(instance.dir, 'servers.dat');
      const existing = fs.existsSync(datPath) ? fs.readFileSync(datPath) : null;
      const result = addServerToDat(existing, server);
      fs.writeFileSync(datPath, result.buffer);
      if (result.added) added += 1;
      else alreadyPresent += 1;
    } catch (err) {
      console.error(`No se pudo agregar el servidor a la instancia ${instance.id}:`, err);
      failed += 1;
    }
  }

  return { total: instances.length, added, alreadyPresent, failed };
}

/**
 * Duplica una instancia completa: carpeta en disco (mundos, configs, mods,
 * etc.) + su entrada en el store, con un id y un directorio nuevos. Refleja
 * el botón "Duplicate" de Ajustes → General en Modrinth App.
 */
function duplicateInstance(id) {
  const source = getInstance(id);
  if (!source) throw new Error('Instancia no encontrada.');

  const newId = uuidv4();
  const newDir = path.join(getInstancesRoot(), newId);
  if (fs.existsSync(source.dir)) {
    fs.cpSync(source.dir, newDir, { recursive: true });
  } else {
    fs.mkdirSync(newDir, { recursive: true });
  }

  const duplicate = {
    ...source,
    id: newId,
    dir: newDir,
    name: `${source.name} (copia)`,
    createdAt: Date.now(),
    lastPlayed: null,
    totalPlaytime: 0,
  };

  const instances = listInstances();
  instances.push(duplicate);
  store.set('instances', instances);
  return duplicate;
}

function updateInstance(id, data) {
  const instances = listInstances();
  const idx = instances.findIndex((i) => i.id === id);
  if (idx === -1) throw new Error('Instancia no encontrada.');
  instances[idx] = { ...instances[idx], ...data };
  store.set('instances', instances);
  return instances[idx];
}

function deleteInstance(id) {
  const instance = getInstance(id);
  // El registro se quita del store PRIMERO: la carpeta de una instancia
  // puede pesar varios GB (assets, mods, mundos) y con fs.rmSync (síncrono)
  // el borrado bloqueaba el proceso principal entero mientras duraba,
  // congelando toda la UI del launcher hasta terminar. Separar ambos pasos
  // — y usar fs.rm asíncrono para el borrado real en disco — permite que
  // esta función (y el IPC que la llama) resuelva al instante; el disco se
  // limpia solo, en segundo plano.
  const instances = listInstances().filter((i) => i.id !== id);
  store.set('instances', instances);
  if (instance && fs.existsSync(instance.dir)) {
    fs.rm(instance.dir, { recursive: true, force: true }, (err) => {
      if (err) console.error(`No se pudo borrar la carpeta de la instancia ${id}:`, err);
    });
  }
  return true;
}

/** Abre la carpeta de la instancia en el explorador de archivos del sistema. */
function openInstanceFolder(id) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  return shell.openPath(instance.dir);
}

function getSavesDir(instance) {
  return path.join(instance.dir, 'saves');
}

/**
 * Arma la ficha completa de un mundo puntual (carpeta dentro de /saves):
 * miniatura (icon.png del propio mundo, si el jugador la generó jugando),
 * peso en disco, si tiene datos separados del Nether (carpeta DIM-1) y/o
 * del End (carpeta DIM1), y lo que se pueda leer de su level.dat (nombre
 * "de verdad", modo de juego, dificultad, hardcore, semilla). Nada de esto
 * es indispensable para listar mundos, así que level.dat e icon.png se leen
 * con su propio try/catch: un mundo con esos archivos rotos o ausentes
 * igual aparece en la lista, solo que con menos detalle.
 */
function buildWorldEntry(instance, worldDir, folderName) {
  const worldPath = path.join(worldDir, folderName);
  const stat = fs.statSync(worldPath);

  let icon = null;
  const iconPath = path.join(worldPath, 'icon.png');
  if (fs.existsSync(iconPath)) {
    try {
      icon = `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`;
    } catch {
      icon = null;
    }
  }

  let info = null;
  const levelDatPath = path.join(worldPath, 'level.dat');
  if (fs.existsSync(levelDatPath)) {
    try {
      info = readLevelInfo(levelDatPath).info;
    } catch {
      info = null;
    }
  }

  return {
    name: folderName,
    displayName: (info && info.levelName) || folderName,
    path: worldPath,
    lastModified: stat.mtimeMs,
    size: getFolderSize(worldPath),
    icon,
    hasNether: fs.existsSync(path.join(worldPath, 'DIM-1')),
    hasEnd: fs.existsSync(path.join(worldPath, 'DIM1')),
    info,
  };
}

/** Lista los mundos guardados (carpeta /saves) de una instancia, con
 * miniatura, peso y detalle de cada uno (ver buildWorldEntry). */
function listWorlds(id) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const savesDir = getSavesDir(instance);
  if (!fs.existsSync(savesDir)) return [];
  return fs
    .readdirSync(savesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => buildWorldEntry(instance, savesDir, e.name))
    .sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * Verifica que `worldPath` sea realmente la carpeta de un mundo de esta
 * instancia (hijo directo de su /saves) antes de operar sobre él — mismo
 * espíritu que la restricción de readImageAsDataUrl/deleteScreenshot, pero
 * más estricta todavía (no alcanza con "estar dentro de la carpeta de la
 * instancia": tiene que ser justo un mundo de /saves, ni un padre ni un
 * archivo suelto ni una subcarpeta de otro mundo como DIM-1). Devuelve la
 * instancia y el nombre de carpeta del mundo ya validados.
 */
function resolveWorld(instanceId, worldPath) {
  const instance = getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const savesDir = getSavesDir(instance);
  const resolved = path.resolve(worldPath);
  const resolvedSaves = path.resolve(savesDir);
  if (path.dirname(resolved) !== resolvedSaves) {
    throw new Error('Ruta de mundo inválida.');
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('El mundo ya no existe en disco.');
  }
  return { instance, savesDir, worldPath: resolved, folderName: path.basename(resolved) };
}

/** Nombre de carpeta libre dentro de /saves a partir de un nombre base
 * (agrega " (2)", " (3)"... hasta encontrar uno que no exista todavía). */
function freeWorldFolderName(savesDir, baseName) {
  let candidate = baseName;
  let n = 2;
  while (fs.existsSync(path.join(savesDir, candidate))) {
    candidate = `${baseName} (${n})`;
    n += 1;
  }
  return candidate;
}

/** Duplica un mundo entero (carpeta /saves/<nombre>, incluyendo Nether/End
 * si los tiene) con un nombre nuevo, y también actualiza el "LevelName" de
 * su copia del level.dat para que el juego muestre el nombre nuevo en el
 * menú "Un jugador" en vez de seguir mostrando el del original. */
function duplicateWorld(instanceId, worldPath) {
  const { savesDir, folderName, worldPath: resolved } = resolveWorld(instanceId, worldPath);
  const newFolderName = freeWorldFolderName(savesDir, `${folderName} (copia)`);
  const newWorldPath = path.join(savesDir, newFolderName);
  fs.cpSync(resolved, newWorldPath, { recursive: true });

  const levelDatPath = path.join(newWorldPath, 'level.dat');
  if (fs.existsSync(levelDatPath)) {
    try {
      const { root, info } = readLevelInfo(levelDatPath);
      writeLevelInfo(levelDatPath, root, { levelName: `${info.levelName || folderName} (copia)` });
    } catch {
      /* si el level.dat no se pudo reescribir, la copia queda igual pero
       * con el nombre de carpeta nuevo, que ya es suficiente para distinguirla */
    }
  }

  const instance = getInstance(instanceId);
  return buildWorldEntry(instance, savesDir, newFolderName);
}

/** Renombra un mundo: carpeta en disco + el "LevelName" dentro de su
 * level.dat, para que el nombre nuevo se vea también dentro del juego. */
function renameWorld(instanceId, worldPath, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) throw new Error('El nombre no puede estar vacío.');
  // Los caracteres de abajo no son válidos en nombres de carpeta en
  // Windows; se reemplazan por "_" para que el rename nunca falle por eso.
  const safeFolderName = trimmed.replace(/[\\/:*?"<>|]/g, '_');

  const { savesDir, folderName, worldPath: resolved } = resolveWorld(instanceId, worldPath);
  let finalWorldPath = resolved;
  if (safeFolderName !== folderName) {
    const targetFolderName = freeWorldFolderName(savesDir, safeFolderName);
    finalWorldPath = path.join(savesDir, targetFolderName);
    fs.renameSync(resolved, finalWorldPath);
  }

  const levelDatPath = path.join(finalWorldPath, 'level.dat');
  if (fs.existsSync(levelDatPath)) {
    try {
      const { root } = readLevelInfo(levelDatPath);
      writeLevelInfo(levelDatPath, root, { levelName: trimmed });
    } catch {
      /* no se pudo reescribir level.dat: el mundo queda con la carpeta ya
       * renombrada igual, que es el cambio que más importa acá */
    }
  }

  const instance = getInstance(instanceId);
  return buildWorldEntry(instance, savesDir, path.basename(finalWorldPath));
}

/** Aplica cambios de configuración (modo de juego, dificultad, hardcore,
 * trucos/cheats) al level.dat de un mundo. */
function updateWorldSettings(instanceId, worldPath, changes) {
  const { savesDir, folderName, worldPath: resolved } = resolveWorld(instanceId, worldPath);
  const levelDatPath = path.join(resolved, 'level.dat');
  if (!fs.existsSync(levelDatPath)) {
    throw new Error('Este mundo no tiene un level.dat legible.');
  }
  const { root } = readLevelInfo(levelDatPath);
  writeLevelInfo(levelDatPath, root, changes);

  const instance = getInstance(instanceId);
  return buildWorldEntry(instance, savesDir, folderName);
}

/** Borra un mundo entero de disco (carpeta /saves/<nombre>). */
function deleteWorld(instanceId, worldPath) {
  const { worldPath: resolved } = resolveWorld(instanceId, worldPath);
  fs.rmSync(resolved, { recursive: true, force: true });
  return true;
}

/** Abre la carpeta de un mundo puntual en el explorador de archivos. */
function openWorldFolder(instanceId, worldPath) {
  const { worldPath: resolved } = resolveWorld(instanceId, worldPath);
  return shell.openPath(resolved);
}

/**
 * Empaqueta un mundo en un .zip listo para subir a un servidor Java vanilla
 * (o Paper/Spigot/Forge, que usan la misma estructura): tres carpetas
 * separadas en la raíz del zip — "world" (overworld), "world_nether" y
 * "world_the_end" — que es justo como cualquier server.jar espera
 * encontrarlas según level-name/EOF en server.properties. El mundo en el
 * launcher, en cambio, guarda las tres dimensiones juntas en una sola
 * carpeta (la del cliente: overworld en la raíz, Nether en DIM-1, End en
 * DIM1 dentro de esa misma carpeta) — por eso hay que separarlas acá:
 *   - Todo lo que NO es DIM-1/DIM1 -> "world/"
 *   - DIM-1/*                      -> "world_nether/DIM-1/"
 *   - DIM1/*                       -> "world_the_end/DIM1/"
 * (el server también espera el propio "DIM-1"/"DIM1" anidado adentro de
 * world_nether/world_the_end, no sus contenidos sueltos en la raíz).
 */
function exportWorldForServer(instanceId, worldPath, destZipPath) {
  const { worldPath: resolved } = resolveWorld(instanceId, worldPath);
  const zip = new AdmZip();

  const netherDir = path.join(resolved, 'DIM-1');
  const endDir = path.join(resolved, 'DIM1');

  const topEntries = fs.readdirSync(resolved, { withFileTypes: true });
  for (const entry of topEntries) {
    if (entry.name === 'DIM-1' || entry.name === 'DIM1' || entry.name === 'session.lock') continue;
    const fullPath = path.join(resolved, entry.name);
    if (entry.isDirectory()) {
      zip.addLocalFolder(fullPath, path.posix.join('world', entry.name));
    } else {
      zip.addLocalFile(fullPath, 'world');
    }
  }

  if (fs.existsSync(netherDir)) {
    zip.addLocalFolder(netherDir, 'world_nether/DIM-1');
  }
  if (fs.existsSync(endDir)) {
    zip.addLocalFolder(endDir, 'world_the_end/DIM1');
  }

  zip.writeZip(destZipPath);
  const size = fs.statSync(destZipPath).size;
  return { path: destZipPath, size };
}

/** Lista las capturas de pantalla (carpeta /screenshots) de una instancia. */
function listScreenshots(id) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const dir = path.join(instance.dir, 'screenshots');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
    .map((f) => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      return { name: f, path: filePath, lastModified: stat.mtimeMs };
    })
    .sort((a, b) => b.lastModified - a.lastModified);
}

/** Elimina una captura de pantalla puntual. Misma restricción de ruta que readImageAsDataUrl. */
function deleteScreenshot(instanceId, filePath) {
  const instance = getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(instance.dir))) {
    throw new Error('Ruta fuera de la carpeta de la instancia.');
  }
  if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
  return true;
}

/**
 * Lee un archivo como data URL para mostrarlo en <img>. Se restringe a rutas
 * dentro de la carpeta de la instancia para evitar que se use para leer
 * archivos arbitrarios del sistema.
 */
function readImageAsDataUrl(instanceId, filePath) {
  const instance = getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(instance.dir))) {
    throw new Error('Ruta fuera de la carpeta de la instancia.');
  }
  const ext = path.extname(resolved).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  const buffer = fs.readFileSync(resolved);
  return `data:image/${mime};base64,${buffer.toString('base64')}`;
}

module.exports = {
  getInstancesRoot,
  listInstances,
  getInstance,
  createInstance,
  addServerToAllInstances,
  duplicateInstance,
  updateInstance,
  deleteInstance,
  getInstanceSize,
  openInstanceFolder,
  listWorlds,
  duplicateWorld,
  renameWorld,
  updateWorldSettings,
  deleteWorld,
  openWorldFolder,
  exportWorldForServer,
  listScreenshots,
  deleteScreenshot,
  readImageAsDataUrl,
};

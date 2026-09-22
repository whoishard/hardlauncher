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
const { randomInstanceIcon } = require('../core/randomInstanceIcon');
const { getConfigDir, uniqueInstanceDir } = require('../shared/paths');

// El .json de electron-store vive en <userData>/config junto con el resto
// de la configuración interna (ver src/shared/paths.js) — no en la raíz
// de userData, para no sumar otro archivo suelto ahí.
const store = new Store({ name: 'instances', cwd: getConfigDir() });

function getInstancesRoot() {
  const root = path.join(app.getPath('userData'), 'instances');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Migración liviana para instancias creadas antes de este cambio, cuya
 * carpeta en disco es directamente su id (un uuid ilegible, ej.
 * "3fa8e2c1-...") en vez de un nombre reconocible. Se corre una sola vez
 * al arrancar (ver electron/main.js): por cada instancia vieja, renombra
 * su carpeta a un nombre distinguible y actualiza el "dir" guardado.
 *
 * Es best-effort a propósito: si falla el rename de alguna (carpeta en
 * uso, permisos, etc.) esa instancia sigue funcionando igual con su
 * carpeta uuid de siempre, no se rompe nada — simplemente no queda tan
 * prolija hasta el próximo arranque.
 */
function migrateLegacyInstanceFolders() {
  const root = getInstancesRoot();
  const instances = listInstances();
  let changed = false;

  for (const instance of instances) {
    const currentBase = path.basename(instance.dir || '');
    // Si la carpeta actual ya coincide con el id, es el esquema viejo.
    if (currentBase !== instance.id) continue;
    if (!fs.existsSync(instance.dir)) continue;

    try {
      const newDir = uniqueInstanceDir(root, instance.name);
      fs.renameSync(instance.dir, newDir);
      instance.dir = newDir;
      changed = true;
    } catch (err) {
      console.error(`No se pudo renombrar la carpeta de la instancia "${instance.name}":`, err);
    }
  }

  if (changed) store.set('instances', instances);
}

function listInstances() {
  return store.get('instances', []);
}

function getInstance(id) {
  return listInstances().find((i) => i.id === id) || null;
}

/**
 * Calcula el tamaño en disco (bytes) de cualquier carpeta, recorriéndola
 * entera. Compartido por getInstanceSize (carpeta de la instancia, que
 * puede tener varios GB entre libraries/assets/mods) y las funciones de
 * mundos de abajo (carpeta de un mundo puntual dentro de /saves).
 *
 * PERF FIX: la versión anterior usaba fs.readdirSync/statSync — 100%
 * síncrono — recorriendo la carpeta entera de un tirón. El proceso
 * principal de Electron es de un solo hilo de JS y ES COMPARTIDO por TODA
 * la app: mientras ese recorrido corría (varios segundos en una instancia
 * grande, y peor todavía con varias instancias mostrándose a la vez en
 * "Instancias", cada una disparando su propio getInstanceSize apenas
 * monta su tarjeta), ningún otro ipcMain.handle podía avanzar — ni
 * siquiera los que no tienen nada que ver con esto, como terminar de
 * resolver una búsqueda de Modrinth que ya había vuelto de la red y solo
 * esperaba su turno en el mismo hilo para que el .then() corriera. Eso es
 * lo que se sentía como "el Explorador tarda mucho / se traba al cambiar
 * de pestaña": no era un bug del Explorador en sí, era el proceso
 * principal entero congelado por este recorrido de disco.
 *
 * La solución real es no bloquear ese hilo por tanto tiempo seguido:
 *  1) fs.promises en vez de las versiones *Sync, para no atar el hilo de
 *     JS mientras el kernel resuelve cada operación de disco.
 *  2) Además, se cede el control explícitamente (setImmediate) cada
 *     cierta cantidad de entradas procesadas — sin esto, un directorio
 *     con miles de archivos (el propio /libraries de una instancia,
 *     región por región de un mundo grande) igual podría acaparar el
 *     hilo entre awaits si todas las entradas de una carpeta se procesan
 *     en el mismo tick.
 *  3) Caché con TTL corto + deduplicación de pedidos en vuelo (mismo
 *     patrón que src/api/modrinthApi.js): navegar de ida y vuelta entre
 *     "Instancias" y otra pantalla, o abrir/cerrar la pestaña de Mundos
 *     varias veces seguidas, no dispara un recorrido de disco nuevo cada
 *     vez si el anterior es reciente.
 */
const FOLDER_SIZE_CACHE_TTL_MS = 15000;
const folderSizeCache = new Map(); // dir -> { size, at }
const folderSizeInFlight = new Map(); // dir -> Promise en vuelo

const YIELD_EVERY_ENTRIES = 200;
function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function computeFolderSizeUncached(dir) {
  let total = 0;
  let processed = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          const stat = await fs.promises.stat(full);
          total += stat.size;
        } catch {
          /* archivo removido entre el listado y el stat, se ignora */
        }
      }
      processed += 1;
      if (processed % YIELD_EVERY_ENTRIES === 0) await yieldToEventLoop();
    }
  }
  return total;
}

/** Versión con caché+deduplicación de computeFolderSizeUncached — usar esta
 * en vez de la de arriba en cualquier código nuevo. */
async function getFolderSizeAsync(dir) {
  if (!fs.existsSync(dir)) return 0;
  const cached = folderSizeCache.get(dir);
  if (cached && Date.now() - cached.at < FOLDER_SIZE_CACHE_TTL_MS) return cached.size;
  if (folderSizeInFlight.has(dir)) return folderSizeInFlight.get(dir);

  const p = computeFolderSizeUncached(dir)
    .then((size) => {
      folderSizeCache.set(dir, { size, at: Date.now() });
      folderSizeInFlight.delete(dir);
      return size;
    })
    .catch((e) => {
      folderSizeInFlight.delete(dir);
      throw e;
    });
  folderSizeInFlight.set(dir, p);
  return p;
}

async function getInstanceSize(id) {
  const instance = getInstance(id);
  if (!instance) return 0;
  return getFolderSizeAsync(instance.dir);
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
  // La carpeta en disco se nombra según el nombre de la instancia (no el
  // id) para que sea reconocible a simple vista si alguien entra a
  // instances/ desde el explorador de archivos — el id sigue siendo la
  // clave interna real, así que renombrar la instancia después no rompe
  // nada (la carpeta ya creada no se toca sola).
  const dir = uniqueInstanceDir(getInstancesRoot(), data.name || 'Nueva Instancia');
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
    icon: data.icon || randomInstanceIcon(),
    // Ícono "de fábrica" del modpack con el que se creó esta instancia (si
    // se creó así) — se guarda aparte de `icon` y nunca se pisa, aunque el
    // jugador después personalice el ícono a mano. Sirve para que "Quitar
    // ícono" en el Estudio pueda volver a este en vez de generar uno al
    // azar (ver IconStudioModal.jsx).
    modpackIcon: data.modpackIcon || null,
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
  const newDir = uniqueInstanceDir(getInstancesRoot(), `${source.name} (copia)`);
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
// PERF FIX: buildWorldEntry es async porque el peso en disco de un mundo
// (getFolderSizeAsync) puede implicar recorrer región por región un mundo
// grande — ver el comentario largo junto a getFolderSizeAsync más arriba
// sobre por qué eso NO puede hacerse síncrono en el proceso principal.
// El resto de esta función (icon.png, level.dat) son lecturas puntuales de
// un solo archivo chico, no hace falta tocarlas.
async function buildWorldEntry(instance, worldDir, folderName) {
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
    size: await getFolderSizeAsync(worldPath),
    icon,
    hasNether: fs.existsSync(path.join(worldPath, 'DIM-1')),
    hasEnd: fs.existsSync(path.join(worldPath, 'DIM1')),
    info,
  };
}

/** Lista los mundos guardados (carpeta /saves) de una instancia, con
 * miniatura, peso y detalle de cada uno (ver buildWorldEntry).
 *
 * La lectura de level.dat/icon.png de cada mundo (buildWorldEntry) siempre
 * se hace fresca, directo de disco, cada vez que se llama a esta función
 * — no hay ningún caché de por medio para "info" (hardcore, dificultad,
 * modo de juego, nombre): así, apenas se vuelve a esta pantalla después de
 * jugar, lo que se muestra es exactamente lo que hay en el level.dat en
 * ESE momento (por ejemplo, un mundo hardcore recién creado adentro del
 * juego). Ver también WorldsTab (InstanceDetailView.jsx) por los distintos
 * disparadores que llaman a esto: al montar, al cerrarse el juego, al
 * volver a enfocar la ventana del launcher, y con un botón de refrescar
 * manual — para no depender de un solo evento que se podría perder (ej. si
 * el proceso del juego termina de una forma que el launcher no llega a
 * detectar como "salida normal").
 */
async function listWorlds(id) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const savesDir = getSavesDir(instance);
  if (!fs.existsSync(savesDir)) return [];
  const folders = fs.readdirSync(savesDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  // Secuencial (no Promise.all) a propósito: varios mundos grandes a la vez
  // sumarían sus recorridos de disco en simultáneo por poco beneficio real
  // (el disco ya es el cuello de botella), y esto deja que el "yield"
  // periódico de getFolderSizeAsync realmente le dé aire al resto de la app
  // entre mundo y mundo en vez de competir todos por el mismo hilo a la vez.
  const worlds = [];
  for (const folder of folders) {
    worlds.push(await buildWorldEntry(instance, savesDir, folder.name));
  }
  return worlds.sort((a, b) => b.lastModified - a.lastModified);
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

/**
 * Importa un mundo desde afuera de la instancia: arrastrado como carpeta
 * suelta (la del propio mundo, con level.dat adentro) o como .zip que la
 * contiene. Se usa desde "Mundos" → arrastrar y soltar (ver WorldsTab,
 * InstanceDetailView.jsx) y deja el mundo ya listo para jugar en /saves,
 * sin que el jugador tenga que descomprimir nada a mano.
 */
async function importWorld(instanceId, sourcePath) {
  const instance = getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const savesDir = getSavesDir(instance);
  if (!fs.existsSync(savesDir)) fs.mkdirSync(savesDir, { recursive: true });

  const isZip = sourcePath.toLowerCase().endsWith('.zip');
  const baseName = (isZip ? path.basename(sourcePath, path.extname(sourcePath)) : path.basename(sourcePath)) || 'Mundo importado';
  const folderName = freeWorldFolderName(savesDir, baseName);
  const destPath = path.join(savesDir, folderName);

  if (isZip) {
    const zip = new AdmZip(sourcePath);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);

    // El level.dat puede estar suelto en la raíz del zip, o anidado adentro
    // de una carpeta (típico al comprimir la carpeta del mundo entera desde
    // el Explorador/Finder: "MiMundo/level.dat" en vez de "level.dat"
    // directo) — se busca la primera ocurrencia a cualquier profundidad y
    // se usa su carpeta contenedora como raíz real del mundo, descartando
    // cualquier archivo suelto fuera de ella.
    const levelDatEntry = entries.find((e) => e.entryName === 'level.dat' || e.entryName.toLowerCase().endsWith('/level.dat'));
    if (!levelDatEntry) {
      throw new Error('Ese .zip no contiene un mundo de Minecraft válido (no se encontró level.dat).');
    }
    const stripPrefix = levelDatEntry.entryName.slice(0, levelDatEntry.entryName.length - 'level.dat'.length);

    fs.mkdirSync(destPath, { recursive: true });
    for (const entry of entries) {
      if (stripPrefix && !entry.entryName.startsWith(stripPrefix)) continue;
      const relative = stripPrefix ? entry.entryName.slice(stripPrefix.length) : entry.entryName;
      if (!relative) continue;
      const outPath = path.join(destPath, relative);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, entry.getData());
    }
  } else {
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
      throw new Error('Arrastrá la carpeta del mundo o un .zip que la contenga.');
    }
    // Mismo caso que con los .zip: si la carpeta soltada no tiene level.dat
    // directo pero tiene una única subcarpeta que sí, se usa esa (soltaron
    // la carpeta contenedora, no el mundo mismo).
    let src = sourcePath;
    if (!fs.existsSync(path.join(src, 'level.dat'))) {
      const children = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory());
      const withLevelDat = children.find((c) => fs.existsSync(path.join(src, c.name, 'level.dat')));
      if (!withLevelDat) {
        throw new Error('Esa carpeta no parece ser un mundo de Minecraft (no se encontró level.dat).');
      }
      src = path.join(src, withLevelDat.name);
    }
    fs.cpSync(src, destPath, { recursive: true });
  }

  return buildWorldEntry(instance, savesDir, folderName);
}

/** Duplica un mundo entero (carpeta /saves/<nombre>, incluyendo Nether/End
 * si los tiene) con un nombre nuevo, y también actualiza el "LevelName" de
 * su copia del level.dat para que el juego muestre el nombre nuevo en el
 * menú "Un jugador" en vez de seguir mostrando el del original. */
async function duplicateWorld(instanceId, worldPath) {
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
async function renameWorld(instanceId, worldPath, newName) {
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
async function updateWorldSettings(instanceId, worldPath, changes) {
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

// Nombre del archivo de manifiesto en la raíz de un paquete .hlpack (ver
// importInstancePackage más abajo).
const PACKAGE_MANIFEST_NAME = 'hardlauncher-instance.json';

/**
 * Importa un .hlpack: crea una instancia nueva a
 * partir del manifiesto que trae adentro (nombre, ícono, versión, loader) y
 * vuelca todo lo que estaba bajo "overrides/" en la carpeta de esa
 * instancia nueva — mismo mecanismo de origen/destino que duplicateInstance
 * de más arriba, pero leyendo de un .zip en vez de copiar otra carpeta ya
 * en disco. Reusa createInstance a propósito: así la instancia importada
 * arranca con los mismos valores por defecto (memoria, JVM args, hooks) que
 * cualquier instancia creada a mano en ESTA PC, en vez de heredar los de la
 * máquina de quien la exportó.
 */
function importInstancePackage(zipPath) {
  const zip = new AdmZip(zipPath);
  const manifestEntry = zip.getEntry(PACKAGE_MANIFEST_NAME);
  if (!manifestEntry) {
    throw new Error('Este archivo no es un paquete de instancia válido de Hard Launcher.');
  }

  let manifest;
  try {
    manifest = JSON.parse(zip.readAsText(manifestEntry));
  } catch {
    throw new Error('El manifiesto del paquete está dañado o corrupto.');
  }
  if (!manifest.mcVersion) {
    throw new Error('El paquete no indica ninguna versión de Minecraft.');
  }

  const instance = createInstance({
    name: manifest.name || 'Instancia importada',
    icon: manifest.icon || null,
    mcVersion: manifest.mcVersion,
    versionType: manifest.versionType,
    loader: manifest.loader,
    loaderVersion: manifest.loaderVersion,
  });

  const prefix = 'overrides/';
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const relative = entry.entryName.slice(prefix.length);
    if (!relative) continue;
    const destPath = path.join(instance.dir, relative);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, entry.getData());
  }

  return instance;
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

/**
 * Revela una captura de pantalla puntual en el explorador de archivos del
 * sistema (la selecciona/resalta), en vez de abrir la carpeta raíz de la
 * instancia sin indicar cuál era el archivo.
 * BUG FIX: el botón "Abrir carpeta" del visor de capturas usaba
 * instances:openFolder, que siempre abre instance.dir (la raíz de la
 * instancia) ignorando qué captura se estaba viendo — la persona terminaba
 * en la raíz, sin la screenshot marcada y sin siquiera estar parado en la
 * carpeta /screenshots. Misma restricción de ruta que deleteScreenshot.
 */
function showScreenshotInFolder(instanceId, filePath) {
  const instance = getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(instance.dir))) {
    throw new Error('Ruta fuera de la carpeta de la instancia.');
  }
  if (!fs.existsSync(resolved)) throw new Error('La captura ya no existe.');
  shell.showItemInFolder(resolved);
  return true;
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

// ---------------------------------------------------------------------------
// Explorador de archivos de la instancia (pestaña "Archivos"): navegar,
// crear/renombrar/borrar carpetas y archivos, y editar archivos de texto
// (configs, .toml, .json, etc.) sin salir del launcher. Todo lo de acá abajo
// trabaja con rutas RELATIVAS a la carpeta de la instancia (nunca rutas
// absolutas que vengan del renderer) y las resuelve siempre contra
// `instance.dir`, rechazando cualquier resultado que termine afuera (mismo
// espíritu que readImageAsDataUrl/deleteScreenshot de arriba, pero reusable
// para cualquier archivo o carpeta de adentro, no solo screenshots).

/**
 * Resuelve `relativePath` (puede venir vacío/'.' para la raíz, con '/' como
 * separador tal como lo arma el renderer) a una ruta absoluta DENTRO de
 * `instance.dir`. Tolera que el renderer mande la ruta ya resuelta (no
 * debería pasar, pero por las dudas) siempre que caiga adentro igual.
 */
function resolveInstancePath(instance, relativePath) {
  const base = path.resolve(instance.dir);
  const target = path.resolve(base, relativePath || '.');
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Ruta fuera de la carpeta de la instancia.');
  }
  return target;
}

function toRelative(instance, absolutePath) {
  const rel = path.relative(path.resolve(instance.dir), absolutePath);
  return rel.split(path.sep).join('/');
}

function safeEntryCount(dirPath) {
  try {
    return fs.readdirSync(dirPath).length;
  } catch {
    return 0;
  }
}

/**
 * Lista el contenido de una carpeta de la instancia (por defecto la raíz).
 * Carpetas primero, después archivos, ambos por orden alfabético — mismo
 * orden que muestran CurseForge/Modrinth App en su propio explorador.
 */
function listInstanceFiles(id, relativePath) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const dir = resolveInstancePath(instance, relativePath);
  if (!fs.existsSync(dir)) throw new Error('La carpeta ya no existe.');
  if (!fs.statSync(dir).isDirectory()) throw new Error('La ruta no es una carpeta.');

  const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const full = path.join(dir, entry.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      return null;
    }
    const isDirectory = entry.isDirectory();
    return {
      name: entry.name,
      path: toRelative(instance, full),
      isDirectory,
      size: isDirectory ? null : stat.size,
      itemCount: isDirectory ? safeEntryCount(full) : null,
      created: stat.birthtimeMs,
      modified: stat.mtimeMs,
    };
  });

  return entries
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

/** Crea una subcarpeta nueva dentro de `relativePath`. */
function createInstanceFolder(id, relativePath, name) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const clean = String(name || '').trim();
  if (!clean || /[/\\]/.test(clean)) throw new Error('Nombre de carpeta inválido.');
  const parent = resolveInstancePath(instance, relativePath);
  const target = path.join(parent, clean);
  if (fs.existsSync(target)) throw new Error('Ya existe algo con ese nombre acá.');
  fs.mkdirSync(target, { recursive: true });
  return { name: clean, path: toRelative(instance, target) };
}

/** Renombra un archivo o carpeta, sin moverlo de directorio. */
function renameInstancePath(id, relativePath, newName) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const clean = String(newName || '').trim();
  if (!clean || /[/\\]/.test(clean)) throw new Error('Nombre inválido.');
  const source = resolveInstancePath(instance, relativePath);
  if (!fs.existsSync(source)) throw new Error('Ya no existe en disco.');
  const target = path.join(path.dirname(source), clean);
  if (target !== source && fs.existsSync(target)) throw new Error('Ya existe algo con ese nombre acá.');
  fs.renameSync(source, target);
  return { name: clean, path: toRelative(instance, target) };
}

/** Borra uno o más archivos/carpetas (checkboxes tildados en la tabla). */
function deleteInstancePaths(id, relativePaths) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  for (const rel of relativePaths) {
    const resolved = resolveInstancePath(instance, rel);
    if (resolved === path.resolve(instance.dir)) continue; // nunca borrar la raíz misma
    if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
  }
  return true;
}

/** Revela un archivo/carpeta puntual en el explorador de archivos del sistema. */
function revealInstancePath(id, relativePath) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const resolved = resolveInstancePath(instance, relativePath);
  if (!fs.existsSync(resolved)) throw new Error('Ya no existe en disco.');
  shell.showItemInFolder(resolved);
  return true;
}

/** Abre un archivo con la aplicación por defecto del sistema operativo. */
function openInstancePathExternally(id, relativePath) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const resolved = resolveInstancePath(instance, relativePath);
  if (!fs.existsSync(resolved)) throw new Error('Ya no existe en disco.');
  return shell.openPath(resolved);
}

// Tope de tamaño para abrir un archivo en el editor de texto del launcher:
// más que esto (configs raros, logs gigantes) mejor "Abrir con..." del
// sistema en vez de cargarlo entero en memoria del renderer.
const MAX_EDITABLE_FILE_BYTES = 4 * 1024 * 1024;

/** Lee un archivo de la instancia como texto plano, para el editor integrado. */
function readInstanceTextFile(id, relativePath) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const resolved = resolveInstancePath(instance, relativePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('No es un archivo.');
  if (stat.size > MAX_EDITABLE_FILE_BYTES) {
    throw new Error('El archivo es demasiado grande para editarlo acá.');
  }
  return fs.readFileSync(resolved, 'utf8');
}

/** Guarda el contenido editado de un archivo de texto de la instancia. */
function writeInstanceTextFile(id, relativePath, content) {
  const instance = getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const resolved = resolveInstancePath(instance, relativePath);
  fs.writeFileSync(resolved, content, 'utf8');
  return true;
}



/**
 * Reordena las instancias guardadas según el orden de ids que llega desde
 * la barra lateral (ver Sidebar.jsx, que arrastra los íconos con
 * framer-motion). Cualquier instancia que no aparezca en orderedIds
 * (por ejemplo, una creada en otra ventana justo mientras se arrastraba
 * acá) se agrega al final en vez de perderse.
 */
function reorderInstances(orderedIds) {
  const instances = listInstances();
  const byId = new Map(instances.map((i) => [i.id, i]));
  const reordered = [];
  for (const id of orderedIds) {
    const inst = byId.get(id);
    if (inst) {
      reordered.push(inst);
      byId.delete(id);
    }
  }
  for (const remaining of byId.values()) reordered.push(remaining);
  store.set('instances', reordered);
  return reordered;
}

module.exports = {
  getInstancesRoot,
  migrateLegacyInstanceFolders,
  listInstances,
  getInstance,
  createInstance,
  reorderInstances,
  addServerToAllInstances,
  duplicateInstance,
  updateInstance,
  deleteInstance,
  getInstanceSize,
  openInstanceFolder,
  listWorlds,
  importWorld,
  duplicateWorld,
  renameWorld,
  updateWorldSettings,
  deleteWorld,
  openWorldFolder,
  exportWorldForServer,
  importInstancePackage,
  listScreenshots,
  deleteScreenshot,
  showScreenshotInFolder,
  readImageAsDataUrl,
  listInstanceFiles,
  createInstanceFolder,
  renameInstancePath,
  deleteInstancePaths,
  revealInstancePath,
  openInstancePathExternally,
  readInstanceTextFile,
  writeInstanceTextFile,
};

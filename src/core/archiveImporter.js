const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { openZip } = require('./zipReader');
const instanceStore = require('../store/instanceStore');
const launcherImporter = require('./launcherImporter');
const modInstaller = require('../api/modInstaller');
const { downloadQueue } = require('./versionManager');

/**
 * Importador "universal" de archivos: en vez de decidir el formato por la
 * extensión (antes solo se aceptaban .mrpack para modpacks y .hlpack/.zip
 * propios de Hard Launcher para instancias, y cualquier otro .zip ni
 * siquiera aparecía en el diálogo), se abre el archivo y se detecta qué es
 * por lo que trae adentro:
 *
 *  - modrinth.index.json            → modpack de Modrinth (.mrpack, o un .mrpack
 *                                     renombrado a .zip)
 *  - hardlauncher-instance.json     → paquete exportado por Hard Launcher
 *  - manifest.json (CurseForge)     → modpack exportado de CurseForge
 *  - mmc-pack.json / minecraftinstance.json / profile.json
 *                                   → instancia exportada de Prism / MultiMC /
 *                                     PolyMC / CurseForge App / Modrinth App
 *
 * Los marcadores se buscan en la raíz del archivo O dentro de UNA carpeta
 * raíz (muchos .zip hechos a mano o por el explorador de Windows guardan
 * todo adentro de una carpeta con el nombre del pack).
 *
 * Todo se lee/extrae por streaming (ver zipReader.js): modpacks con overrides
 * de cientos de MB o GB ya no revientan por falta de memoria.
 */

const norm = (name) => name.replace(/\\/g, '/');

/** Busca un archivo marcador en la raíz o a un nivel de profundidad. */
function findMarker(zip, fileName) {
  const target = fileName.toLowerCase();
  let best = null;
  for (const entry of zip.entries) {
    if (entry.isDirectory) continue;
    const parts = entry.name.split('/');
    if (parts.length > 2 || parts[0] === '__MACOSX') continue;
    if (parts[parts.length - 1].toLowerCase() !== target) continue;
    if (!best || parts.length < best.depth) {
      best = { entry, prefix: parts.length === 2 ? `${parts[0]}/` : '', depth: parts.length };
    }
  }
  return best;
}

async function readJson(zip, entry) {
  // Algunos manifiestos (sobre todo los de CurseForge) vienen con BOM UTF-8
  // y JSON.parse revienta con eso.
  return JSON.parse((await zip.readBuffer(entry)).toString('utf8').replace(/^\uFEFF/, ''));
}

/** Devuelve { kind, prefix, manifest? } o null si no se reconoce el formato. */
async function detectKind(zip) {
  const mr = findMarker(zip, 'modrinth.index.json');
  if (mr) return { kind: 'mrpack', prefix: mr.prefix };

  const hl = findMarker(zip, 'hardlauncher-instance.json');
  if (hl && hl.prefix === '') return { kind: 'hlpack', prefix: '', entry: hl.entry };

  const cf = findMarker(zip, 'manifest.json');
  if (cf) {
    try {
      const manifest = await readJson(zip, cf.entry);
      if (manifest?.minecraft?.version && Array.isArray(manifest.files)) {
        return { kind: 'curseforge', prefix: cf.prefix, manifest };
      }
    } catch {
      /* no es un manifiesto de CurseForge: se sigue probando */
    }
  }

  for (const marker of ['mmc-pack.json', 'minecraftinstance.json', 'profile.json']) {
    if (findMarker(zip, marker)) return { kind: 'instance' };
  }
  return null;
}

/** Resuelve `relative` dentro de `root` y rechaza rutas que se escapen ("zip slip"). */
function safeDest(root, relative) {
  const rootResolved = path.resolve(root);
  const dest = path.resolve(rootResolved, relative);
  return dest.startsWith(rootResolved + path.sep) ? dest : null;
}

/**
 * Vuelca las entradas de `zip` que cuelgan de `prefix` dentro de `destDir`,
 * una por una y en streaming. `onTick(hechos, total)` avisa el avance.
 */
async function extractPrefix(zip, prefix, destDir, onTick) {
  const todo = zip.entries.filter(
    (e) => !e.isDirectory && !e.name.startsWith('__MACOSX/') && e.name.startsWith(prefix) && e.name.length > prefix.length
  );
  let done = 0;
  for (const entry of todo) {
    const dest = safeDest(destDir, entry.name.slice(prefix.length));
    if (dest) await zip.extractTo(entry, dest);
    done++;
    onTick?.(done, todo.length);
  }
}

/** Convierte el avance de extractPrefix en eventos de progreso (sin inundar el IPC). */
function extractionProgress(onProgress, project) {
  return (done, total) => {
    if (done % 25 === 0 || done === total) {
      onProgress?.({ stage: 'extracting', project, file: `${done}/${total}` });
    }
  };
}

// ---------------------------------------------------------------------------
// CurseForge (manifest.json + overrides/)
// ---------------------------------------------------------------------------

const CF_LOADERS = ['neoforge', 'fabric', 'quilt', 'forge'];

function parseCurseForgeLoader(manifest) {
  const loaders = manifest.minecraft.modLoaders || [];
  const entry = loaders.find((l) => l.primary) || loaders[0];
  if (!entry?.id) return { loader: 'vanilla', loaderVersion: null };
  const [rawName, ...rest] = String(entry.id).split('-');
  const loader = CF_LOADERS.includes(rawName.toLowerCase()) ? rawName.toLowerCase() : 'vanilla';
  return { loader, loaderVersion: rest.join('-') || null };
}

/**
 * Descarga un archivo de CurseForge SIN API key, usando el endpoint público
 * de descarga del sitio (redirige al CDN). Algunos autores desactivan la
 * distribución fuera de CurseForge: esos archivos fallan y se reportan
 * aparte en vez de abortar toda la importación.
 */
async function downloadCurseForgeFile(projectId, fileId, modsDir) {
  const url = `https://www.curseforge.com/api/v1/mods/${projectId}/files/${fileId}/download`;
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    maxRedirects: 5,
    timeout: 120000,
    headers: { 'User-Agent': 'HardLauncher' },
  });

  const finalUrl = res.request?.res?.responseUrl || url;
  let fileName = '';
  try {
    fileName = decodeURIComponent(path.basename(new URL(finalUrl).pathname));
  } catch {
    /* se usa el nombre de respaldo de abajo */
  }
  if (!/\.(jar|zip)$/i.test(fileName)) fileName = `${projectId}-${fileId}.jar`;
  fileName = fileName.replace(/[\\/:*?"<>|]/g, '_');

  fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(path.join(modsDir, fileName), Buffer.from(res.data));
}

async function importCurseForgeModpack(zip, info, instanceName, onProgress) {
  const manifest = info.manifest;
  const { loader, loaderVersion } = parseCurseForgeLoader(manifest);

  const instance = instanceStore.createInstance({
    name: instanceName || manifest.name || 'Modpack importado',
    mcVersion: manifest.minecraft.version,
    loader,
    loaderVersion,
  });
  onProgress?.({ stage: 'instance-created', instance, project: instance.name });

  // Primero los overrides (configs, scripts, a veces mods incluidos a mano).
  const overridesDir = (manifest.overrides || 'overrides').replace(/^\/+|\/+$/g, '');
  await extractPrefix(zip, `${info.prefix}${overridesDir}/`, instance.dir, extractionProgress(onProgress, instance.name));

  const files = manifest.files.filter((f) => f.required !== false && f.projectID && f.fileID);
  const failed = [];
  await downloadQueue(
    files,
    async (f) => {
      try {
        await downloadCurseForgeFile(f.projectID, f.fileID, path.join(instance.dir, 'mods'));
      } catch (e) {
        failed.push(`${f.projectID}/${f.fileID}`);
        onProgress?.({ stage: 'warning', message: `No se pudo descargar el archivo ${f.projectID}/${f.fileID}: ${e.message}` });
      }
    },
    6,
    ({ completed, total }) => onProgress?.({ stage: 'downloading', project: instance.name, completed, total })
  );

  onProgress?.({ stage: 'resolving', project: instance.name });
  // Registra en la instancia lo que quedó en mods/, resourcepacks/, etc.
  const updated = modInstaller.scanInstanceContent(instance.id) || instance;

  return failed.length
    ? { ...updated, importWarnings: [`${failed.length} de ${files.length} archivos no se pudieron descargar.`] }
    : updated;
}

// ---------------------------------------------------------------------------
// Instancias exportadas de otros launchers (Prism/MultiMC/PolyMC/CurseForge/Modrinth)
// ---------------------------------------------------------------------------

async function importInstanceArchive(zip, onProgress) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hardlauncher-import-'));
  try {
    await extractPrefix(zip, '', tmpRoot, extractionProgress(onProgress, 'Importando instancia'));
    // scanLauncherPath mira la carpeta en sí o sus subcarpetas directas, o
    // sea cubre tanto "todo en la raíz del .zip" como "todo dentro de una
    // carpeta raíz".
    const found = await launcherImporter.scanLauncherPath(tmpRoot);
    if (!found.length) {
      throw new Error('El .zip parece una instancia, pero no pude leer su versión de Minecraft ni su loader.');
    }
    const imported = await launcherImporter.importSelectedInstances(
      found.map((i) => i.dir),
      onProgress
    );
    if (!imported.length) throw new Error('No se pudo importar ninguna instancia de ese archivo.');
    return imported;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Paquete .hlpack de Hard Launcher (hardlauncher-instance.json + overrides/)
// ---------------------------------------------------------------------------

async function importHlpack(zip, info, onProgress) {
  let manifest;
  try {
    manifest = await readJson(zip, info.entry);
  } catch {
    throw new Error('El manifiesto del paquete está dañado o corrupto.');
  }
  if (!manifest.mcVersion) throw new Error('El paquete no indica ninguna versión de Minecraft.');

  const instance = instanceStore.createInstance({
    name: manifest.name || 'Instancia importada',
    icon: manifest.icon || null,
    mcVersion: manifest.mcVersion,
    versionType: manifest.versionType,
    loader: manifest.loader,
    loaderVersion: manifest.loaderVersion,
  });
  await extractPrefix(zip, 'overrides/', instance.dir, extractionProgress(onProgress, instance.name));
  return instance;
}

// ---------------------------------------------------------------------------

/**
 * Importa `archivePath` detectando su formato por el contenido. Siempre
 * devuelve un array de instancias creadas (casi siempre una sola).
 */
async function importArchive(archivePath, { name = null, onProgress } = {}) {
  if (!archivePath || !fs.existsSync(archivePath)) throw new Error('El archivo ya no existe.');

  const zip = openZip(archivePath); // lanza un error claro si no es un .zip válido
  const info = await detectKind(zip);
  if (!info) {
    throw new Error(
      'No reconocí el contenido de este archivo. Formatos compatibles: modpack de Modrinth (.mrpack o .zip), ' +
        'modpack de CurseForge (.zip con manifest.json), instancias exportadas de Prism/MultiMC/PolyMC/CurseForge/Modrinth ' +
        'y paquetes .hlpack de Hard Launcher.'
    );
  }

  switch (info.kind) {
    case 'mrpack':
      return [await modInstaller.installModpack(archivePath, name, onProgress)];
    case 'hlpack':
      return [await importHlpack(zip, info, onProgress)];
    case 'curseforge':
      return [await importCurseForgeModpack(zip, info, name, onProgress)];
    case 'instance':
    default:
      return importInstanceArchive(zip, onProgress);
  }
}

module.exports = { importArchive };

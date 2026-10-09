const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { app } = require('electron');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

function getGameRoot() {
  const root = path.join(app.getPath('userData'), 'game');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Devuelve el manifest completo de versiones (releases + snapshots). */
async function getVersionManifest() {
  const { data } = await axios.get(MANIFEST_URL);
  return {
    latest: data.latest,
    versions: data.versions.map((v) => ({
      id: v.id,
      type: v.type, // 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
      releaseTime: v.releaseTime,
      url: v.url,
    })),
  };
}

async function getVersionDetails(versionId) {
  const manifest = await getVersionManifest();
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Versión ${versionId} no encontrada en el manifest de Mojang.`);
  const { data } = await axios.get(entry.url);
  return data;
}

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DOWNLOAD_IDLE_TIMEOUT_MS = 30000;

/** Un intento de descarga a `tmpPath`, en streaming y con corte por inactividad. */
async function downloadOnce(url, tmpPath, displayName, onProgress) {
  const response = await axios.get(url, { responseType: 'stream', timeout: 30000, maxRedirects: 5 });
  const total = parseInt(response.headers['content-length'] || '0', 10);
  let downloaded = 0;
  let lastTick = 0;

  // Si el servidor deja de mandar datos (conexión colgada a mitad de un mod),
  // se corta en vez de quedar esperando para siempre.
  let idle;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () => response.data.destroy(new Error('La descarga se detuvo (30 s sin recibir datos).')),
      DOWNLOAD_IDLE_TIMEOUT_MS
    );
  };
  arm();

  response.data.on('data', (chunk) => {
    downloaded += chunk.length;
    arm();
    if (onProgress && total) {
      // Sin throttle esto emitía un evento por cada chunk (miles por segundo
      // con varias descargas en paralelo).
      const now = Date.now();
      if (now - lastTick > 250 || downloaded === total) {
        lastTick = now;
        onProgress({ file: displayName, downloaded, total });
      }
    }
  });

  try {
    // pipeline() propaga los errores del stream de red Y del de escritura, y
    // destruye ambos. Antes se usaba .pipe() sin escuchar 'error' en
    // response.data: un corte de red a mitad de descarga lanzaba una
    // excepción NO atrapada en el proceso principal (o dejaba la promesa
    // colgada para siempre).
    await pipeline(response.data, fs.createWriteStream(tmpPath));
  } finally {
    clearTimeout(idle);
  }
}

async function downloadFile(url, destPath, expectedSha1, onProgress, { retries = 3 } = {}) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // Evita re-descargar si ya existe y el hash coincide.
  if (expectedSha1 && fs.existsSync(destPath)) {
    const existingHash = await sha1File(destPath).catch(() => null);
    if (existingHash === expectedSha1) return destPath;
  }

  // Se descarga a un .part y recién se renombra cuando está completo y
  // verificado: un corte ya no deja un .jar a medias que parezca válido.
  const tmpPath = `${destPath}.part`;
  const displayName = path.basename(destPath);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await downloadOnce(url, tmpPath, displayName, onProgress);
      if (expectedSha1) {
        const hash = await sha1File(tmpPath);
        if (hash !== expectedSha1) throw new Error(`El archivo descargado está corrupto (${displayName}).`);
      }
      fs.renameSync(tmpPath, destPath);
      return destPath;
    } catch (err) {
      lastError = err;
      fs.rmSync(tmpPath, { force: true });
      // 4xx (salvo 408/429) no se arregla reintentando.
      const status = err?.response?.status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) break;
      if (attempt < retries) await sleep(750 * 2 ** attempt);
    }
  }
  throw lastError;
}

/**
 * Descarga una lista de items en paralelo con un límite de concurrencia.
 * Sin esto, listas de miles de assets se descargaban una por una y la UI
 * parecía "congelada" aunque sí avanzaba, solo que muy lento.
 * `task(item)` debe devolver una promesa; `onBatchProgress` recibe
 * { completed, total } después de cada item terminado (progreso agregado,
 * no del archivo individual).
 */
async function downloadQueue(items, task, concurrency = 12, onBatchProgress) {
  let index = 0;
  let completed = 0;
  let failed = false;
  const total = items.length;

  async function worker() {
    // Si una tarea falla, los demás workers dejan de tomar items nuevos: antes
    // seguían bajando en segundo plano después de que la importación ya
    // había abortado.
    while (!failed && index < items.length) {
      const current = items[index++];
      try {
        await task(current);
      } catch (err) {
        failed = true;
        throw err;
      }
      completed++;
      onBatchProgress?.({ completed, total });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
}

/** Determina qué reglas de "downloads.classifiers" aplican al SO actual. */
function currentOsName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}

function ruleApplies(rule) {
  if (!rule.os) return true;
  if (rule.os.name && rule.os.name !== currentOsName()) return false;
  return true;
}

function libraryAllowed(lib) {
  if (!lib.rules) return true;
  let allowed = false;
  for (const rule of lib.rules) {
    if (ruleApplies(rule)) allowed = rule.action === 'allow';
  }
  return allowed;
}

/**
 * Descarga client.jar, todas las librerías nativas/normales y los assets
 * necesarios para lanzar `versionId`. Devuelve las rutas relevantes para
 * construir el classpath en el launcher.
 */
async function ensureVersionInstalled(versionId, onProgress) {
  const root = getGameRoot();
  const versionDetails = await getVersionDetails(versionId);
  const versionDir = path.join(root, 'versions', versionId);
  fs.mkdirSync(versionDir, { recursive: true });

  // El instalador de Forge/NeoForge lee el JSON vanilla de versions/<mc>/<mc>.json
  // (igual que deja el launcher oficial), así que se guarda junto al client.jar.
  fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(versionDetails));

  // 1) client.jar
  const clientJarPath = path.join(versionDir, `${versionId}.jar`);
  await downloadFile(
    versionDetails.downloads.client.url,
    clientJarPath,
    versionDetails.downloads.client.sha1,
    onProgress
  );

  // 2) Librerías (incluye nativos) — en paralelo, con progreso agregado.
  const librariesDir = path.join(root, 'libraries');
  const classpath = [clientJarPath];
  const nativesDir = path.join(versionDir, 'natives');
  fs.mkdirSync(nativesDir, { recursive: true });

  const applicableLibs = versionDetails.libraries.filter(libraryAllowed);
  await downloadQueue(
    applicableLibs,
    async (lib) => {
      if (lib.downloads?.artifact) {
        const artifact = lib.downloads.artifact;
        const dest = path.join(librariesDir, artifact.path);
        await downloadFile(artifact.url, dest, artifact.sha1);
        classpath.push(dest);
      }
      const classifierKey = lib.natives?.[currentOsName()];
      if (classifierKey && lib.downloads?.classifiers?.[classifierKey]) {
        const nativeArtifact = lib.downloads.classifiers[classifierKey];
        const dest = path.join(librariesDir, nativeArtifact.path);
        await downloadFile(nativeArtifact.url, dest, nativeArtifact.sha1);
        await extractNative(dest, nativesDir);
      }
    },
    12,
    ({ completed, total }) => onProgress?.({ stage: 'libraries', completed, total })
  );

  // 3) Assets (index + objetos) — también en paralelo. Esta es la parte que
  // más tiempo toma (miles de archivos pequeños en versiones modernas).
  const assetsDir = path.join(root, 'assets');
  const assetIndex = versionDetails.assetIndex;
  const indexPath = path.join(assetsDir, 'indexes', `${assetIndex.id}.json`);
  await downloadFile(assetIndex.url, indexPath, assetIndex.sha1);
  const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

  const objectEntries = Object.values(indexData.objects);
  await downloadQueue(
    objectEntries,
    async (obj) => {
      const hash = obj.hash;
      const subDir = hash.substring(0, 2);
      const dest = path.join(assetsDir, 'objects', subDir, hash);
      const url = `https://resources.download.minecraft.net/${subDir}/${hash}`;
      await downloadFile(url, dest, hash);
    },
    16,
    ({ completed, total }) => onProgress?.({ stage: 'assets', completed, total })
  );

  return {
    versionDetails,
    clientJarPath,
    classpath,
    nativesDir,
    assetsDir,
    assetIndexId: assetIndex.id,
    gameRoot: root,
  };
}

async function extractNative(zipPath, destDir) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  zip.getEntries().forEach((entry) => {
    if (!entry.isDirectory && !entry.entryName.startsWith('META-INF')) {
      zip.extractEntryTo(entry, destDir, false, true);
    }
  });
}

module.exports = {
  getGameRoot,
  getVersionManifest,
  getVersionDetails,
  ensureVersionInstalled,
  downloadFile,
  downloadQueue,
  libraryAllowed,
};

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

async function downloadFile(url, destPath, expectedSha1, onProgress) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // Evita re-descargar si ya existe y el hash coincide.
  if (expectedSha1 && fs.existsSync(destPath)) {
    const existingHash = await sha1File(destPath).catch(() => null);
    if (existingHash === expectedSha1) return destPath;
  }

  const response = await axios.get(url, { responseType: 'stream' });
  const writer = fs.createWriteStream(destPath);
  let downloaded = 0;
  const total = parseInt(response.headers['content-length'] || '0', 10);

  response.data.on('data', (chunk) => {
    downloaded += chunk.length;
    if (onProgress && total) onProgress({ file: path.basename(destPath), downloaded, total });
  });

  await new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  return destPath;
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
  const total = items.length;

  async function worker() {
    while (index < items.length) {
      const current = items[index++];
      await task(current);
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
};

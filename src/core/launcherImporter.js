const fs = require('fs');
const path = require('path');
const instanceStore = require('../store/instanceStore');

// uid → id de loader que usa Hard Launcher, tal como aparecen en los
// "components" de mmc-pack.json (Prism Launcher / MultiMC / PolyMC).
const MMC_LOADER_UIDS = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge',
};

// Carpetas de datos del juego que tiene sentido copiar a la instancia nueva.
// "options.txt"/"servers.dat" quedan afuera a propósito: son preferencias
// de ESE launcher/cuenta, no algo que sea seguro asumir para Hard Launcher.
const DATA_FOLDERS = ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves', 'screenshots'];

/**
 * Intenta reconocer `dir` como la carpeta de una instancia ya existente de
 * otro launcher y extraer lo mínimo necesario para recrearla acá: nombre,
 * versión de Minecraft, loader, y dónde están sus datos (mods/mundos/etc).
 * Devuelve null si `dir` no coincide con ningún formato soportado.
 */
function detectInstance(dir) {
  // --- Prism Launcher / MultiMC / PolyMC: comparten el mismo formato ---
  const mmcPackPath = path.join(dir, 'mmc-pack.json');
  if (fs.existsSync(mmcPackPath)) {
    let pack;
    try {
      pack = JSON.parse(fs.readFileSync(mmcPackPath, 'utf-8'));
    } catch {
      return null;
    }
    const components = pack.components || [];
    const mcComponent = components.find((c) => c.uid === 'net.minecraft');
    if (!mcComponent?.version) return null;

    const loaderComponent = components.find((c) => MMC_LOADER_UIDS[c.uid]);

    let name = path.basename(dir);
    const cfgPath = path.join(dir, 'instance.cfg');
    if (fs.existsSync(cfgPath)) {
      const match = fs.readFileSync(cfgPath, 'utf-8').match(/^name=(.+)$/m);
      if (match) name = match[1].trim();
    }

    const gameDir = ['.minecraft', 'minecraft']
      .map((d) => path.join(dir, d))
      .find((p) => fs.existsSync(p)) || dir;

    return {
      name,
      mcVersion: mcComponent.version,
      loader: loaderComponent ? MMC_LOADER_UIDS[loaderComponent.uid] : 'vanilla',
      loaderVersion: loaderComponent?.version || null,
      gameDir,
      format: 'Prism Launcher / MultiMC',
    };
  }

  // --- CurseForge App ---
  const cfManifestPath = path.join(dir, 'minecraftinstance.json');
  if (fs.existsSync(cfManifestPath)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(cfManifestPath, 'utf-8'));
    } catch {
      return null;
    }
    const mcVersion = data.baseModLoader?.minecraftVersion || data.gameVersion;
    if (!mcVersion) return null;

    const loaderName = (data.baseModLoader?.name || '').toLowerCase();
    let loader = 'vanilla';
    if (loaderName.includes('fabric')) loader = 'fabric';
    else if (loaderName.includes('quilt')) loader = 'quilt';
    else if (loaderName.includes('neoforge')) loader = 'neoforge';
    else if (loaderName.includes('forge')) loader = 'forge';

    return {
      name: data.name || path.basename(dir),
      mcVersion,
      loader,
      // CurseForge guarda la cadena completa del loader ("forge-47.2.0"),
      // Hard Launcher espera solo el número de versión.
      loaderVersion: (data.baseModLoader?.forgeVersion || data.baseModLoader?.name || '').replace(/^.*-/, '') || null,
      gameDir: dir, // CurseForge no usa una subcarpeta ".minecraft": todo vive en la raíz de la instancia.
      format: 'CurseForge',
    };
  }

  return null;
}

/**
 * Busca instancias importables bajo `rootPath`: puede ser la carpeta de UNA
 * instancia (se detecta directo) o la carpeta "instances" de otro launcher
 * que contiene varias (se revisa cada subcarpeta de primer nivel).
 */
function scanLauncherPath(rootPath) {
  if (!fs.existsSync(rootPath)) throw new Error('Esa ruta no existe.');
  if (!fs.statSync(rootPath).isDirectory()) throw new Error('La ruta debe ser una carpeta.');

  const direct = detectInstance(rootPath);
  if (direct) return [{ dir: rootPath, ...direct }];

  const found = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(rootPath, entry.name);
    const parsed = detectInstance(sub);
    if (parsed) found.push({ dir: sub, ...parsed });
  }
  return found;
}

function copyGameData(sourceDir, destDir) {
  for (const folder of DATA_FOLDERS) {
    const src = path.join(sourceDir, folder);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(destDir, folder), { recursive: true, force: true });
    }
  }
}

/**
 * Importa TODAS las instancias detectadas bajo `rootPath`: crea una
 * instancia nueva de Hard Launcher por cada una (mismo nombre/versión/
 * loader) y copia sus mods/config/mundos/capturas/resource packs/shaders.
 */
async function importInstances(rootPath, onProgress) {
  const candidates = scanLauncherPath(rootPath);
  if (candidates.length === 0) {
    throw new Error(
      'No se encontró ninguna instancia reconocible en esa carpeta (se soporta Prism Launcher, MultiMC, PolyMC y CurseForge).'
    );
  }

  const imported = [];
  for (const candidate of candidates) {
    onProgress?.({ stage: 'importing', name: candidate.name, format: candidate.format });
    const instance = instanceStore.createInstance({
      name: candidate.name,
      mcVersion: candidate.mcVersion,
      loader: candidate.loader,
      loaderVersion: candidate.loaderVersion,
    });
    copyGameData(candidate.gameDir, instance.dir);
    imported.push(instance);
  }
  return imported;
}

module.exports = { scanLauncherPath, importInstances };

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { downloadFile, getGameRoot } = require('./versionManager');

const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';

/**
 * Lista versiones de loader disponibles para una versión de Minecraft dada,
 * como `{ version, stable }`. El buscador "Custom setup" usa `stable` para
 * las pestañas Stable/Latest/Other (igual que Modrinth App): "Stable" toma
 * la más nueva marcada estable, "Latest" la más nueva sin importar canal, y
 * "Other" deja elegir cualquiera de la lista completa.
 */
async function listLoaderVersions(loader, mcVersion) {
  if (loader === 'fabric') {
    // La API de Fabric ya devuelve `loader.stable` (true/false) y viene
    // ordenada de más nueva a más vieja.
    const { data } = await axios.get(`${FABRIC_META}/versions/loader/${mcVersion}`);
    return data.map((v) => ({ version: v.loader.version, stable: v.loader.stable }));
  }
  if (loader === 'quilt') {
    // Quilt no expone un campo `stable` como Fabric; sus builds de
    // pre-lanzamiento se identifican por "-beta." en el propio número de
    // versión (ej. "0.18.1-beta.1"), así que se infiere de ahí.
    const { data } = await axios.get(`${QUILT_META}/versions/loader/${mcVersion}`);
    return data.map((v) => ({ version: v.loader.version, stable: !/-beta\./i.test(v.loader.version) }));
  }
  if (loader === 'forge') {
    // promos_slim trae como mucho 2 entradas por versión de MC:
    // "<mc>-recommended" (estable) y "<mc>-latest" (la build más nueva,
    // puede o no coincidir con la recomendada).
    const { data } = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const byVersion = new Map();
    for (const key of Object.keys(data.promos)) {
      if (!key.startsWith(mcVersion)) continue;
      const version = data.promos[key];
      const stable = key.endsWith('-recommended') || byVersion.get(version)?.stable;
      byVersion.set(version, { version, stable: !!stable });
    }
    return Array.from(byVersion.values());
  }
  if (loader === 'neoforge') {
    // El endpoint no distingue estable/beta con un campo aparte; NeoForge
    // marca sus builds de pre-lanzamiento con "-beta" en la propia versión.
    const { data } = await axios.get('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    return data.versions
      .filter((v) => v.startsWith(mcVersion.replace(/^1\./, '')))
      .reverse() // el endpoint devuelve ascendente; se quiere la más nueva primero
      .map((v) => ({ version: v, stable: !/-beta/i.test(v) }));
  }
  return [];
}

/**
 * Fabric y Quilt exponen un endpoint que genera directamente el "launcher profile"
 * (JSON con mainClass, librerías y argumentos) igual que el de Mojang, así que
 * el mismo `launcher.js` puede fusionarlo con el JSON vanilla sin lógica extra.
 */
async function installFabricLike(loader, mcVersion, loaderVersion, onProgress) {
  const base = loader === 'fabric' ? FABRIC_META : QUILT_META;
  const profileUrl = `${base}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
  const { data: profile } = await axios.get(profileUrl);

  const librariesDir = path.join(getGameRoot(), 'libraries');
  const classpath = [];

  for (const lib of profile.libraries) {
    const [group, artifact, version] = lib.name.split(':');
    const relPath = `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.jar`;
    const url = `${lib.url || 'https://maven.fabricmc.net/'}${relPath}`;
    const dest = path.join(librariesDir, relPath);
    await downloadFile(url, dest, null, onProgress);
    classpath.push(dest);
  }

  return {
    mainClass: profile.mainClass,
    extraLibraries: classpath,
    // Fabric/Quilt heredan el resto de argumentos (assets, jvm) del perfil vanilla.
  };
}

/**
 * Normaliza la versión del loader que puede venir de distintas fuentes
 * ("43.2.0", "1.19.2-43.2.0", "forge-43.2.0", "neoforge-21.1.5"...) a la
 * forma que usa el instalador: solo "43.2.0" / "21.1.5".
 */
function normalizeForgeLikeVersion(loader, mcVersion, loaderVersion) {
  let v = String(loaderVersion || '').trim();
  v = v.replace(new RegExp(`^${loader}-`, 'i'), '');
  v = v.replace(new RegExp(`^forge-`, 'i'), '');
  if (mcVersion && v.startsWith(`${mcVersion}-`)) v = v.slice(mcVersion.length + 1);
  return v;
}

/** Elige la versión recomendada/estable más nueva si la instancia no trae una. */
async function pickDefaultForgeLikeVersion(loader, mcVersion) {
  const available = await listLoaderVersions(loader, mcVersion);
  if (!available.length) {
    throw new Error(`No hay versiones de ${loader} disponibles para Minecraft ${mcVersion}.`);
  }
  return (available.find((v) => v.stable) || available[0]).version;
}

function forgeLikeVersionIds(loader, mcVersion, version) {
  return loader === 'forge'
    ? [`${mcVersion}-forge-${version}`, `${mcVersion}-forge${mcVersion}-${version}`, `${mcVersion}-Forge${version}`]
    : [`neoforge-${version}`];
}

function readProfileIfPresent(versionsDir, ids) {
  for (const id of ids) {
    const file = path.join(versionsDir, id, `${id}.json`);
    if (fs.existsSync(file)) {
      try {
        return { versionId: id, profile: JSON.parse(fs.readFileSync(file, 'utf-8')) };
      } catch {
        /* JSON dañado: se reinstala */
      }
    }
  }
  return null;
}

/**
 * Forge y NeoForge distribuyen un "installer.jar" que normalmente corre una GUI.
 * Ambos soportan un modo headless: `java -jar installer.jar --installClient <dir>`.
 * Tras ejecutarlo, dejan un version-profile JSON en /versions/<id>/ igual que
 * el de Mojang (con "inheritsFrom" apuntando a la versión vanilla), que el
 * launcher fusiona con el JSON vanilla al armar el comando de lanzamiento.
 *
 * Si ya estaba instalado (mismo id de versión) se reutiliza sin volver a
 * correr el instalador. Devuelve `{ versionId, profile, loaderVersion }`.
 */
async function installForgeLike(loader, mcVersion, loaderVersion, javaBin, onProgress) {
  const version = normalizeForgeLikeVersion(loader, mcVersion, loaderVersion) ||
    (await pickDefaultForgeLikeVersion(loader, mcVersion));

  const gameRoot = getGameRoot();
  const versionsDir = path.join(gameRoot, 'versions');
  const expectedIds = forgeLikeVersionIds(loader, mcVersion, version);

  const existing = readProfileIfPresent(versionsDir, expectedIds);
  if (existing) return { ...existing, loaderVersion: version };

  const installerUrl =
    loader === 'forge'
      ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${version}/forge-${mcVersion}-${version}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;

  const installerPath = path.join(gameRoot, 'installers', `${loader}-${mcVersion}-${version}.jar`);
  try {
    await downloadFile(installerUrl, installerPath, null, onProgress);
  } catch (e) {
    fs.rmSync(installerPath, { force: true });
    throw new Error(`No se pudo descargar el instalador de ${loader} ${version}: ${e.message}`);
  }

  // El instalador exige que exista un launcher_profiles.json en la carpeta
  // destino (lo crea el launcher oficial); sin él aborta con "There is no
  // minecraft launcher profile". Como acá no hay launcher oficial, se crea uno vacío.
  const profilesFile = path.join(gameRoot, 'launcher_profiles.json');
  if (!fs.existsSync(profilesFile)) {
    fs.writeFileSync(profilesFile, JSON.stringify({ profiles: {}, version: 3 }, null, 2));
  }

  const before = new Set(fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir) : []);
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(javaBin, ['-jar', installerPath, '--installClient', gameRoot], { cwd: gameRoot });
      // El instalador imprime miles de líneas ("Slim a.class", "Keep ...") al
      // procesar el cliente: se filtran para no inundar la consola del juego.
      const NOISE = /^\s*(Slim|Keep|Filtered|Considering|Skipping)\b/i;
      let pending = '';
      const onData = (d) => {
        const text = d.toString();
        output = (output + text).slice(-4000);
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        const useful = lines.filter((l) => l.trim() && !NOISE.test(l));
        if (useful.length) onProgress?.({ log: useful.join('\n') });
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', reject);
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`código ${code}`))));
    });
  } catch (e) {
    // Un instalador a medias dejaría un perfil roto que después se tomaría por válido.
    fs.rmSync(installerPath, { force: true });
    const tail = output.trim().split('\n').slice(-5).join('\n');
    throw new Error(`Falló el instalador de ${loader} ${version} (${e.message}).${tail ? `\n${tail}` : ''}`);
  }

  let found = readProfileIfPresent(versionsDir, expectedIds);
  if (!found) {
    // Respaldo: algún id distinto al esperado, buscando una carpeta nueva
    // (o, si no hay, cualquiera) que mencione el loader y la versión.
    const candidates = fs
      .readdirSync(versionsDir)
      .filter((n) => n.toLowerCase().includes(loader) && n.includes(version))
      .sort((a, b) => Number(before.has(a)) - Number(before.has(b)));
    found = readProfileIfPresent(versionsDir, candidates);
  }
  if (!found) throw new Error(`No se pudo localizar el perfil generado por el instalador de ${loader}.`);
  return { ...found, loaderVersion: version };
}

module.exports = { listLoaderVersions, installFabricLike, installForgeLike, normalizeForgeLikeVersion };

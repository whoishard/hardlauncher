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
 * Forge y NeoForge distribuyen un "installer.jar" que normalmente corre una GUI.
 * Ambos soportan un modo headless: `java -jar installer.jar --installClient <dir>`.
 * Tras ejecutarlo, dejan un version-profile JSON en /versions/<id>/ igual que
 * el de Mojang, que el launcher puede leer y fusionar como si fuese otra versión.
 */
async function installForgeLike(loader, mcVersion, loaderVersion, javaBin, onProgress) {
  const installerUrl =
    loader === 'forge'
      ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${loaderVersion}/forge-${mcVersion}-${loaderVersion}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;

  const gameRoot = getGameRoot();
  const installerPath = path.join(gameRoot, 'installers', `${loader}-${mcVersion}-${loaderVersion}.jar`);
  await downloadFile(installerUrl, installerPath, null, onProgress);

  await new Promise((resolve, reject) => {
    const proc = spawn(javaBin, ['-jar', installerPath, '--installClient', gameRoot], { cwd: gameRoot });
    proc.stdout.on('data', (d) => onProgress && onProgress({ log: d.toString() }));
    proc.stderr.on('data', (d) => onProgress && onProgress({ log: d.toString() }));
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Instalador de ${loader} salió con código ${code}`))));
  });

  // El instalador genera un id de versión propio, ej: "1.20.1-forge-47.2.0"
  const versionsDir = path.join(gameRoot, 'versions');
  const generatedId = fs
    .readdirSync(versionsDir)
    .find((name) => name.includes(loader) && name.includes(mcVersion));

  if (!generatedId) throw new Error(`No se pudo localizar el perfil generado por el instalador de ${loader}.`);
  const profile = JSON.parse(fs.readFileSync(path.join(versionsDir, generatedId, `${generatedId}.json`), 'utf-8'));
  return { versionId: generatedId, profile };
}

module.exports = { listLoaderVersions, installFabricLike, installForgeLike };

const fs = require('fs');
const zlib = require('zlib');
const { parseNbt, writeNbt, TAG_BYTE, TAG_INT, TAG_STRING } = require('./nbtWriter');

// Lector/escritor puntual del level.dat de un mundo guardado, construido
// arriba del NBT genérico de nbtWriter.js. Un level.dat es: gzip -> un
// TAG_Compound raíz sin nombre -> un único hijo TAG_Compound "Data" con
// todo lo que nos importa acá (nombre del mundo, modo de juego, dificultad,
// semilla, etc.), más un montón de tags que Minecraft usa para sí mismo y
// que no tocamos ni mostramos (se preservan tal cual al reescribir, mismo
// approach que servers.dat en nbtWriter.js).

function findTag(tags, name) {
  return tags.find((t) => t.name === name);
}

function getTagValue(tags, name, fallback = null) {
  const tag = findTag(tags, name);
  return tag ? tag.value : fallback;
}

function setTagValue(tags, name, type, value) {
  const existing = findTag(tags, name);
  if (existing) {
    existing.type = type;
    existing.value = value;
  } else {
    tags.push({ type, name, value });
  }
}

/**
 * Lee un level.dat y devuelve tanto el resumen legible (info) como el árbol
 * NBT crudo (root) — este último hace falta si después se quiere reescribir
 * el archivo (writeLevelInfo) sin perder ningún tag que no conocemos.
 */
function readLevelInfo(levelDatPath) {
  const gzipped = fs.readFileSync(levelDatPath);
  const raw = zlib.gunzipSync(gzipped);
  const root = parseNbt(raw);
  const dataTag = findTag(root.tags, 'Data');
  if (!dataTag || !dataTag.value || !dataTag.value.tags) {
    throw new Error('level.dat sin sección "Data" reconocible.');
  }
  const dataTags = dataTag.value.tags;

  // La semilla vive en distintos lugares según la versión: mundos viejos la
  // tienen directo en Data.RandomSeed, mundos 1.16+ la mudaron adentro de
  // Data.WorldGenSettings.seed. Se prueban ambas rutas y se usa la primera
  // que aparezca.
  let seed = getTagValue(dataTags, 'RandomSeed', null);
  if (seed === null) {
    const worldGenSettings = getTagValue(dataTags, 'WorldGenSettings', null);
    if (worldGenSettings && worldGenSettings.tags) {
      seed = getTagValue(worldGenSettings.tags, 'seed', null);
    }
  }

  const lastPlayed = getTagValue(dataTags, 'LastPlayed', null);

  return {
    root,
    info: {
      levelName: getTagValue(dataTags, 'LevelName', ''),
      gameType: Number(getTagValue(dataTags, 'GameType', 0)),
      difficulty: Number(getTagValue(dataTags, 'Difficulty', 2)),
      hardcore: !!getTagValue(dataTags, 'hardcore', 0),
      allowCommands: !!getTagValue(dataTags, 'allowCommands', 0),
      seed: seed !== null && seed !== undefined ? seed.toString() : null,
      lastPlayed: lastPlayed !== null ? Number(lastPlayed) : null,
    },
  };
}

/**
 * Aplica cambios puntuales (solo las claves presentes en `changes`) sobre un
 * root ya leído con readLevelInfo, y reescribe el level.dat entero — el
 * resto de los tags (incluido cualquiera que no conocemos) queda intacto.
 */
function writeLevelInfo(levelDatPath, root, changes) {
  const dataTag = findTag(root.tags, 'Data');
  const dataTags = dataTag.value.tags;

  if (changes.levelName !== undefined) setTagValue(dataTags, 'LevelName', TAG_STRING, changes.levelName);
  if (changes.gameType !== undefined) setTagValue(dataTags, 'GameType', TAG_INT, changes.gameType);
  if (changes.difficulty !== undefined) setTagValue(dataTags, 'Difficulty', TAG_BYTE, changes.difficulty);
  if (changes.hardcore !== undefined) setTagValue(dataTags, 'hardcore', TAG_BYTE, changes.hardcore ? 1 : 0);
  if (changes.allowCommands !== undefined) {
    setTagValue(dataTags, 'allowCommands', TAG_BYTE, changes.allowCommands ? 1 : 0);
  }

  const raw = writeNbt(root);
  fs.writeFileSync(levelDatPath, zlib.gzipSync(raw));
}

module.exports = { readLevelInfo, writeLevelInfo };

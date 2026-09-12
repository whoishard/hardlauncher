const crypto = require('crypto');

/**
 * Genera un UUID "offline" idéntico al que usa el propio cliente de Minecraft
 * cuando corre sin autenticar: un UUID v3 (basado en MD5) sobre el string
 * "OfflinePlayer:<username>". Esto es el mismo algoritmo que usa Mojang/Yggdrasil
 * en modo offline, por lo que el UUID resultante es determinista y válido
 * para servidores que corren en online-mode=false.
 */
function generateOfflineUUID(username) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest();

  // Ajustes de versión (0x30 = version 3) y variante (RFC 4122), igual que Mojang.
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString('hex');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join('-');
}

function isValidUsername(username) {
  // Minecraft permite 3-16 caracteres alfanuméricos y guion bajo.
  return /^[a-zA-Z0-9_]{3,16}$/.test(username);
}

/**
 * Crea una cuenta offline completa lista para usarse en el launcher.
 * El "accessToken" es un token local ficticio (no lo valida Mojang), suficiente
 * para que el cliente de Minecraft arranque en modo offline y para servidores
 * no-premium que no verifican contra Yggdrasil/Xbox Live.
 */
function createOfflineAccount(username, options = {}) {
  if (!isValidUsername(username)) {
    throw new Error('El nombre de usuario debe tener 3-16 caracteres (letras, números o "_").');
  }

  const uuid = generateOfflineUUID(username);
  const accessToken = crypto.randomBytes(16).toString('hex'); // token local, no verificado por Mojang

  return {
    id: `offline-${uuid}`,
    type: 'offline',
    username,
    uuid,
    accessToken,
    skinUrl: options.skinUrl || null, // URL externa opcional (ej. Ely.by, NameMC, etc.)
    skinSource: options.skinSource || 'default', // 'default' | 'url' | 'elyby'
    createdAt: Date.now(),
  };
}

/**
 * Integración opcional con Ely.by para obtener textura/capa de skin por username.
 * Ely.by expone texturas públicas sin requerir login, útiles para preview offline.
 */
function buildElyBySkinUrl(username) {
  return `https://minecraft.ely.by/skins/${encodeURIComponent(username)}.png`;
}

module.exports = {
  generateOfflineUUID,
  createOfflineAccount,
  isValidUsername,
  buildElyBySkinUrl,
};

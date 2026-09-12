const Store = require('electron-store');
const https = require('https');

// Caché PERSISTENTE (a disco, vía electron-store) de las caras de las
// cuentas guardadas.
//
// Antes de esto, "precargar" las caras significaba nada más que un
// `new Image()` en el renderer para calentar el caché HTTP de Chromium
// (ver el prefetchAccountFaces que había en store.js). El problema es que
// ese caché es volátil y vive DENTRO del proceso del renderer: cada vez
// que se cierra y se vuelve a abrir el launcher es un proceso nuevo, así
// que no importaba cuántas veces ya se hubiera visto esa cuenta antes, la
// imagen se volvía a pedir por red de cero — y como Crafatar tampoco manda
// cache-control agresivo, ni jugaba a favor. Por eso "seguía tardando"
// aunque ya se hubiera abierto el selector de cuentas mil veces.
//
// Acá se guarda la imagen ya bajada y en base64 en un archivo en disco
// (fuera del proceso, sobrevive a cerrar la app), así que de la segunda
// vez en adelante el avatar se pinta al instante con el archivo local, sin
// esperar ninguna respuesta de red. `prefetchAll` además dispara la
// descarga apenas arranca la app (ver electron/main.js), no recién cuando
// el usuario abre el desplegable.
const store = new Store({ name: 'account-faces' });

// 12 horas: suficiente para que un cambio de skin se note en un tiempo
// razonable, sin volver a descargar todo en cada arranque cuando lo más
// común es que nada haya cambiado.
const TTL_MS = 12 * 60 * 60 * 1000;

function fetchAsDataUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} pidiendo ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const mime = res.headers['content-type'] || 'image/png';
          resolve(`data:${mime};base64,${buffer.toString('base64')}`);
        });
      })
      .on('error', reject);
  });
}

async function refresh(key, remoteUrl) {
  try {
    const dataUrl = await fetchAsDataUrl(remoteUrl);
    store.set(key, { dataUrl, fetchedAt: Date.now() });
    return dataUrl;
  } catch (e) {
    // Sin internet, Crafatar caído, etc.: se deja lo que ya hubiera
    // guardado (si había algo) en vez de perderlo por un error puntual.
    return null;
  }
}

// Devuelve lo que ya esté guardado en disco AL INSTANTE, sin esperar red.
// Si no había nada guardado todavía, o lo guardado ya venció el TTL,
// dispara una descarga en segundo plano y avisa por `onFresh` cuando
// termine, para que quien preguntó pueda actualizar ese avatar puntual sin
// tocar nada más.
function getFace(key, remoteUrl, onFresh) {
  if (!key || !remoteUrl) return null;
  const cached = store.get(key) || null;
  const isStale = !cached || Date.now() - cached.fetchedAt > TTL_MS;
  if (isStale) {
    refresh(key, remoteUrl).then((dataUrl) => {
      if (dataUrl && onFresh) onFresh(dataUrl);
    });
  }
  return cached ? cached.dataUrl : null;
}

// Se llama una vez, apenas arranca la app (antes incluso de que el
// renderer termine de montar) — así, si el caché de alguna cuenta venció o
// nunca existió, la descarga ya está en marcha desde el primer instante en
// vez de recién dispararse cuando el usuario abre el selector de cuentas.
function prefetchAll(accounts, faceUrlFor) {
  for (const acc of accounts) {
    const remoteUrl = faceUrlFor(acc);
    if (remoteUrl) getFace(acc.id, remoteUrl, () => {});
  }
}

module.exports = { getFace, prefetchAll };

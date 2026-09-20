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
const { getConfigDir } = require('../shared/paths');

const store = new Store({ name: 'account-faces', cwd: getConfigDir() });

// 12 horas: suficiente para que un cambio de skin se note en un tiempo
// razonable, sin volver a descargar todo en cada arranque cuando lo más
// común es que nada haya cambiado.
const TTL_MS = 12 * 60 * 60 * 1000;

// BUG FIX (cuenta recién agregada se quedaba con la skin de Steve/Alex
// pegada): esto era un problema conocido de Crafatar (podía tardar un
// instante en ir a buscar la skin real a Mojang la primera vez que le
// preguntaban por un UUID nuevo, y mientras tanto respondía igual con
// `200 OK` pero con el dibujito de relleno) que se resolvía leyendo su
// header propio `X-Storage-Type`.
//
// CAMBIO: la cara de respaldo para premium ahora sale de mc-heads.net (ver
// AccountAvatar.jsx / accountFaceUrl en electron/main.js), que no manda ese
// header — así que FALLBACK_STORAGE_TYPES de acá abajo nunca hace match y
// este mecanismo queda inerte (isFallback siempre da `false`, TTL normal
// de 12hs siempre). No se saca el código porque no rompe nada dejarlo
// (y si algún día se resuelve remoteUrl con otra fuente que sí mande un
// header equivalente, sigue funcionando), pero ya no hay reintento rápido
// automático si mc-heads llegara a devolver un dibujito de relleno.
const FALLBACK_STORAGE_TYPES = new Set(['server error', 'server error;cached']);
// Si lo que llegó es de relleno, se guarda igual (para no dejar el
// avatar en blanco) pero con un TTL bien corto en vez de las 12 horas
// normales, así la próxima vez que alguien pida esta cara — aunque sea
// unos minutos después — se reintenta en vez de darla por buena.
const FALLBACK_TTL_MS = 20 * 1000;
// Además, no hace falta esperar a que alguien vuelva a pedir el avatar
// para reintentar: apenas se detecta que vino de relleno se reintenta
// solo, un par de veces, con estas demoras.
const FALLBACK_RETRY_DELAYS_MS = [3000, 8000];

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
          // En minúsculas y sin espacios de más: Node ya normaliza los
          // nombres de header a minúsculas, pero el VALOR ('server
          // error', 'server error;cached', etc.) lo manda Crafatar tal
          // cual, y de ahí sale el FALLBACK_STORAGE_TYPES de arriba.
          const storageType = (res.headers['x-storage-type'] || '').trim().toLowerCase();
          resolve({ dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, storageType });
        });
      })
      .on('error', reject);
  });
}

/**
 * Pide la cara y la guarda en disco. `onFresh` es opcional: además de
 * devolver la promesa con el resultado de ESTE intento, si Crafatar
 * contestó con el dibujito de relleno (ver FALLBACK_STORAGE_TYPES) se
 * reintenta solo un par de veces más (ver FALLBACK_RETRY_DELAYS_MS) y,
 * si algún reintento consigue la skin real, se avisa por `onFresh` — el
 * mismo callback que ya usa getFace() para el resultado normal, así que
 * a quien esté escuchando (ver 'auth:faceUpdated' en main.js /
 * AccountAvatar.jsx) no le importa si la cara buena llegó de una o
 * después de reintentar.
 */
function refresh(key, remoteUrl, onFresh, retriesLeft = FALLBACK_RETRY_DELAYS_MS.length) {
  return fetchAsDataUrl(remoteUrl)
    .then(({ dataUrl, storageType }) => {
      const isFallback = FALLBACK_STORAGE_TYPES.has(storageType);
      store.set(key, {
        dataUrl,
        fetchedAt: Date.now(),
        ttlMs: isFallback ? FALLBACK_TTL_MS : TTL_MS,
      });
      if (isFallback && retriesLeft > 0) {
        const delay = FALLBACK_RETRY_DELAYS_MS[FALLBACK_RETRY_DELAYS_MS.length - retriesLeft];
        setTimeout(() => {
          refresh(key, remoteUrl, onFresh, retriesLeft - 1).then((freshDataUrl) => {
            if (freshDataUrl && onFresh) onFresh(freshDataUrl);
          });
        }, delay);
      }
      return dataUrl;
    })
    .catch(() => {
      // Sin internet, mc-heads caído del todo (no solo con el relleno, un
      // error de red de verdad), etc.: se deja lo que ya hubiera guardado
      // (si había algo) en vez de perderlo por un error puntual.
      return null;
    });
}

// Devuelve lo que ya esté guardado en disco AL INSTANTE, sin esperar red.
// Si no había nada guardado todavía, o lo guardado ya venció su TTL (el
// normal de 12hs, o el corto de FALLBACK_TTL_MS si lo que se guardó la
// última vez fue el dibujito de relleno), dispara una descarga en segundo
// plano y avisa por `onFresh` cuando termine, para que quien preguntó
// pueda actualizar ese avatar puntual sin tocar nada más.
function getFace(key, remoteUrl, onFresh) {
  if (!key || !remoteUrl) return null;
  const cached = store.get(key) || null;
  const ttlMs = cached?.ttlMs ?? TTL_MS;
  const isStale = !cached || Date.now() - cached.fetchedAt > ttlMs;
  if (isStale) {
    refresh(key, remoteUrl, onFresh).then((dataUrl) => {
      if (dataUrl && onFresh) onFresh(dataUrl);
    });
  }
  return cached ? cached.dataUrl : null;
}

// Se llama una vez, apenas arranca la app (antes incluso de que el
// renderer termine de montar) — así, si el caché de alguna cuenta venció o
// nunca existió, la descarga ya está en marcha desde el primer instante en
// vez de recién dispararse cuando el usuario abre el selector de cuentas.
//
// `keyFor` es opcional (por defecto usa acc.id): electron/main.js la usa
// para precargar, con su propia clave separada (`acc.id:mchead`), la cara
// ya recortada de mc-heads sin que pise la entrada de la textura completa
// de la misma cuenta bajo `acc.id` — ver el comentario junto a donde se
// llama esta función en main.js para el porqué.
function prefetchAll(accounts, faceUrlFor, keyFor = (acc) => acc.id) {
  for (const acc of accounts) {
    const remoteUrl = faceUrlFor(acc);
    if (remoteUrl) getFace(keyFor(acc), remoteUrl, () => {});
  }
}

module.exports = { getFace, prefetchAll };

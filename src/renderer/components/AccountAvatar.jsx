import React, { useEffect, useState } from 'react';
import nosoyhardFace from '../assets/nosoyhard-face.png';

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

/**
 * Avatar de cuenta usado en el TopBar, el modal de cuentas y Ajustes.
 *
 * - Premium: se pide la cara por UUID a mc-heads (premiumFaceUrl), el mismo
 *   sistema que ya usa la Rich Presence de Discord para esto (ver
 *   discordFaceUrl en electron/main.js) — ya no depende de la textura
 *   completa de Mojang/Xbox (account.skinUrl), que en la práctica podía
 *   fallar en silencio y dejar el selector de cuentas sin cara aunque la
 *   Rich Presence sí la mostrara bien. Ver el comentario en remoteUrlFor
 *   más abajo para el porqué del cambio.
 * - No-Premium con skin propia (URL de Ely.by u otra fuente, o un archivo
 *   local subido a mano, guardada en account.skinUrl): mismo recorte local.
 * - No-Premium sin skin: la cara de la skin de NoSoyHard como default.
 * - Sin ningún tipo de skin resoluble: iniciales sobre un degradado propio
 *   del nombre.
 *
 * La imagen real NUNCA se pide directo a la red desde acá si se puede
 * evitar: se pide al proceso principal (auth:getFace, ver
 * src/auth/faceCache.js), que guarda cada cara ya descargada en disco. La
 * primera vez que se ve una cuenta en esta máquina sí hay que esperar la
 * red (como antes), pero de ahí en adelante — incluso después de cerrar y
 * volver a abrir el launcher — se pinta al instante con el archivo local,
 * sin depender del caché volátil del navegador ni de que el servicio remoto
 * responda rápido.
 */
const MAX_RETRIES = 3;

// Antes cada instancia de este componente pedía la cara con el tamaño en
// pixeles de SU propio contenedor (32px en el TopBar, 28px en el selector de
// cuentas, 36px en Ajustes...). Como el servicio de avatares cachea por URL
// completa (con el "size" incluido), esto generaba una URL distinta en cada
// lugar del launcher. Ahora se pide siempre este único tamaño fijo
// (suficiente para verse nítida incluso en el uso más grande) y el propio
// <img> la escala hacia abajo donde haga falta — y, más importante, es la
// MISMA URL que usa faceCache.js del lado del proceso principal (ver
// PREMIUM_FACE_SIZE en electron/main.js) para que el caché en disco
// siempre haga match con lo que este componente termina pidiendo.
const PREMIUM_FACE_SIZE = 128;

// CAMBIO: antes esto pedía la cara a Crafatar (crafatar.com/avatars/...).
// Se pasa a mc-heads.net (mismo tipo de servicio: cara 2D con overlay/hat a
// partir del UUID, sin necesidad de resolver nada del lado del launcher) por
// reportes repetidos de Crafatar devolviendo Steve/Alex de relleno o
// tardando/fallando en resolver cuentas ya válidas. El "true" final pide la
// segunda capa (hat/overlay) — equivalente al "&overlay" que se usaba antes.
export function premiumFaceUrl(uuid, cacheBust = '') {
  return `https://mc-heads.net/avatar/${uuid}/${PREMIUM_FACE_SIZE}/true${cacheBust}`;
}

// Clave de caché separada de account.id (usada por cachedSrc/remoteUrlFor)
// para que la cara YA recortada de mc-heads nunca comparta entrada de
// disco con una textura completa de la misma cuenta.
function faceCacheKeyFor(account) {
  return account ? `${account.id}:mchead` : null;
}

function remoteUrlFor(account) {
  if (!account) return null;
  // BUG FIX (selector de cuentas sin cara para jugadores premium, aunque la
  // Rich Presence de Discord sí la mostraba bien): antes, para premium, acá
  // se priorizaba la URL de textura oficial (account.skinUrl, de
  // textures.minecraft.net) por sobre mc-heads, y esa textura se pedía por
  // HTTPS aparte desde faceCache.js/el propio renderer. En la práctica ese
  // pedido fallaba en silencio para bastantes cuentas (lento, bloqueado,
  // etc.) y el selector se quedaba sin nada que mostrar — mientras que la
  // Rich Presence (discordFaceUrl en electron/main.js) SIEMPRE le pide la
  // cara a mc-heads por UUID, sin pasar por textures.minecraft.net para
  // nada, y por eso a esa sí se le veía la cara sin problema.
  //
  // Ahora el selector usa exactamente el mismo sistema que la Rich Presence
  // para premium: la rama `account.type === 'premium' && account.uuid' más
  // abajo en el propio componente, que pide siempre mc-heads por UUID (ver
  // premiumFaceUrl) en vez de depender de la textura completa. Por eso acá
  // ya no se devuelve nada para premium — esta función (que alimenta el
  // recorte de sprite de textura completa) queda solo para la skin propia
  // de cuentas no-premium (Ely.by u otra fuente, o un archivo subido a
  // mano).
  if (account.type === 'premium') return null;
  // Una skin propia guardada localmente queda como data URL: no hay nada
  // que pedirle a auth:getFace por red, y más abajo (account.skinUrl) ya
  // se usa directo como src/fondo.
  if (account.skinUrl && account.skinUrl.startsWith('data:')) return null;
  return account.skinUrl || null;
}

export default function AccountAvatar({ account, size = 32, radius, className = '' }) {
  // Estados separados para cada fuente de imagen: si la textura propia
  // (skinUrl, premium o no) se termina dando por vencida, tiene que poder
  // caer en Crafatar (solo para premium) empezando de cero, no arrastrando
  // el mismo estado "broken" de la otra fuente.
  const [premiumBroken, setPremiumBroken] = useState(false);
  const [premiumAttempt, setPremiumAttempt] = useState(0);
  const [premiumLoaded, setPremiumLoaded] = useState(false);
  const [skinUrlBroken, setSkinUrlBroken] = useState(false);
  const [skinUrlAttempt, setSkinUrlAttempt] = useState(0);

  // Lo que ya haya guardado en disco para esta cuenta (data URL), si hay
  // algo. Apenas se conoce la cuenta se pregunta acá abajo; en la enorme
  // mayoría de los casos (cualquier cuenta que ya se haya visto antes en
  // esta máquina) esto llega con la cara YA lista, sin pasar por la red.
  // Corresponde siempre a la URL que devuelve remoteUrlFor(account) — que
  // ahora es SIEMPRE una textura completa (Mojang u otra fuente de skin
  // completa), nunca la cara ya recortada de mc-heads: ver el comentario
  // largo en remoteUrlFor de por qué mezclar las dos acá rompía el
  // recorte por sprite.
  const [cachedSrc, setCachedSrc] = useState(null);

  // Igual que cachedSrc de arriba, pero para la cara YA recortada de
  // mc-heads (el respaldo de cuentas premium sin skinUrl guardada). Se
  // cachea aparte, con su propia clave en faceCache.js (ver
  // faceCacheKeyFor más abajo), precisamente para NO terminar mezclada con
  // cachedSrc y evitar que el recorte por sprite (layerBg) se le vuelva a
  // aplicar por error a una imagen que ya viene recortada.
  const [cachedFaceSrc, setCachedFaceSrc] = useState(null);

  // Sin este reset, si en algún momento una imagen no cargaba (ej. sin
  // internet un instante, o el servicio remoto caído), el estado quedaba en
  // "true" para siempre en este componente — y como en TopBar el avatar de
  // la cuenta activa es la MISMA instancia de componente entre un cambio de
  // cuenta y otro (no se desmonta), después de eso cualquier cuenta que se
  // seleccionara (incluso una premium con skin real) se quedaba mostrando
  // el círculo con la inicial en vez de volver a intentar cargar la cara.
  useEffect(() => {
    setPremiumBroken(false);
    setPremiumAttempt(0);
    setPremiumLoaded(false);
    setSkinUrlBroken(false);
    setSkinUrlAttempt(0);
    setCachedSrc(null);
    setCachedFaceSrc(null);

    if (!account || !window.hardLauncher?.auth?.getFace) return;

    let cancelled = false;
    const unsubscribers = [];

    const url = remoteUrlFor(account);
    if (url) {
      // Devuelve al toque lo que ya hubiera en disco. Si no había nada
      // guardado todavía (o venció), el proceso principal ya arrancó esa
      // descarga en segundo plano solo; el resultado llega por el evento de
      // abajo, no hace falta pedir de nuevo ni sondear.
      window.hardLauncher.auth.getFace(account.id, url).then((dataUrl) => {
        if (!cancelled && dataUrl) setCachedSrc(dataUrl);
      });
      const unsubscribe = window.hardLauncher.auth.onFaceUpdated?.((payload) => {
        if (payload?.accountId === account.id && payload.dataUrl) setCachedSrc(payload.dataUrl);
      });
      if (unsubscribe) unsubscribers.push(unsubscribe);
    }

    // Premium: mismo sistema que la Rich Presence de Discord (ver
    // discordFaceUrl en electron/main.js) — se pide siempre mc-heads por
    // UUID, tenga o no la cuenta una skinUrl guardada (ver el comentario en
    // remoteUrlFor de por qué ya no se depende de esa textura completa).
    // Se cachea en disco bajo su propia clave (faceCacheKeyFor) así, de la
    // segunda vez en adelante, pinta al instante sin esperar red, sin
    // arriesgarse a mezclarla con cachedSrc.
    if (account.type === 'premium' && account.uuid) {
      const faceKey = faceCacheKeyFor(account);
      const faceUrl = premiumFaceUrl(account.uuid);
      window.hardLauncher.auth.getFace(faceKey, faceUrl).then((dataUrl) => {
        if (!cancelled && dataUrl) setCachedFaceSrc(dataUrl);
      });
      const unsubscribeFace = window.hardLauncher.auth.onFaceUpdated?.((payload) => {
        if (payload?.accountId === faceKey && payload.dataUrl) setCachedFaceSrc(payload.dataUrl);
      });
      if (unsubscribeFace) unsubscribers.push(unsubscribeFace);
    }

    return () => {
      cancelled = true;
      unsubscribers.forEach((fn) => fn());
    };
  }, [account?.id, account?.uuid, account?.skinUrl]);

  // La cara premium (ya sea la textura propia o, en su defecto, mc-heads)
  // fallaba en cargar de forma persistente aunque el servicio funcionara
  // bien: un solo error de red al vuelo (típico al abrir la app, antes de
  // que haya internet, o un timeout puntual) dejaba el avatar roto para
  // siempre, porque nada lo volvía a intentar hasta que cambiara de cuenta.
  // Ahora, ante un error se reintenta unas pocas veces con una URL
  // "cache-busteada" (para no pegarle otra vez a la misma respuesta fallida
  // cacheada) antes de rendirse. Esto solo entra en juego cuando todavía no
  // hay nada en cachedSrc (primera vez que se ve la cuenta en esta
  // máquina) — con caché en disco ya resuelto, ni se pide la URL remota.
  function handlePremiumError() {
    setPremiumAttempt((a) => {
      if (a + 1 >= MAX_RETRIES) {
        setPremiumBroken(true);
        return a;
      }
      return a + 1;
    });
  }

  function handleSkinUrlError() {
    setSkinUrlAttempt((a) => {
      if (a + 1 >= MAX_RETRIES) {
        setSkinUrlBroken(true);
        return a;
      }
      return a + 1;
    });
  }

  if (!account) return null;

  const r = radius ?? Math.max(6, Math.round(size * 0.28));
  const baseStyle = { width: size, height: size, borderRadius: r, overflow: 'hidden', flexShrink: 0 };

  const isDataSkin = Boolean(account.skinUrl && account.skinUrl.startsWith('data:'));
  const isRemoteSkin = Boolean(account.skinUrl && !isDataSkin);

  // BUG FIX (avatar premium se quedaba gris para siempre): antes, mientras
  // no había nada todavía en cachedSrc, esta rama usaba directo
  // `account.skinUrl` (para premium: la URL de Mojang, 64x64 sin recortar)
  // como backgroundImage — es decir, el propio renderer salía a pedir esa
  // imagen por red, en paralelo/por fuera del caché en disco de
  // faceCache.js. Ese pedido puntual puede tardar muchísimo (¡se vio un
  // caso real de 20+ segundos en el Network tab de DevTools!) o directamente
  // no resolver nunca desde el proceso de la ventana — y como el
  // desplegable de cuentas desmonta este componente al cerrarse
  // (TopBar.jsx: `{showDropdown && (...)}`), cualquiera que cerrara el
  // desplegable antes de que ese pedido terminara perdía el resultado y
  // volvía a arrancar de cero la próxima vez que lo abriera: nunca llegaba
  // a verlo resuelto, quedaba gris para siempre en la práctica aunque el
  // pedido en sí no estuviera realmente roto.
  //
  // Ahora esta rama SOLO se usa cuando hay una fuente que no necesita salir
  // a pedir nada por red desde acá: una skin local (data:, no hace falta
  // red) o ya resuelta en cachedSrc (bajada por el PROCESO PRINCIPAL vía
  // auth:getFace/faceCache.js, que además la deja guardada en disco — no se
  // pierde aunque se cierre el desplegable). Mientras cachedSrc todavía no
  // llegó para una skin remota, se sigue de largo a la rama de abajo
  // (Crafatar/mc-heads para premium, un <img> chico y más simple, mucho más
  // liviano que la textura completa) en vez de quedarse esperando acá.
  if ((isDataSkin || cachedSrc) && !skinUrlBroken) {
    const scale = size / 8;
    const src = isDataSkin ? account.skinUrl : cachedSrc;
    // Antes se recortaban las dos capas con <img> + transform: scale/translate,
    // que en algunos casos terminaba pintando solo la capa base y dejando la
    // "segunda capa" (hat/overlay, el cuadrado de 8x8 en x=40,y=8) sin
    // mostrarse — el transform en un <img> grande dentro de un contenedor con
    // overflow:hidden no siempre compone bien con el layer de abajo en
    // Chromium. Se reemplaza por dos divs con background-image +
    // background-position, la técnica estándar (la misma que usa mc-heads
    // internamente) para recortar sprites de una textura: no depende de
    // transforms superpuestos, así que ambas capas quedan garantizadas.
    const layerBg = (offsetX) => ({
      position: 'absolute',
      inset: 0,
      backgroundImage: `url(${src})`,
      backgroundSize: `${scale * 64}px ${scale * 64}px`,
      backgroundPosition: `-${scale * offsetX}px -${scale * 8}px`,
      backgroundRepeat: 'no-repeat',
      imageRendering: 'pixelated',
    });
    return (
      <div
        className={'account-avatar ' + className}
        style={{ ...baseStyle, background: 'var(--bg-panel-alt)', position: 'relative' }}
      >
        {/* Capa base (8,8) */}
        <div style={layerBg(8)} />
        {/* Capa overlay/hat (40,8), pintada arriba de la base */}
        <div style={layerBg(40)} />
        {/* <img> oculta solo para poder detectar si la textura no carga
            (los divs con background-image no disparan onError) y así, en
            premium, caer a mc-heads como respaldo (ver más abajo), o en
            no-premium, a las iniciales. Con src siempre local (data: o un
            data: ya bajado a disco en cachedSrc), esto prácticamente nunca
            debería fallar — se deja como red de seguridad ante un base64
            corrupto u otro caso raro, no por una carga de red que pueda
            demorarse. */}
        <img
          key={`base-${skinUrlAttempt}`}
          src={src}
          alt=""
          onError={handleSkinUrlError}
          style={{ display: 'none' }}
        />
      </div>
    );
  }

  // Sin textura propia utilizable todavía: para premium, mientras
  // cachedSrc de arriba no haya llegado (o si la fuente propia ya se dio
  // por rota), se muestra de respaldo la cara de mc-heads por UUID — un
  // pedido bastante más liviano que la textura completa, así que suele
  // resolver rápido. Si en el medio cachedSrc termina llegando (evento
  // auth:faceUpdated, ver el useEffect de arriba), el próximo render ya
  // entra por la rama de arriba y se reemplaza solo, sin que el usuario
  // tenga que hacer nada.
  if (account.type === 'premium' && account.uuid && !premiumBroken) {
    const cacheBust = premiumAttempt > 0 ? `?_retry=${premiumAttempt}` : '';
    const craftarCachedSrc = cachedFaceSrc;
    // Si ya hay algo guardado en disco para ESTA url se usa directo
    // (instantáneo, sin red). Solo se cae a pedirle a mc-heads en caliente
    // cuando esta cuenta nunca se vio antes en esta máquina (o la textura
    // propia falló y esto es un respaldo en frío).
    const src = craftarCachedSrc || premiumFaceUrl(account.uuid, cacheBust);
    const ready = premiumLoaded || Boolean(craftarCachedSrc);
    return (
      <div
        // El shimmer solo tiene sentido mientras de verdad se está
        // esperando red (sin nada en disco todavía); si ya vino de
        // craftarCachedSrc no hay nada que "cargar", se pinta directo.
        className={'account-avatar ' + className + (!ready ? ' account-avatar-loading' : '')}
        style={{
          ...baseStyle,
          background: 'var(--bg-panel-alt)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          key={craftarCachedSrc ? 'cached' : premiumAttempt}
          src={src}
          alt=""
          // Si mc-heads no responde (caído, sin internet un instante), no se
          // salta directo a la inicial: se reintenta un par de veces y,
          // recién si sigue sin cargar, se rinde a la inicial.
          onError={handlePremiumError}
          onLoad={() => setPremiumLoaded(true)}
          // La cara de mc-heads viene recortada casi al pixel (sin margen
          // propio), así que estirarla al 100% del contenedor la dejaba
          // pegada al borde redondeado y se sentía "encuadrada de más" /
          // cortada en las esquinas. Se deja un margen (como en Modrinth,
          // que muestra la cara con aire alrededor sobre el fondo del
          // avatar) en vez de que ocupe el cuadrado entero.
          style={{
            width: '78%',
            height: '78%',
            display: 'block',
            imageRendering: 'pixelated',
            opacity: ready ? 1 : 0,
            // Con algo ya resuelto desde disco (craftarCachedSrc) no hay
            // fade: se pinta directo desde el primer frame, no tendría
            // sentido animar una carga que no existió. El fade-in queda
            // solo para el caso realmente en frío (primera vez que se ve la
            // cuenta, o respaldo tras fallar la textura propia).
            transition: craftarCachedSrc ? 'none' : 'opacity 0.15s ease-out',
          }}
        />
      </div>
    );
  }

  // No-premium sin skin propia guardada: en vez de las iniciales sobre un
  // degradado, se usa la cara de la skin de NoSoyHard como cara por
  // defecto para toda cuenta offline/no-premium — recorte plano (8x8,
  // capa base) de la textura real de esa skin, de frente, igual que
  // cualquier otra skin que se recorta más arriba con account.skinUrl.
  if (account.type === 'offline') {
    return (
      <div
        className={'account-avatar ' + className}
        style={{ ...baseStyle, background: 'var(--bg-panel-alt)' }}
      >
        <img
          src={nosoyhardFace}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }

  const hue = hashHue(account.username || '?');
  return (
    <div
      className={'account-avatar account-avatar-fallback ' + className}
      style={{
        ...baseStyle,
        background: `linear-gradient(135deg, hsl(${hue}, 70%, 55%), hsl(${(hue + 40) % 360}, 65%, 38%))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 700,
        fontSize: Math.max(10, Math.round(size * 0.42)),
      }}
    >
      {(account.username || '?').charAt(0).toUpperCase()}
    </div>
  );
}

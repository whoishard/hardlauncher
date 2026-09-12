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
 * - Premium: se pide la cabeza directamente a Crafatar usando el UUID de la
 *   cuenta (no una URL de skin guardada en el momento del login). Así, si el
 *   jugador cambia de skin en minecraft.net, el avatar del launcher se
 *   actualiza solo la próxima vez que se pinte, sin guardar nada nuevo acá.
 * - No-Premium con skin propia (URL de Ely.by u otra fuente, guardada en
 *   account.skinUrl): se recorta el bloque de cara (8x8) de la textura vía
 *   CSS, dejando la base lista para cuando exista el selector de skins.
 * - No-Premium sin skin: iniciales sobre un degradado propio del nombre.
 *
 * La imagen real (premium o skinUrl) NUNCA se pide directo a la red desde
 * acá si se puede evitar: se pide al proceso principal (auth:getFace, ver
 * src/auth/faceCache.js), que guarda cada cara ya descargada en disco. La
 * primera vez que se ve una cuenta en esta máquina sí hay que esperar la
 * red (como antes), pero de ahí en adelante — incluso después de cerrar y
 * volver a abrir el launcher — se pinta al instante con el archivo local,
 * sin depender del caché volátil del navegador ni de que Crafatar responda
 * rápido.
 */
const MAX_RETRIES = 3;

// Antes cada instancia de este componente pedía la cara a Crafatar con el
// tamaño en pixeles de SU propio contenedor (32px en el TopBar, 28px en el
// selector de cuentas, 36px en Ajustes...). Como Crafatar cachea por URL
// completa (con el "size" incluido), esto generaba una URL distinta en cada
// lugar del launcher. Ahora se pide siempre este único tamaño fijo
// (suficiente para verse nítida incluso en el uso más grande) y el propio
// <img> la escala hacia abajo donde haga falta — y, más importante, es la
// MISMA URL que usa faceCache.js del lado del proceso principal (ver
// PREMIUM_FACE_SIZE en electron/main.js) para que el caché en disco
// siempre haga match con lo que este componente termina pidiendo.
const PREMIUM_FACE_SIZE = 128;

export function premiumFaceUrl(uuid, cacheBust = '') {
  return `https://crafatar.com/avatars/${uuid}?size=${PREMIUM_FACE_SIZE}&overlay${cacheBust}`;
}

function remoteUrlFor(account) {
  if (!account) return null;
  if (account.type === 'premium' && account.uuid) return premiumFaceUrl(account.uuid);
  // Una skin propia guardada localmente queda como data URL: no hay nada
  // que pedirle a auth:getFace por red, y más abajo (account.skinUrl) ya
  // se usa directo como src/fondo.
  if (account.skinUrl && account.skinUrl.startsWith('data:')) return null;
  return account.skinUrl || null;
}

export default function AccountAvatar({ account, size = 32, radius, className = '' }) {
  // Estados separados para cada fuente de imagen: si la cara premium de
  // Crafatar se termina dando por vencida, tiene que poder caer en la
  // skinUrl guardada (si existe) empezando de cero, no arrastrando el
  // mismo estado "broken" de Crafatar.
  const [premiumBroken, setPremiumBroken] = useState(false);
  const [premiumAttempt, setPremiumAttempt] = useState(0);
  const [premiumLoaded, setPremiumLoaded] = useState(false);
  const [skinUrlBroken, setSkinUrlBroken] = useState(false);
  const [skinUrlAttempt, setSkinUrlAttempt] = useState(0);

  // Lo que ya haya guardado en disco para esta cuenta (data URL), si hay
  // algo. Apenas se conoce la cuenta se pregunta acá abajo; en la enorme
  // mayoría de los casos (cualquier cuenta que ya se haya visto antes en
  // esta máquina) esto llega con la cara YA lista, sin pasar por la red.
  const [cachedSrc, setCachedSrc] = useState(null);

  // Sin este reset, si en algún momento una imagen no cargaba (ej. sin
  // internet un instante, o Crafatar caído), el estado quedaba en "true"
  // para siempre en este componente — y como en TopBar el avatar de la
  // cuenta activa es la MISMA instancia de componente entre un cambio de
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

    const url = remoteUrlFor(account);
    if (!account || !url || !window.hardLauncher?.auth?.getFace) return;

    let cancelled = false;
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
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [account?.id, account?.uuid, account?.skinUrl]);

  // La cara premium fallaba en cargar de forma persistente aunque Crafatar
  // funcionara bien: un solo error de red al vuelo (típico al abrir la app,
  // antes de que haya internet, o un timeout puntual del servicio) dejaba
  // el avatar roto para siempre, porque nada lo volvía a intentar hasta que
  // cambiara de cuenta. Ahora, ante un error se reintenta unas pocas veces
  // con una URL "cache-busteada" (para no pegarle otra vez a la misma
  // respuesta fallida cacheada) antes de rendirse a la inicial. Esto solo
  // entra en juego cuando todavía no hay nada en cachedSrc (primera vez
  // que se ve la cuenta en esta máquina) — con caché en disco ya resuelto,
  // ni se pide la URL remota.
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

  if (account.type === 'premium' && account.uuid && !premiumBroken) {
    const cacheBust = premiumAttempt > 0 ? `&_retry=${premiumAttempt}` : '';
    // Si ya hay algo guardado en disco se usa directo (instantáneo, sin
    // red). Solo se cae a pedirle a Crafatar en caliente cuando esta
    // cuenta nunca se vio antes en esta máquina.
    const src = cachedSrc || premiumFaceUrl(account.uuid, cacheBust);
    const ready = premiumLoaded || Boolean(cachedSrc);
    return (
      <div
        // El shimmer solo tiene sentido mientras de verdad se está
        // esperando red (sin nada en disco todavía); si ya vino de
        // cachedSrc no hay nada que "cargar", se pinta directo.
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
          key={cachedSrc ? 'cached' : premiumAttempt}
          src={src}
          alt=""
          // Si Crafatar no responde (caído, sin internet un instante), no se
          // salta directo a la inicial: se reintenta un par de veces y,
          // recién si sigue sin cargar, se prueba la skinUrl guardada (ej.
          // cuentas migradas u offline con skin propia) antes de rendirse a
          // la inicial.
          onError={handlePremiumError}
          onLoad={() => setPremiumLoaded(true)}
          // La cara de Crafatar viene recortada casi al pixel (sin margen
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
            // Con algo ya resuelto desde disco (cachedSrc) no hay fade: se
            // pinta directo desde el primer frame, no tendría sentido
            // animar una carga que no existió. El fade-in queda solo para
            // el caso realmente en frío (primera vez que se ve la cuenta).
            transition: cachedSrc ? 'none' : 'opacity 0.15s ease-out',
          }}
        />
      </div>
    );
  }

  if (account.skinUrl && !skinUrlBroken) {
    const scale = size / 8;
    const src = cachedSrc || account.skinUrl;
    // Antes se recortaban las dos capas con <img> + transform: scale/translate,
    // que en algunos casos terminaba pintando solo la capa base y dejando la
    // "segunda capa" (hat/overlay, el cuadrado de 8x8 en x=40,y=8) sin
    // mostrarse — el transform en un <img> grande dentro de un contenedor con
    // overflow:hidden no siempre compone bien con el layer de abajo en
    // Chromium. Se reemplaza por dos divs con background-image +
    // background-position, la técnica estándar (la misma que usa Crafatar
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
        className={'account-avatar ' + className + (!cachedSrc ? ' account-avatar-loading' : '')}
        style={{ ...baseStyle, background: 'var(--bg-panel-alt)', position: 'relative' }}
      >
        {/* Capa base (8,8) */}
        <div style={layerBg(8)} />
        {/* Capa overlay/hat (40,8), pintada arriba de la base */}
        <div style={layerBg(40)} />
        {/* <img> oculta solo para poder detectar si la textura no carga
            (los divs con background-image no disparan onError) y así caer
            al fallback de iniciales. */}
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

  // No-premium sin skin propia guardada: en vez de las iniciales sobre un
  // degradado, se usa la cara de la skin de NoSoyHard como cara por
  // defecto para toda cuenta offline/no-premium — recorte plano (8x8,
  // capa base) de la textura real de esa skin, de frente, igual que
  // cualquier otra skin que se recorta más abajo con account.skinUrl.
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

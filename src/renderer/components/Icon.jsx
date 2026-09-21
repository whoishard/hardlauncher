import React from 'react';

const PATHS = {
  home: <path d="M4 12L12 5l8 7M6 10.5V19a1 1 0 001 1h3v-5h4v5h3a1 1 0 001-1v-8.5" strokeLinecap="round" strokeLinejoin="round" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      {/* Rombo hueco (solo trazo, sin relleno) centrado y rotado sobre el
          eje NE-SO, calcado del logo circular de Modrinth en vez de la
          aguja rellena anterior (que se leía más como un cursor de mouse
          que como una brújula). */}
      <path d="M16.3 7.7L9.6 9.6L7.7 16.3L14.4 14.4Z" strokeLinejoin="round" />
    </>
  ),
  layers: <path d="M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4" strokeLinecap="round" strokeLinejoin="round" />,
  // Selector de skins: una remera simple (mismo espíritu que el ícono que
  // usa Modrinth App para esta misma sección).
  shirt: (
    <path
      d="M8 4L4 7v3h2.5V19a1 1 0 001 1h9a1 1 0 001-1V10H20V7l-4-3-2 2h-4L8 4z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  gear: (
    // Antes esto era un círculo con 8 líneas rectas finas saliendo derecho
    // hacia afuera — de lejos se leía como un sol, no como un engranaje de
    // ajustes. Se cambia por un ícono de tuerca/engranaje con dientes
    // redondeados reales (mismo estilo que usa Modrinth), que se reconoce
    // de inmediato como "Ajustes".
    <>
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" strokeLinecap="round" />,
  folder: <path d="M3 7a1 1 0 011-1h4.5l1.5 2H20a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V7z" strokeLinecap="round" strokeLinejoin="round" />,
  // Triángulo con las tres puntas redondeadas (cada vértice se "corta" a un
  // par de puntos sobre sus dos lados y se une con una curva cuadrática con
  // control en el vértice original): solo contorno, sin relleno, calcado
  // del ícono de "Play" pedido por el usuario. Ya había pasado por acá antes
  // (ver historial): con el contorno a igual "size" que el resto de los
  // íconos se leía chico y débil al lado del label del botón "Jugar", porque
  // un triángulo hueco ocupa mucha menos superficie visual que uno relleno.
  // Esta vez, en lugar de volver a rellenarlo (que ya no matchea la imagen
  // de referencia), se compensa con un trazo más grueso que el del resto de
  // los íconos (strokeWidth propio en vez de heredar el del <svg>) y
  // agrandando el "size" en cada lugar donde se usa (ver esos call sites).
  play: (
    <path
      d="M7 7.3L7 16.7Q7 18.5 8.55 17.58L16.45 12.92Q18 12 16.45 11.08L8.55 6.42Q7 5.5 7 7.3Z"
      strokeLinejoin="round"
      strokeWidth={2.4}
      fill="none"
    />
  ),
  palette: (
    <path
      d="M12 3a9 9 0 100 18c1.1 0 1.7-.9 1.2-1.8-.3-.5-.1-1.2.5-1.2h1.6A3.7 3.7 0 0019 14.5C19.6 8.4 16.3 3 12 3z M7.5 12a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zM10.5 8a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zM15 8a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zM16.8 11.7a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6z"
      strokeLinejoin="round"
    />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" strokeLinecap="round" />
    </>
  ),
  gamepad: (
    <path
      d="M7 9h10a4 4 0 014 4v2a2.5 2.5 0 01-4.5 1.5L15 15H9l-1.5 1.5A2.5 2.5 0 013 15v-2a4 4 0 014-4z M8 11v2M7 12h2M15.5 12.5h.01M17.5 11h.01"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  cup: (
    <>
      <path d="M5 5h11v8a4 4 0 01-4 4H9a4 4 0 01-4-4V5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 8h1.5a2.5 2.5 0 010 5H16" strokeLinecap="round" />
      <path d="M4 20h13" strokeLinecap="round" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" strokeLinecap="round" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  check: <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />,
  chevronDown: <path d="M5 8l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />,
  close: <path d="M5 5l14 14M19 5L5 19" strokeLinecap="round" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 8v.01" strokeLinecap="round" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.3-4.3" strokeLinecap="round" />
    </>
  ),
  upload: (
    <path
      d="M12 15V4M12 4L7.5 8.5M12 4l4.5 4.5M5 16.5V19a2 2 0 002 2h10a2 2 0 002-2v-2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  refresh: (
    <path
      d="M20 11a8 8 0 10-1.6 4.8M20 11V6m0 5h-5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  trash: (
    <path
      d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0l-.8 12.1a2 2 0 01-2 1.9H8.8a2 2 0 01-2-1.9L6 7h12zM10 11v6M14 11v6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  dots: (
    <>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  // Usado en el menú de "..." de un contenido instalado para "Congelar
  // versión" (evita que se lo detecte/actualice solo mientras está
  // congelado) — mismo estilo de candado simple que el resto de los
  // íconos de este set.
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1.6" />
      <path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1.6" />
      <path d="M8 11V7a4 4 0 017.6-1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  package: (
    <path
      d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5L12 12l8-4.5M12 12v9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" fill="currentColor" stroke="none" />
      <path d="M4 16.5l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  sparkles: (
    <path
      d="M11 3l1.4 4.1L16.5 8.5l-4.1 1.4L11 14l-1.4-4.1L5.5 8.5l4.1-1.4L11 3zM18 13.5l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8.8-2.3z"
      strokeLinejoin="round"
    />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  download: (
    <path
      d="M12 3v11.5M7.5 10.5L12 15l4.5-4.5M5 19h14"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  heart: (
    <path
      d="M12 20.5s-7.2-4.4-9.9-8.9C.4 8 1.7 4.3 5.4 4.3c2.1 0 3.5 1.2 4.4 2.4.9-1.2 2.3-2.4 4.4-2.4 3.7 0 5 3.7 3.3 7.3-2.7 4.5-9.9 8.9-9.9 8.9z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />,
  // Usado en la tabla de versiones (fila) para "instalar esta versión" —
  // dos flechas cruzadas, igual al ícono de "cambiar/instalar" de Modrinth.
  swap: (
    <path
      d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Usado para "abrir en Modrinth" (enlace externo) en la tabla de versiones.
  externalLink: (
    <path
      d="M14 4h6v6M20 4l-9.5 9.5M9 5H6.5A2.5 2.5 0 004 7.5v10A2.5 2.5 0 006.5 20h10a2.5 2.5 0 002.5-2.5V15"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  link: (
    <path
      d="M9.5 14.5l5-5M8 17l-1.5 1.5a3.5 3.5 0 01-5-5L3 12M16 7l1.5-1.5a3.5 3.5 0 015 5L21 12"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Pestaña "Ventana" del panel de ajustes de instancia.
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16.5V20" strokeLinecap="round" />
    </>
  ),
  // Pestaña "Java y memoria".
  cpu: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <rect x="10" y="10" width="4" height="4" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" strokeLinecap="round" />
    </>
  ),
  // Pestaña "Launch hooks" (comandos / código).
  code: <path d="M9 8l-5 4 5 4M15 8l5 4-5 4" strokeLinecap="round" strokeLinejoin="round" />,
  // Pestaña "Instalación".
  wrench: (
    <path
      d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.7 2.7-2-2 2.7-2.7z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Botón "Duplicar instancia" en General.
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Ilustración de "sin contenido instalado" (pestaña Contenido, y estados
  // vacíos similares): una bandeja de entrada, igual concepto que usa
  // Modrinth para su estado vacío.
  // Barras de señal, para el ping de un servidor.
  signal: (
    <path
      d="M4 20v-4M9 20v-8M14 20v-12M19 20V4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Botón "Aleatorio" del Estudio de íconos: un dado de 5 (patrón clásico).
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  // Chip "Nether" en las tarjetas de mundo (pestaña Mundos).
  flame: (
    <path
      d="M12 3c1 3-2.5 4-2.5 7a2.5 2.5 0 005 0c1.2 1 2 2.6 2 4.2A4.7 4.7 0 0112 19a4.7 4.7 0 01-4.5-4.8c0-3 1.7-4.6 2.5-6.2.6-1.2.7-3 2-5z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Chip "El End" en las tarjetas de mundo (pestaña Mundos).
  moon: (
    <>
      <path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 1010.5 10.5z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16.5" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  // Renombrar mundo / campos editables cortos.
  pencil: (
    <path
      d="M4 20l.9-3.9L15.6 5.4a1.5 1.5 0 012.1 0l1 1a1.5 1.5 0 010 2.1L8 19.2 4 20z M13.5 7.5l3 3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  alertTriangle: (
    <>
      <path d="M12 3.5L2.5 20h19L12 3.5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10v4.5" strokeLinecap="round" />
      <circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 12h4.5l1.5 3h6l1.5-3H21" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M5.5 5h13a1 1 0 01.95.68L21 12v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6l1.55-6.32A1 1 0 015.5 5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  // Archivo genérico (pestaña "Archivos" del detalle de instancia): hoja con
  // la esquina doblada, igual al glifo que usan CurseForge/Modrinth App para
  // cualquier archivo sin ícono de tipo propio.
  file: (
    <path
      d="M7 3h7l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z M14 3v4h4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  chevronRight: <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />,
  maximize: <path d="M9 4H4v5M15 20h5v-5M20 9V4h-5M4 15v5h5" strokeLinecap="round" strokeLinejoin="round" />,
  minimize2: <path d="M4 9h5V4M20 4l-6.5 6.5M20 15h-5v5M4 20l6.5-6.5" strokeLinecap="round" strokeLinejoin="round" />,
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />,
  wrapText: (
    <>
      <path d="M4 6h16M4 12h11a3 3 0 010 6h-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 15.5L15 18l2.5-1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 18h5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

export default function Icon({ name, size = 18, strokeWidth = 1.8, className, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      // "icon-gear" solo se usa para poder engancharle la animación de giro
      // al pasar el cursor por encima (ver .icon-gear en theme.css).
      className={[name === 'gear' ? 'icon-gear' : null, className].filter(Boolean).join(' ') || undefined}
      style={{ flexShrink: 0, transformOrigin: '50% 50%', ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}

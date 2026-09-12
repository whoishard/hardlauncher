// Datos del editor de íconos de instancia: una paleta de colores de fondo
// para el "cubito" de la instancia (el mismo cuadrado con degradé suave que
// ya se usaba antes de que existiera este modal, ver InstanceIcon.jsx), un
// pequeño set de formas geométricas simples para ese cubito (no ítems ni
// criaturas — ver comentario de ICON_SHAPES más abajo), más las utilidades
// para redimensionar una imagen propia subida por el usuario.

// Formas para el "cubito": a diferencia del set de símbolos que se probó y
// se sacó (ítems/bloques/criaturas estilo Minecraft), esto es un puñado de
// figuras genéricas — cubo, rombo, hexágono, círculo, estrella, rayo,
// corazón, escudo — el mismo tipo de ícono abstracto que usaría cualquier
// selector de "avatar" de una app. No referencian ningún objeto, bloque ni
// criatura del juego, así que no vuelven a la idea que se descartó. Cada
// una es un único path plano (sin bisel) sobre un lienzo de 16x16, se
// dibuja en blanco semitransparente sobre el fondo elegido y con la misma
// sombrita apoyada que el resto de los íconos generados acá.
export const ICON_SHAPES = [
  {
    id: 'cube',
    label: 'Cubo',
    faces: [
      { d: 'M8 3 L13 5.2 L8 7.4 L3 5.2 Z', opacity: 0.95 },
      { d: 'M3 5.2 L8 7.4 L8 13 L3 10.8 Z', opacity: 0.78 },
      { d: 'M13 5.2 L8 7.4 L8 13 L13 10.8 Z', opacity: 0.62 },
    ],
  },
  { id: 'diamond', label: 'Rombo', d: 'M8 2 L14 8 L8 14 L2 8 Z' },
  { id: 'hexagon', label: 'Hexágono', d: 'M8 1.5 L13.5 4.75 L13.5 11.25 L8 14.5 L2.5 11.25 L2.5 4.75 Z' },
  { id: 'circle', label: 'Círculo', d: 'M13.2 8a5.2 5.2 0 11-10.4 0 5.2 5.2 0 0110.4 0z' },
  {
    id: 'star',
    label: 'Estrella',
    d: 'M8 1.8 L9.53 5.9 L13.9 6.08 L10.47 8.8 L11.65 13.02 L8 10.6 L4.36 13.02 L5.53 8.8 L2.1 6.08 L6.47 5.9 Z',
  },
  { id: 'bolt', label: 'Rayo', d: 'M9 1 L4 9 L7.2 9 L6 15 L12 6.5 L8.4 6.5 Z' },
  {
    id: 'heart',
    label: 'Corazón',
    d: 'M8 13.5 C4 10 1.5 7.7 1.5 5.3 C1.5 3.2 3.1 2 4.8 2 C6.2 2 7.3 2.9 8 4 C8.7 2.9 9.8 2 11.2 2 C12.9 2 14.5 3.2 14.5 5.3 C14.5 7.7 12 10 8 13.5 Z',
  },
  { id: 'shield', label: 'Escudo', d: 'M8 1.5 L13.5 3.3 V8.2 C13.5 11.6 11.2 13.8 8 14.8 C4.8 13.8 2.5 11.6 2.5 8.2 V3.3 Z' },
];

export function getShape(id) {
  return ICON_SHAPES.find((s) => s.id === id) || null;
}

/** Sombra elíptica suave apoyada bajo la forma elegida, mismo lugar en las
 * 3 instancias donde se dibuja: grilla de selección, preview grande, e
 * ícono final compuesto. */
export const SHADOW_ELLIPSE = { cx: 8, cy: 14.6, rx: 5.4, ry: 1.15, opacity: 0.28 };

// Paleta de fondos: gama amplia (acento del launcher + variedad tipo
// "tintes" de Minecraft) para que cada instancia se distinga bien en la
// grilla de instancias.
export const BACKGROUND_SWATCHES = [
  '#7c3aed',
  '#a78bfa',
  '#2563eb',
  '#0ea5e9',
  '#0d9488',
  '#16a34a',
  '#65a30d',
  '#ca8a04',
  '#d97706',
  '#ea580c',
  '#dc2626',
  '#e11d48',
  '#db2777',
  '#9333ea',
  '#475569',
  '#1e293b',
  '#78716c',
  '#0f766e',
];

/** Aclara (percent > 0) u oscurece (percent < 0) un color hex "#rrggbb". */
export function shade(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  let r = (num >> 16) + amt;
  let g = ((num >> 8) & 0xff) + amt;
  let b = (num & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Piezas de un fondo con degradé suave (en vez de color plano) para el
 * cuadrado de fondo del ícono — más luz arriba a la izquierda, un poco más
 * oscuro abajo a la derecha, mismo esquema de luz que el bisel de arriba. */
export function backgroundGradientStops(bg) {
  return { from: shade(bg, 16), to: shade(bg, -8) };
}

/** Redimensiona la imagen elegida por el usuario a un cuadrado (máx.
 * 256x256) antes de guardarla como data URL, para no inflar el archivo de
 * instancias con fotos de varios MB directo de la cámara del usuario.
 * (Se comparte entre la pestaña "Imagen personalizada" del estudio y el
 * drag&drop rápido del selector chico.) */
const MAX_UPLOAD_DIMENSION = 256;

export function fileToResizedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const out = Math.min(MAX_UPLOAD_DIMENSION, side);
        const canvas = document.createElement('canvas');
        canvas.width = out;
        canvas.height = out;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
        resolve(canvas.toDataURL('image/png', 0.92));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Compone el color de fondo + la forma elegida (si hay) en un PNG cuadrado
 * de `size`x`size`, devuelto como data URL — el mismo formato que ya
 * entiende InstanceIcon (icon = data URL o null), así que no hace falta
 * tocar el store ni el proceso principal para nada de esto. El fondo va
 * como degradé suave y la forma en blanco semitransparente con una
 * sombrita apoyada (ver SHADOW_ELLIPSE arriba), el mismo "cubito" que ya
 * se usaba antes de este modal, ahora con forma elegible. */
export function composeIconDataUrl(bg, shapeId, size = 256) {
  const shape = getShape(shapeId);
  const { from, to } = backgroundGradientStops(bg);
  const parts = [
    `<defs><linearGradient id="bgg" x1="0" y1="0" x2="16" y2="16">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`,
    `<rect width="16" height="16" fill="url(#bgg)"/>`,
  ];
  if (shape) {
    const s = SHADOW_ELLIPSE;
    parts.push(`<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="#000" opacity="${s.opacity}"/>`);
    if (shape.faces) {
      for (const f of shape.faces) {
        parts.push(`<path d="${f.d}" fill="#ffffff" opacity="${f.opacity}"/>`);
      }
    } else {
      parts.push(`<path d="${shape.d}" fill="#ffffff" opacity="0.92"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${parts.join('')}</svg>`;
  const svgUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('No se pudo generar el ícono.'));
    img.src = svgUrl;
  });
}

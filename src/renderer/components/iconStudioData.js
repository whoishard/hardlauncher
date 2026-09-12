// Datos del editor de íconos de instancia: una paleta de colores de fondo
// para el "cubito" de la instancia (el mismo cuadrado con degradé suave que
// ya se usaba antes de que existiera este modal, ver InstanceIcon.jsx), un
// pequeño set de formas geométricas simples para ese cubito (no ítems ni
// criaturas — ver comentario de ICON_SHAPES más abajo), más las utilidades
// para redimensionar una imagen propia subida por el usuario.
//
// La paleta y las formas en sí viven en src/shared/iconPalette.json (datos
// planos, sin código de navegador) para poder reusarse tal cual desde
// electron/../src/core/randomInstanceIcon.js, que corre en el proceso
// principal (sin DOM/canvas) y genera el ícono default aleatorio de una
// instancia nueva con exactamente esta misma paleta — así el "azar" del
// ícono default y el del botón "Aleatorio" de este estudio salen siempre
// del mismo universo de combinaciones, nunca se desincronizan.
import iconPalette from '../../shared/iconPalette.json';

// Formas para el "cubito": a diferencia del set de símbolos que se probó y
// se sacó (ítems/bloques/criaturas estilo Minecraft), esto es un puñado de
// figuras genéricas — cubo, rombo, hexágono, círculo, estrella, rayo,
// corazón, escudo — el mismo tipo de ícono abstracto que usaría cualquier
// selector de "avatar" de una app. No referencian ningún objeto, bloque ni
// criatura del juego, así que no vuelven a la idea que se descartó. Cada
// una es un único path plano (sin bisel) sobre un lienzo de 16x16, se
// dibuja en blanco semitransparente sobre el fondo elegido y con la misma
// sombrita apoyada que el resto de los íconos generados acá.
export const ICON_SHAPES = iconPalette.shapes;

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
export const BACKGROUND_SWATCHES = iconPalette.backgrounds;

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

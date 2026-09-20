// Datos del editor de íconos de instancia: una paleta de colores de fondo
// para el "cubito" de la instancia (el mismo cuadrado con degradé suave que
// ya se usaba antes de que existiera este modal, ver InstanceIcon.jsx), una
// paleta de colores para el rubí, más las utilidades para redimensionar una
// imagen propia subida por el usuario.
//
// La paleta en sí vive en src/shared/iconPalette.json (datos planos, sin
// código de navegador) para poder reusarse tal cual desde
// electron/../src/core/randomInstanceIcon.js, que corre en el proceso
// principal (sin DOM/canvas) y genera el ícono default aleatorio de una
// instancia nueva con exactamente esta misma paleta — así el "azar" del
// ícono default y el del botón "Aleatorio" de este estudio salen siempre
// del mismo universo de combinaciones, nunca se desincronizan.
import iconPalette from '../../shared/iconPalette.json';

// El símbolo del "cubito" de instancia es siempre el mismo: un rubí simple
// y tridimensional (3 facetas planas con distinto brillo — misma técnica de
// "3 caras con sombreado" que ya se usaba para el cubo isométrico que había
// antes acá, ver iconPalette.json) más un pequeño brillo especular fijo. Se
// probaron antes bibliotecas de símbolos elegibles (formas genéricas tipo
// avatar, y antes de eso ítems/bloques/criaturas estilo Minecraft) y ambas
// se sacaron: ahora el editor de íconos ya no deja elegir *qué* símbolo va
// en el cubito, sólo de qué color es el fondo y de qué color es el rubí.
export const RUBY_SHAPE = iconPalette.ruby;

// Paleta de colores del rubí: el primero es el mismo rojo "acento" que usa
// todo el resto del launcher (--accent-primary en theme.css), así el rubí
// que sale por default en toda instancia nueva combina con la marca de la
// app sin que el usuario tenga que tocar nada.
export const RUBY_COLOR_SWATCHES = iconPalette.rubyColors;
export const RUBY_DEFAULT_COLOR = RUBY_COLOR_SWATCHES[0];

/** Sombra elíptica suave apoyada bajo el rubí, mismo lugar en las 3
 * instancias donde se dibuja: grilla de selección, preview grande, e ícono
 * final compuesto. */
export const SHADOW_ELLIPSE = { cx: 8, cy: 14.6, rx: 5.4, ry: 1.15, opacity: 0.28 };

// BUG FIX ("el rubí queda más grande al guardar que en el editor"): el
// preview en vivo del estudio (RubyGlyph en IconStudioModal.jsx) dibuja el
// rubí dentro de una caja de 76px (ver .icon-studio-preview en theme.css)
// con harto fondo alrededor. El PNG final (composeIconDataUrl, más abajo)
// en cambio estiraba el mismo dibujo para llenar el canvas ENTERO (100%,
// sin margen), así que salía mucho más grande que lo que se eligió mirando
// el preview. Esta es esa misma proporción (tamaño del RubyGlyph / 76)
// llevada a factor de escala: rubySvgParts la usa para achicar el rubí
// alrededor de su propio centro antes de estamparlo sobre el fondo a
// pantalla completa, así el PNG guardado queda con la misma proporción
// rubí/fondo que se vio al elegirlo.
// Subido de 44/76 a 50/76: el rubí se pidió "un poco más grande, no mucho"
// — sigue siendo la misma proporción que el tamaño del RubyGlyph en el
// preview grande del estudio (ver size={50} en IconStudioModal.jsx), así
// que el PNG final sigue guardando exactamente lo que se ve al elegirlo.
export const RUBY_PREVIEW_SCALE = 50 / 76;

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

/** Arma los fragmentos SVG (string) del rubí — sombra apoyada + 3 facetas
 * sombreadas a partir de `rubyColor` + brillo especular fijo — para poder
 * reusar exactamente el mismo dibujo tanto en el PNG final (canvas, acá
 * abajo) como en el SVG en vivo del preview/grilla del estudio (ver
 * RubyGlyph en IconStudioModal.jsx), sin duplicar las coordenadas en dos
 * lugares que se puedan desincronizar. */
export function rubySvgParts(rubyColor) {
  const s = SHADOW_ELLIPSE;
  const h = RUBY_SHAPE.highlight;
  const inner = [
    `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="#000" opacity="${s.opacity}"/>`,
  ];
  // BUG FIX: la costura semi-transparente entre facetas (ver fix anterior,
  // mismo comentario abajo) se tapa con un contorno sólido debajo — eso no
  // cambió acá, sólo ahora todo el grupo (sombra + contorno + facetas +
  // brillo) se achica junto, envuelto en el <g scale(...)> de más abajo.
  inner.push(`<path d="${RUBY_SHAPE.outline}" fill="${shade(rubyColor, -10)}"/>`);
  for (const f of RUBY_SHAPE.facets) {
    inner.push(`<path d="${f.d}" fill="${shade(rubyColor, f.shade)}"/>`);
  }
  // BUG FIX: el brillo especular venía con un fill="#ffffff" fijo,
  // completamente aparte de `rubyColor` — era la única pieza del rubí que
  // de verdad no seguía al color elegido (las 3 facetas de arriba sí usan
  // `shade(rubyColor, ...)`), así que con cualquier color que no fuera
  // blanco quedaba un brillito blanco puro pegado encima que no combinaba,
  // y con colores oscuros se notaba mucho más como una manchita suelta sin
  // relación con el resto. Ahora sale de aclarar bastante el propio
  // rubyColor (85%, más claro que la faceta más clara de arriba, que sólo
  // se aclara 42%) en vez de un blanco fijo: sigue leyéndose como un brillo
  // (queda casi blanco para casi cualquier color) pero ahora sí es ese
  // color, no uno pegado aparte.
  inner.push(
    `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${shade(rubyColor, 85)}" opacity="${h.opacity}" transform="rotate(${h.rotate} ${h.cx} ${h.cy})"/>`
  );
  // Achica el rubí entero (ver RUBY_PREVIEW_SCALE arriba) alrededor
  // de su propio centro (8,8 — el centro del viewBox de 16x16), para que
  // deje la misma proporción de fondo alrededor que se ve en el preview
  // en vivo del estudio, en vez de llenar el cuadro entero.
  return [
    `<g transform="translate(8 8) scale(${RUBY_PREVIEW_SCALE}) translate(-8 -8)">${inner.join('')}</g>`,
  ];
}

/** Compone el color de fondo + el rubí (color elegible) en un PNG cuadrado
 * de `size`x`size`, devuelto como data URL — el mismo formato que ya
 * entiende InstanceIcon (icon = data URL o null), así que no hace falta
 * tocar el store ni el proceso principal para nada de esto. El fondo va
 * como degradé suave y el rubí con sus 3 facetas sombreadas + brillo
 * especular (ver rubySvgParts arriba), el mismo símbolo fijo en todas las
 * instancias, sólo cambia de color. */
export function composeIconDataUrl(bg, rubyColor = RUBY_DEFAULT_COLOR, size = 256) {
  const { from, to } = backgroundGradientStops(bg);
  const parts = [
    // BUG FIX ("el fondo sale más claro al guardar que en el editor"): sin
    // gradientUnits="userSpaceOnUse", un <linearGradient> usa por defecto
    // objectBoundingBox, donde x1/y1/x2/y2 son FRACCIONES (0 a 1) del
    // cuadro del elemento, no coordenadas del viewBox. Con x2="16" y2="16"
    // interpretados como fracciones, el punto final del degradé queda 16
    // veces más lejos que el propio rect de 16x16 — el rect entero
    // terminaba pintando solo el primer ~6% del recorrido (casi puro
    // "from", el tono claro), sin llegar nunca al "to" oscuro que sí se ve
    // en el preview (que usa un linear-gradient de CSS, con sus propias
    // coordenadas). userSpaceOnUse hace que x1/y1/x2/y2 sean coordenadas
    // reales del viewBox (0,0 a 16,16 = las dos esquinas opuestas del
    // propio rect), igual que el degradé del preview.
    `<defs><linearGradient id="bgg" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`,
    `<rect width="16" height="16" fill="url(#bgg)"/>`,
    ...rubySvgParts(rubyColor),
  ];
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

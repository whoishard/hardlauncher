import React from 'react';
import Icon from './Icon.jsx';

// Los glifos de Fabric, Forge, NeoForge y Quilt son los íconos reales que
// sirve la propia API pública de Modrinth (GET /v2/tag/loader — la misma
// que ya se usa en FilterBar.jsx), pensada justamente para que apps de
// terceros los usen para identificar el loader. Vanilla no es un "loader"
// para Modrinth (no tiene ícono ahí), así que ese sigue siendo un bloque de
// pasto dibujado a mano, que no pretende ser el logo de nadie.
export const LOADER_BADGES = {
  vanilla: { glyph: 'grassBlock', color: '#5c8a2e' },
  fabric: { glyph: 'fabric', color: '#8a6a42' },
  forge: { glyph: 'forge', color: '#1c2942' },
  neoforge: { glyph: 'neoforge', color: '#d35400' },
  quilt: { glyph: 'quilt', color: '#5b2a86' },
};

const QUILT_PATCH_D =
  'M442.5 233.9c0-6.4-5.2-11.6-11.6-11.6h-197c-6.4 0-11.6 5.2-11.6 11.6v197c0 6.4 5.2 11.6 11.6 11.6h197c6.4 0 11.6-5.2 11.6-11.7v-197Z';

// El pasto de Vanilla queda en su propia grilla de 16x16 pixel-art; los del
// resto de los loaders vienen tal cual los publica Modrinth en viewBox
// "0 0 24 24", coloreados con currentColor (por eso el `style={{ color }}`
// en vez de un `fill` fijo). El contenedor (.instance-icon-badge) es
// circular con overflow:hidden, así que pueden "sangrar" hasta el borde
// sin dejar cuadraditos feos en las esquinas.
export function LoaderGlyph({ glyph, size, color = '#fff' }) {
  switch (glyph) {
    case 'grassBlock':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
          <rect x="0" y="0" width="16" height="16" fill="#7bb33f" />
          <rect x="0" y="4" width="16" height="12" fill="#8a5a2e" />
          <rect x="0" y="4" width="16" height="2.5" fill="#5c8a2e" />
          <rect x="2" y="1" width="2" height="2" fill="#6a9a35" opacity="0.7" />
          <rect x="9" y="2" width="2" height="1.5" fill="#6a9a35" opacity="0.7" />
          <rect x="5" y="9" width="2" height="2" fill="#79532a" opacity="0.6" />
          <rect x="11" y="11" width="2" height="2" fill="#79532a" opacity="0.6" />
        </svg>
      );
    // Fabric: el rollo de tela de su ícono oficial (viene tal cual lo
    // publica la API de Modrinth, GET /v2/tag/loader). El path usa
    // coordenadas gigantes (compatibles con un lienzo de ~1000px) reducidas
    // con el transform de abajo — por eso el strokeWidth también va en esa
    // escala original (23), no en el valor ya escalado (~2px): puesto
    // directamente en "2" quedaba en ~0.17px después de la transformación,
    // es decir prácticamente invisible.
    case 'fabric':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ color }} fill="none">
          <path
            stroke="currentColor"
            strokeWidth="23"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m820 761-85.6-87.6c-4.6-4.7-10.4-9.6-25.9 1-19.9 13.6-8.4 21.9-5.2 25.4 8.2 9 84.1 89 97.2 104 2.5 2.8-20.3-22.5-6.5-39.7 5.4-7 18-12 26-3 6.5 7.3 10.7 18-3.4 29.7-24.7 20.4-102 82.4-127 103-12.5 10.3-28.5 2.3-35.8-6-7.5-8.9-30.6-34.6-51.3-58.2-5.5-6.3-4.1-19.6 2.3-25 35-30.3 91.9-73.8 111.9-90.8"
            transform="matrix(.08671 0 0 .0867 -49.8 -56)"
          />
        </svg>
      );
    // Forge: el yunque de su ícono oficial.
    case 'forge':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ color }} fill="none">
          <path
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2 7.5h8v-2h12v2s-7 3.4-7 6 3.1 3.1 3.1 3.1l.9 3.9H5l1-4.1s3.8.1 4-2.9c.2-2.7-6.5-.7-8-6Z"
          />
        </svg>
      );
    // NeoForge: el zorro de su ícono oficial.
    case 'neoforge':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ color }} fill="none">
          <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
            <path d="m12 19.2v2m0-2v2" />
            <path d="m8.4 1.3c0.5 1.5 0.7 3 0.1 4.6-0.2 0.5-0.9 1.5-1.6 1.5m8.7-6.1c-0.5 1.5-0.7 3-0.1 4.6 0.2 0.6 0.9 1.5 1.6 1.5" />
            <path d="m3.6 15.8h-1.7m18.5 0h1.7" />
            <path d="m3.2 12.1h-1.7m19.3 0h1.8" />
            <path d="m8.1 12.7v1.6m7.8-1.6v1.6" />
            <path d="m10.8 18h1.2m0 1.2-1.2-1.2m2.4 0h-1.2m0 1.2 1.2-1.2" />
            <path d="m4 9.7c-0.5 1.2-0.8 2.4-0.8 3.7 0 3.1 2.9 6.3 5.3 8.2 0.9 0.7 2.2 1.1 3.4 1.1m0.1-17.8c-1.1 0-2.1 0.2-3.2 0.7m11.2 4.1c0.5 1.2 0.8 2.4 0.8 3.7 0 3.1-2.9 6.3-5.3 8.2-0.9 0.7-2.2 1.1-3.4 1.1m-0.1-17.8c1.1 0 2.1 0.2 3.2 0.7" />
            <path d="m4 9.7c-0.2-1.8-0.3-3.7 0.5-5.5s2.2-2.6 3.9-3m11.6 8.5c0.2-1.9 0.3-3.7-0.5-5.5s-2.2-2.6-3.9-3" />
            <path d="m12 21.2-2.4 0.4m2.4-0.4 2.4 0.4" />
          </g>
        </svg>
      );
    // Quilt: los 4 parches (3 cuadrados + 1 rombo) de su ícono oficial
    // (también viene tal cual lo publica la API de Modrinth). Mismo caso que
    // Fabric arriba: las coordenadas del parche están en una escala grande
    // reducida por el transform, así que el strokeWidth va en esa escala
    // original (65.6 para los 3 parches chicos, 70.4 para el rombo grande)
    // y no en el valor final ya escalado — si no, terminan casi invisibles.
    // (Se repite el mismo `d` de parche con 4 transforms distintos en vez
    // de <use xlink:href>, para no chocar ids cuando hay varias insignias
    // de Quilt renderizadas a la vez en la grilla de instancias.)
    case 'quilt':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ color }} fill="none">
          <path stroke="currentColor" strokeWidth="65.6" d={QUILT_PATCH_D} transform="matrix(.03053 0 0 .03046 -3.2 -3.2)" />
          <path stroke="currentColor" strokeWidth="65.6" d={QUILT_PATCH_D} transform="matrix(.03053 0 0 .03046 -3.2 7)" />
          <path stroke="currentColor" strokeWidth="65.6" d={QUILT_PATCH_D} transform="matrix(.03053 0 0 .03046 6.9 -3.2)" />
          <path
            stroke="currentColor"
            strokeWidth="70.4"
            d="M442.5 234.8c0-7-5.6-12.5-12.5-12.5H234.7c-6.8 0-12.4 5.6-12.4 12.5V430c0 6.9 5.6 12.5 12.4 12.5H430c6.9 0 12.5-5.6 12.5-12.5V234.8Z"
            transform="rotate(45 3.5 24) scale(.02843 .02835)"
          />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * Ícono de la instancia: la imagen personalizada si el usuario subió una, o
 * si no, siempre el mismo cuadradito verde con el glifo de caja/cubo en
 * blanco — el mismo placeholder "sin ícono" que usa Modrinth para
 * proyectos que no subieron uno propio, en vez de un color generado por
 * instancia (antes cada instancia tenía su propio degradé según el hash de
 * su nombre; ahora todas comparten el mismo default reconocible, y lo que
 * distingue a cada una es su ícono personalizado cuando lo tiene). Insignia
 * con el mod loader en la esquina cuando no es Vanilla, en ambos casos.
 */
export default function InstanceIcon({ name, loader, icon, size = 44, radius }) {
  const badge = LOADER_BADGES[loader];
  const r = radius ?? Math.max(6, Math.round(size * 0.24));

  const badgeSize = Math.max(14, Math.round(size * 0.42));

  if (icon) {
    return (
      <div
        className="instance-icon instance-icon-custom"
        style={{ width: size, height: size, borderRadius: r, backgroundImage: `url(${icon})` }}
      >
        {badge && (
          <span
            className="instance-icon-badge"
            style={{ background: badge.color, width: badgeSize, height: badgeSize }}
            title={loader}
          >
            <LoaderGlyph glyph={badge.glyph} size={badgeSize * 0.72} />
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="instance-icon instance-icon-default"
      style={{ width: size, height: size, borderRadius: r }}
    >
      <Icon name="package" size={size * 0.56} strokeWidth={1.6} />
      {badge && (
        <span
          className="instance-icon-badge"
          style={{ background: badge.color, width: badgeSize, height: badgeSize }}
          title={loader}
        >
          <LoaderGlyph glyph={badge.glyph} size={badgeSize * 0.72} />
        </span>
      )}
    </div>
  );
}


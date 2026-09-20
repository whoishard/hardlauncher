import React from 'react';

/**
 * Fondo ambiental fijo detrás de toda la app. Reemplaza la versión anterior
 * (tomada de "BackgroundEffects" de Solaris Launcher: un halo difuso girando
 * con dos anillos infinitos encima y una trama isométrica en diagonal) por
 * algo con menos movimiento y más relación con el producto: una cuadrícula
 * cuadrada fina, como una mesa de crafteo, con un puñado de celdas quietas
 * marcadas en el color de acento, y un resplandor cálido anclado arriba —
 * sin nada rotando de forma perpetua. Se monta una sola vez en App.jsx.
 */
export default function AmbientBackground() {
  return (
    <div className="ambient-bg" aria-hidden="true">
      <div className="ambient-bg-grid" />
      <div className="ambient-bg-cell ambient-bg-cell--a" />
      <div className="ambient-bg-cell ambient-bg-cell--b" />
      <div className="ambient-bg-cell ambient-bg-cell--c" />
      <div className="ambient-bg-glow" />
    </div>
  );
}

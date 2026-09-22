import { useRef } from 'react';

/**
 * PERF FIX (lag/tirones en el Explorador al instalar un mod): el progreso de
 * descarga llega por IPC una vez por cada chunk de datos recibido (ver
 * downloadFile en modInstaller.js) — varias veces por segundo, más seguido
 * todavía con mods grandes o conexiones rápidas. Antes ese progreso vivía en
 * un useState de ExploreView, así que CADA tick volvía a renderizar toda la
 * vista: se reconstruía el array completo de resultados (hasta 100 filas,
 * ver PAGE_SIZE_OPTIONS), la barra de filtros, la paginación, etc. React.memo
 * en ResultRow evitaba que esas filas se repintaran en el DOM, pero la sola
 * reconciliación de ese árbol entero varias veces por segundo ya se sentía
 * como el lag reportado — sobre todo si el jugador seguía escribiendo en el
 * buscador o scrolleando mientras tanto.
 *
 * Esta store vive fuera de React (en un ref, nunca en un useState): guarda
 * el último valor de progreso y notifica a un puñado de listeners chicos en
 * vez de disparar un re-render del componente que la crea. Combinada con
 * useSyncExternalStore en el único lugar que de verdad necesita pintar el
 * progreso (InstallProgressBar, en ExploreView.jsx), un tick actualiza
 * ÚNICAMENTE esa piecita puntual — nunca ExploreView ni el resto de las
 * filas.
 *
 * Lazy-init con useRef (en vez de crear el objeto en cada render y quedarnos
 * con el primero via useState(() => ...)) para que el objeto devuelto sea
 * siempre la MISMA referencia durante toda la vida del componente: así puede
 * pasarse como prop a un componente memoizado (ResultRow) sin que ese solo
 * hecho ya cuente como "cambió una prop" en cada render de ExploreView.
 */
export default function useInstallProgressStore() {
  const storeRef = useRef(null);

  if (!storeRef.current) {
    let value = null; // { percent: number | null, file: string } | null
    const listeners = new Set();

    storeRef.current = {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot() {
        return value;
      },
      set(next) {
        value = next;
        listeners.forEach((listener) => listener());
      },
    };
  }

  return storeRef.current;
}

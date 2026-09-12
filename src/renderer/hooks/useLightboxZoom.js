import { useEffect, useRef, useState } from 'react';

/**
 * Estado y manejo de "zoom + arrastre" para un visor de imagen en grande
 * (capturas de instancia y galería de mods/resourcepacks comparten esta
 * misma lógica en vez de duplicarla cada uno con su propio manejo de mouse).
 *
 * - Click sobre la imagen: alterna entre ajustada al visor y con zoom.
 * - Con el zoom activo, arrastrar con el mouse recorre la imagen (además
 *   del scroll nativo del contenedor, que también sigue funcionando).
 * - resetKey: cuando cambia (ej. al pasar a la siguiente imagen dentro del
 *   mismo visor), se vuelve a la vista ajustada en vez de arrastrar el
 *   zoom que había quedado de la imagen anterior.
 */
export default function useLightboxZoom(resetKey) {
  const [zoomed, setZoomed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const bodyRef = useRef(null);
  const dragRef = useRef(null);
  // Distingue un click (alterna zoom) de un arrastre (recorre la imagen):
  // sin esto, soltar el mouse después de arrastrar también dispara el
  // click nativo del navegador y desactivaría el zoom recién usado.
  const movedRef = useRef(false);

  useEffect(() => {
    setZoomed(false);
  }, [resetKey]);

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current || !bodyRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
      bodyRef.current.scrollLeft = dragRef.current.scrollLeft - dx;
      bodyRef.current.scrollTop = dragRef.current.scrollTop - dy;
    }
    function onUp() {
      dragRef.current = null;
      setDragging(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function onImageMouseDown(e) {
    // Antes el preventDefault() quedaba DENTRO del if de más abajo, o sea que
    // solo se aplicaba una vez ya zoomeado. En el primer click (para recién
    // activar el zoom) el navegador quedaba libre de iniciar su propio
    // drag-and-drop nativo de imagen ante el mousedown+mínimo movimiento del
    // mouse — algo que Chromium hace mucho más agresivamente con imágenes
    // remotas (como la galería de mods, cargada desde Modrinth) que con las
    // capturas locales. Ese drag nativo se come el click siguiente, así que
    // el zoom nunca llegaba a activarse ni, una vez zoomeado, se podía
    // arrastrar para recorrer la imagen. Sacando el preventDefault() del if
    // se anula ese drag nativo siempre, tanto en el click que activa el zoom
    // como mientras se está arrastrando ya zoomeado.
    e.preventDefault();
    if (!zoomed || !bodyRef.current) return;
    movedRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: bodyRef.current.scrollLeft,
      scrollTop: bodyRef.current.scrollTop,
    };
    setDragging(true);
  }

  function onImageClick() {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    setZoomed((z) => !z);
  }

  // Refuerza lo de arriba: sin esto, el navegador puede igual arrancar un
  // drag-and-drop nativo de la imagen (mostrando el ícono de "copiar/soltar")
  // en vez de dejar que el mousedown/mousemove propios manejen el arrastre,
  // sobre todo con imágenes cargadas desde una URL remota.
  function onImageDragStart(e) {
    e.preventDefault();
  }

  return { zoomed, dragging, bodyRef, onImageMouseDown, onImageClick, onImageDragStart };
}

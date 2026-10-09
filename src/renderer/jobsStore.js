import { create } from 'zustand';
import { useAppStore } from './store.js';

/**
 * Estado de las importaciones/instalaciones en segundo plano (ver
 * src/core/importJobs.js en el proceso principal). Vive en el renderer fuera
 * de cualquier modal: así el progreso sigue visible aunque se cierre el
 * asistente de "Crear instancia" o se cambie de pantalla.
 */
export const useJobsStore = create((set, get) => ({
  jobs: [], // los más nuevos primero
  // Job que el modal de "Crear instancia" está mostrando en este momento: el
  // panel flotante lo oculta mientras tanto para no duplicar el mismo progreso.
  watchedJobId: null,
  panelCollapsed: false,

  setWatched(id) {
    set({ watchedJobId: id });
  },
  setPanelCollapsed(collapsed) {
    set({ panelCollapsed: collapsed });
  },

  replaceAll(list) {
    set({ jobs: [...list].sort((a, b) => b.startedAt - a.startedAt) });
  },

  upsert(job) {
    const prev = get().jobs.find((j) => j.id === job.id);
    const jobs = prev
      ? get().jobs.map((j) => (j.id === job.id ? job : j))
      : [job, ...get().jobs];
    set({ jobs });

    // La instancia se crea apenas empieza la importación (antes de descargar
    // nada): se refresca la lista para que aparezca en Inicio/Instancias/
    // Sidebar en tiempo real, y otra vez al terminar para que muestre su
    // contenido final.
    const instanceAppeared = job.instanceId && prev?.instanceId !== job.instanceId;
    const justFinished = prev?.status === 'running' && job.status !== 'running';
    if (instanceAppeared || justFinished) {
      useAppStore.getState().refreshInstances?.();
    }
  },

  // Registra el snapshot que devolvió el proceso principal al arrancar un job,
  // pero SOLO si todavía no llegó por 'jobs:update': el evento puede ser más
  // nuevo que ese snapshot inicial y no hay que pisarlo con datos viejos.
  adopt(job) {
    if (!job || get().jobs.some((j) => j.id === job.id)) return;
    get().upsert(job);
  },

  async dismiss(id) {
    set({ jobs: get().jobs.filter((j) => j.id !== id) });
    try {
      await window.hardLauncher.jobs.dismiss(id);
    } catch {
      /* ya no existe del lado del proceso principal */
    }
  },

  async clearFinished() {
    set({ jobs: get().jobs.filter((j) => j.status === 'running') });
    try {
      await window.hardLauncher.jobs.clearFinished();
    } catch {
      /* nada que hacer */
    }
  },
}));

let initialized = false;

/** Se llama una sola vez (ver ImportJobsPanel): carga lo que haya y se suscribe a las novedades. */
export function initJobs() {
  if (initialized) return;
  initialized = true;
  const api = window.hardLauncher?.jobs;
  if (!api) return;
  api
    .list()
    .then((list) => useJobsStore.getState().replaceAll(list || []))
    .catch(() => {});
  api.onUpdate((job) => useJobsStore.getState().upsert(job));
}

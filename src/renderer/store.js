import { create } from 'zustand';

let toastCounter = 0;

export const useAppStore = create((set, get) => ({
  activeAccount: null,
  accounts: [],
  instances: [],
  logs: [],
  toasts: [],
  settings: null,
  // Instancia actualmente en ejecución (o preparándose para correr), para el
  // indicador global de la barra de título. null = ninguna corriendo.
  runningInstance: null,
  // Mientras ExploreView.jsx muestra el progreso de una instalación
  // "inline" (en el mismo rectángulo del mod/modpack, ver
  // ExploreView.jsx), este flag le dice al toast flotante global
  // (InstallProgressToast.jsx) que no se muestre — evita que la misma
  // instalación se vea duplicada, una vez adentro de la fila y otra vez
  // como ventanita en la esquina. Si ExploreView se desmonta a mitad de
  // una instalación (el usuario navegó a otra pantalla), se limpia solo
  // (ver el cleanup del useEffect en ExploreView) para que el toast
  // vuelva a aparecer y la instalación no quede "invisible".
  inlineInstallActive: false,
  setInlineInstallActive(active) {
    set({ inlineInstallActive: active });
  },
  // Ajustes del launcher: apartado propio (modal) que se abre por encima de
  // lo que sea que se esté viendo, en vez de una ruta más — así se puede
  // abrir/cerrar desde cualquier pantalla (Sidebar) sin perder el lugar
  // donde estaba el usuario.
  settingsModalOpen: false,
  openSettingsModal() {
    set({ settingsModalOpen: true });
  },
  closeSettingsModal() {
    set({ settingsModalOpen: false });
  },

  async loadSettings() {
    const settings = await window.hardLauncher.settings.get();
    set({ settings });
    return settings;
  },

  async updateSettings(partial) {
    const settings = await window.hardLauncher.settings.update(partial);
    set({ settings });
    return settings;
  },

  async refreshAccounts() {
    const accounts = await window.hardLauncher.auth.listAccounts();
    const activeAccount = await window.hardLauncher.auth.getActive();
    set({ accounts, activeAccount });
    // El precargado de las caras ya no pasa por acá: arranca en el proceso
    // principal apenas se abre el launcher (faceCache.prefetchAll en
    // electron/main.js) y queda GUARDADO EN DISCO, no en un `new Image()`
    // volátil del renderer que se perdía al cerrar la app. AccountAvatar.jsx
    // pide directo ese caché (auth:getFace) cuando le toca pintar cada cuenta.
  },

  async refreshInstances() {
    const instances = await window.hardLauncher.instances.list();
    set({ instances });
  },

  // Borrado optimista: la instancia se saca de la lista (y por lo tanto
  // desaparece de Sidebar/Inicio/Instancias) al instante, sin esperar a que
  // termine el borrado real en disco — que puede tardar si la carpeta es
  // grande. Si el borrado falla, se restaura la lista anterior.
  async removeInstance(id) {
    const previous = get().instances;
    set({ instances: previous.filter((i) => i.id !== id) });
    try {
      await window.hardLauncher.instances.delete(id);
    } catch (e) {
      set({ instances: previous });
      throw e;
    }
  },

  async setActiveAccount(id) {
    const activeAccount = await window.hardLauncher.auth.setActive(id);
    set({ activeAccount });
  },

  // stdout/stderr llega en chunks arbitrarios, no necesariamente una línea
  // completa por evento (un solo chunk puede traer varias líneas pegadas, o
  // una línea puede llegar partida en dos chunks). Antes cada chunk se
  // guardaba tal cual y se pintaba todo con .join('\n'); ahora la consola
  // muestra una fila por línea, así que acá se separan los chunks por salto
  // de línea antes de guardarlos, para que cada fila de la consola sea
  // realmente una línea de log y no un chunk cortado al azar.
  appendLog(chunk) {
    const newLines = String(chunk).split(/\r?\n/).filter((l) => l.length > 0);
    if (newLines.length === 0) return;
    set({ logs: [...get().logs, ...newLines].slice(-1000) });
  },

  clearLogs() {
    set({ logs: [] });
  },

  // Notificaciones propias en vez de alert() nativo (que abre un diálogo
  // de Windows y traba toda la app hasta que lo cerrás).
  pushToast(message, type = 'info') {
    const id = ++toastCounter;
    set({ toasts: [...get().toasts, { id, message, type }] });
    setTimeout(() => get().dismissToast(id), 4000);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setRunningInstance(payload) {
    set({ runningInstance: payload });
  },

  clearRunningInstance() {
    set({ runningInstance: null });
  },
}));

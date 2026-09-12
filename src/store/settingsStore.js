const Store = require('electron-store');

const store = new Store({
  name: 'settings',
  defaults: {
    defaultMemoryMin: 1024,
    defaultMemoryMax: 4096,
    defaultResolutionWidth: 854,
    defaultResolutionHeight: 480,
    defaultFullscreen: false,
    javaPathOverride: null,
    keepLauncherOpenWhilePlaying: true,
    theme: 'dark', // 'dark' | 'oled' | 'light' | 'system'
    language: 'es', // 'es' | 'en' | 'pt'

    // --- Valores por defecto "avanzados" para instancias nuevas (igual que
    // los "global overrides" de Modrinth App: Java arguments, variables de
    // entorno y launch hooks a nivel launcher, que cada instancia nueva
    // hereda y después puede pisar desde su propio panel de Ajustes). Se
    // guardan junto a customDefaultJvmArgs/etc. para no romper instancias
    // que ya existían antes de que estos ajustes existieran. ---
    defaultJvmArgs: '',
    defaultEnvVars: '',
    defaultPreLaunchHook: '',
    defaultWrapperHook: '',
    defaultPostExitHook: '',
  },
});

function getSettings() {
  return store.store;
}

function updateSettings(partial) {
  store.set(partial);
  return store.store;
}

module.exports = { getSettings, updateSettings };

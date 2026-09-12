# Hard Launcher

Launcher personalizado de Minecraft, con la UX de Modrinth App pero con paleta
morada, enfocado en cuentas **No-Premium (Offline)** con soporte para cuentas
**Premium (Microsoft)**.

## Stack elegido y por qué

| Capa | Tecnología | Motivo |
|---|---|---|
| Shell de escritorio | **Electron** | Acceso completo a Node.js (fs, child_process) necesario para descargar/lanzar Minecraft; multiplataforma (Win/Mac/Linux); es el mismo enfoque que usan launchers reales como el propio Modrinth App (Tauri) o GDLauncher (Electron). |
| UI | **React + Vite** | Igual que la app real de Modrinth; recarga rápida en desarrollo, componentes reutilizables para tarjetas de mods/instancias. |
| Estado global | **Zustand** | Más ligero que Redux para el tamaño de este proyecto. |
| Persistencia local | **electron-store** | Guarda cuentas e instancias en JSON en `userData`, sin necesidad de una base de datos. |
| Auth Premium | **msmc** | Encapsula el flujo completo MSA → Xbox Live → XSTS → Minecraft Services. |
| Descargas | **axios + streams nativos de Node** | Control fino sobre progreso de descarga y verificación SHA1. |
| Empaquetado | **electron-builder** | Genera instaladores .exe/.dmg/.AppImage. |

Alternativa evaluada: **Tauri + Rust** (lo que usa Modrinth App realmente) —
produce binarios más livianos, pero el ecosistema de librerías para el
protocolo de lanzamiento de Minecraft (Yggdrasil, Fabric Meta, etc.) está mucho
más maduro en Node.js, por lo que Electron acelera el desarrollo.

## Estructura del proyecto

```
hard-launcher/
├── package.json
├── vite.config.js
├── index.html
├── electron/
│   ├── main.js              # Proceso principal: registra todos los canales IPC
│   └── preload.js           # Puente seguro contextBridge -> window.hardLauncher
├── src/
│   ├── auth/
│   │   ├── offlineAuth.js    # Generación de UUID offline (idéntico algoritmo a Mojang)
│   │   ├── microsoftAuth.js  # OAuth2 Microsoft vía msmc
│   │   └── accountManager.js # Persistencia y cuenta activa
│   ├── core/
│   │   ├── versionManager.js # Manifest Mojang, descarga client.jar/libs/assets
│   │   ├── javaManager.js    # Descarga el JRE correcto por versión (Adoptium/Mojang)
│   │   ├── loaderManager.js  # Fabric/Quilt/Forge/NeoForge
│   │   └── launcher.js       # Construye el comando java y hace spawn()
│   ├── api/
│   │   ├── modrinthApi.js    # Wrapper API v2 de Modrinth (search, versions, etc.)
│   │   └── modInstaller.js   # Instala mods+dependencias, toggles, .mrpack
│   ├── store/
│   │   └── instanceStore.js  # CRUD de instancias en disco
│   └── renderer/
│       ├── main.jsx
│       ├── App.jsx
│       ├── store.js          # Estado global (Zustand)
│       ├── components/
│       │   ├── Sidebar.jsx
│       │   ├── AccountModal.jsx
│       │   └── CreateInstanceModal.jsx
│       └── views/
│           ├── HomeView.jsx
│           ├── InstancesView.jsx
│           ├── InstanceDetailView.jsx
│           ├── ExploreView.jsx
│           └── SettingsView.jsx
└── styles/
    └── theme.css              # Paleta morada (#0F0C1B, #18142A, #8B5CF6, #7C3AED)
```

## Cómo funciona la autenticación

**No-Premium (Offline):**
1. El usuario ingresa un nickname (3-16 caracteres).
2. `offlineAuth.js` calcula un UUID v3 vía MD5 sobre `OfflinePlayer:<nick>` —
   es el **mismo algoritmo que usa el cliente vanilla de Minecraft** en modo
   offline, así que el UUID es reproducible y compatible con servidores en
   `online-mode=false`.
3. Se genera un `accessToken` local aleatorio (no lo valida Mojang; sólo
   permite que el cliente arranque sin pedir login).
4. Opcionalmente se asocia una skin por URL externa o vía Ely.by.

**Premium (Microsoft):**
1. Se usa `msmc`, que abre la ventana oficial de login de Microsoft dentro de
   Electron (el usuario nunca teclea su contraseña dentro del launcher).
2. El flujo completo hace: MSA OAuth2 → Xbox Live → XSTS → Minecraft
   Services, y devuelve el `accessToken` real más el perfil (uuid, skins).

Ambos tipos de cuenta terminan generando los mismos parámetros de lanzamiento
(`--username`, `--uuid`, `--accessToken`, `--userType`), por lo que
`launcher.js` no necesita ramas de código separadas para lanzar el juego.

## Notas sobre Forge/NeoForge

Fabric y Quilt exponen una API REST que devuelve directamente el perfil de
lanzamiento (librerías + mainClass), así que se descargan sin ejecutar nada.
Forge y NeoForge, en cambio, distribuyen un `installer.jar` oficial; el
launcher lo ejecuta en modo headless (`--installClient`) y luego lee el
version-profile JSON que el propio instalador genera en `/versions/<id>/`.

## Guía paso a paso para compilar y ejecutar

### 1. Requisitos previos
- Node.js 18 o superior
- npm 9+
- (Opcional para producción) Java no es necesario en el equipo de desarrollo:
  el launcher descarga su propio runtime por versión de Minecraft.

### 2. Instalar dependencias
```bash
cd hard-launcher
npm install
```

### 3. Ejecutar en modo desarrollo
```bash
npm run dev
```
Esto levanta Vite en `http://localhost:5173` y abre la ventana de Electron
apuntando a ese servidor con hot-reload.

### 4. Compilar para producción
```bash
npm run build
```
Genera primero el bundle de React (`dist/`) y luego empaqueta con
`electron-builder`, dejando los instaladores en `release/` (`.exe` en
Windows, `.dmg` en macOS, `.AppImage`/`.deb` en Linux).

### 5. Configurar el login Microsoft (solo si se usará modo Premium)
`msmc` gestiona el flujo estándar de "device code"/ventana embebida sin
necesitar que registres una app propia en Azure para uso personal/pruebas.
Para distribución pública a gran escala, Mojang recomienda registrar una
aplicación en el [Azure Portal](https://portal.azure.com) y usar tu propio
`client_id`.

## Notas legales

Este launcher no distribuye ni modifica los binarios de Minecraft: descarga
los `.jar` oficiales directamente desde los servidores de Mojang/Microsoft en
tiempo de ejecución, igual que el launcher oficial. El modo offline reutiliza
el mismo comportamiento que el propio cliente vanilla ofrece de fábrica al
ejecutarse sin conexión; jugar en servidores de terceros con `online-mode`
desactivado depende de las reglas de cada servidor, no del launcher.

<div align="center">

<img src=".github/assets/banner.png" alt="Hard Launcher" width="100%" />

[![Última versión](https://img.shields.io/github/v/release/whoishard/hardlauncher?label=%C3%BAltima%20versi%C3%B3n&color=d81f33&style=for-the-badge)](https://github.com/whoishard/hardlauncher/releases/latest)
[![Descargas](https://img.shields.io/github/downloads/whoishard/hardlauncher/total?label=descargas&color=ef4457&style=for-the-badge)](https://github.com/whoishard/hardlauncher/releases)
[![Plataforma](https://img.shields.io/badge/plataforma-Windows%20%7C%20Linux-8c1220?style=for-the-badge&logo=linux&logoColor=white)](https://github.com/whoishard/hardlauncher/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-30-d81f33?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Discord](https://img.shields.io/badge/Discord-Unirse-ef4457?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/RAnkPVvJem)

**Launcher de Minecraft para mods premium y no premium.**
Cuentas Offline y Microsoft, mods/modpacks/resource packs/shaders,
gestión de instancias, y actualizaciones automáticas. Basado en Modrinth.

[**⬇️ Descargar la última versión**](https://github.com/whoishard/hardlauncher/releases/latest)
&nbsp;·&nbsp;
[Reportar un problema](https://discord.gg/RAnkPVvJem)

</div>

<br />

## ✨ Qué incluye

- 🔴 **Cuentas Offline y Microsoft (Premium)** — mismo flujo de lanzamiento
  para las dos, sin ramas de código separadas.
- 📦 **Explorador de contenido** — mods, resource packs, shaders,
  modpacks y data packs, con filtros, buscador y progreso de instalación por
  ítem (sin saltos raros de layout al instalar varios seguidos).
- 🗂️ **Gestión de instancias** — múltiples versiones/loaders (Fabric, Quilt,
  Forge, NeoForge) en paralelo, cada una con su propia config de Java,
  memoria, resolución y hooks de lanzamiento.
- 🔀 **Cambio de versión con un clic** — desde el encabezado de cualquier
  instancia podés pasarla a otra versión de Minecraft o a otro mod loader.
  El launcher busca solo la versión compatible de cada mod, resource pack y
  shader instalado, te muestra de antemano qué no tiene equivalente, y te
  deja elegir si eliminarlo o conservarlo antes de aplicar nada.
- 🌍 **Mundos y capturas** — lista de partidas de cada instancia con su modo
  de juego, dificultad y si es hardcore, más una galería de screenshots con
  visor a pantalla completa y zoom.
- 🖧 **Servidores** — lista de servidores con ping en vivo, MOTD renderizado
  con el formato de colores del juego, y botón para entrar directo a uno sin
  pasar por el menú principal de Minecraft.
- 🎨 **Editor de íconos** para cada instancia, con estudio de colores/formas
  o imagen propia.
- 💬 **Discord Rich Presence** — muestra a qué estás jugando; opcional y
  apagable desde Ajustes. Al conectarte a un server puntual, la actividad
  cambia sola para mostrar solo la IP, con el logo del launcher de imagen
  grande y el ícono de ESE server como insignia chica al lado, en vez de
  la instancia o la cara de tu skin.
- 🌐 **Multi-idioma** — español, inglés y portugués.
- 📥 **Importador de launchers** — trae instancias desde Prism, MultiMC,
  PolyMC, CurseForge o el propio Modrinth App.
- 🔄 **Auto-actualización** — al publicar una versión nueva, todos los que
  ya tienen el launcher instalado la reciben solos, sin reinstalar nada a
  mano.
- 🖥️ **Consola en vivo** de cada partida, con copiar/limpiar logs.

<!--
  Agregá acá una o dos capturas de pantalla reales del launcher cuando
  quieras — por ejemplo:

  <p align="center">
    <img src=".github/assets/screenshot-home.png" width="80%" />
  </p>
-->

## 🆕 Novedades de esta versión

**Cambiar la versión de una instancia, ahora a la vista.** El asistente ya
existía, pero vivía adentro de *Ajustes → Instalación*: a dos clics de
distancia y mezclado con el resto de la configuración, así que mucha gente
ni sabía que se podía. Ahora se llega desde el encabezado de la instancia de
dos formas:

- Un botón **«Cambiar versión»**, al lado de *Abrir carpeta*.
- Las propias chapitas de versión y loader (`1.21.1 · fabric`) son
  clickeables: se ven como etiquetas normales y al pasar el mouse se
  encienden, que es donde uno intuitivamente va a tocar para cambiarlas.

Si el juego de esa instancia está corriendo, el launcher avisa y no deja
abrir el asistente: cambiar de versión reescribe la carpeta de la instancia,
y con el juego abierto esa carpeta está en uso.

**Términos y Condiciones rediseñados.** Es la primera pantalla que ve
alguien que recién instaló el launcher, así que dejó de ser un modal
genérico con párrafos sueltos: ahora tiene encabezado propio con el isotipo,
cada punto como tarjeta numerada con su ícono, cuerpo con degradado de
scroll que se apaga al llegar al final, y una casilla de «leí y acepto» que
habilita el botón — el patrón de EULA que ya se reconoce de cualquier
instalador.

## 🚀 Instalación (para jugadores)

### Windows

1. Andá a [**Releases**](https://github.com/whoishard/hardlauncher/releases/latest)
   y descargá el `HardLauncher-Windows-Setup-<versión>.exe` más reciente.
2. Ejecutalo. Windows SmartScreen puede avisar "Windows protegió tu PC" (el
   instalador no está firmado digitalmente) — tocá **Más información** →
   **Ejecutar de todas formas**.
3. Listo. Las próximas actualizaciones las vas a recibir solo, adentro del
   launcher.

### Linux

1. Andá a [**Releases**](https://github.com/whoishard/hardlauncher/releases/latest)
   y descargá el `HardLauncher-Linux-<versión>.AppImage` (funciona en
   cualquier distro) o el `.deb` (Debian/Ubuntu y derivados) más reciente.
2. **AppImage**: dale permiso de ejecución y correlo —
   `chmod +x HardLauncher-Linux-*.AppImage && ./HardLauncher-Linux-*.AppImage`.
   **.deb**: instalalo con `sudo apt install ./HardLauncher-Linux-*.deb` (o
   con tu gestor de paquetes gráfico habitual).
3. La auto-actualización dentro del launcher funciona en ambos formatos; si
   tu distro no la soporta (algunos entornos AppImage sandboxeados), el
   launcher te avisa y te deja descargar la versión nueva a mano en vez de
   fallar en silencio.

### Java

No hace falta instalarlo. El launcher descarga y administra su propio
runtime de Java según la versión de Minecraft que vayas a jugar.

<br />

<details>
<summary><strong>🔀 Cómo funciona el cambio de versión</strong></summary>
<br />

El asistente (`UpdateInstanceVersionModal.jsx` más `checkVersionUpdatePlan()`
en `modInstaller.js`) trabaja en pasos, y no toca nada hasta el último:

1. **Elegir destino** — versión de Minecraft, mod loader y versión del
   loader, con el mismo selector que usa *Crear instancia*.
2. **Chequeo de compatibilidad** — se le pregunta a Modrinth, ítem por
   ítem, si el contenido instalado tiene una versión publicada para ese
   destino.
3. **Revisión** — si algo no es compatible, se muestra la lista completa
   (con ícono, tipo y nombre de archivo de cada uno) y se elige entre
   eliminarlos, conservarlos igual, o cancelar todo.
4. **Aplicación** — recién acá se descargan las versiones nuevas, se borran
   o conservan las incompatibles según lo elegido, y al final se actualizan
   `mcVersion` / `loader` / `loaderVersion` de la instancia.

El contenido agregado a mano (arrastrando un `.jar` a la carpeta) se detecta
como *no administrado*: no se toca ni se borra, pero se avisa que el
launcher no puede actualizarlo solo.

</details>

<details>
<summary><strong>🛠️ Guía para compilar y correr en desarrollo</strong></summary>

### 1. Requisitos previos
- Node.js 18 o superior
- npm 9+
- Java **no** hace falta tenerlo instalado: el launcher descarga su propio
  runtime por versión de Minecraft.

### 2. Instalar dependencias
```bash
git clone https://github.com/whoishard/hardlauncher.git
cd hardlauncher
npm install
```

### 3. Ejecutar en modo desarrollo
```bash
npm run dev
```
Levanta Vite en `http://localhost:5173` y abre la ventana de Electron
apuntando a ese servidor, con hot-reload.

### 4. Compilar el instalador
```bash
npm run build
```
Genera primero el bundle de React (`dist/`) y después empaqueta con
`electron-builder`, dejando `HardLauncher-Setup-<versión>.exe` en `release/`.

### 5. Publicar una actualización
El repo ya tiene un workflow de GitHub Actions
(`.github/workflows/release.yml`) que compila y publica solo al crear un
tag `vX.Y.Z`. Ver **`PUBLICAR-ACTUALIZACIONES.md`** para el paso a paso.

### 6. Configurar el login Microsoft (solo si se usará modo Premium)
`msmc` gestiona el flujo estándar de "device code"/ventana embebida sin
necesitar que registres una app propia en Azure para uso personal/pruebas.
Para distribución pública a gran escala, Mojang recomienda registrar una
aplicación en el [Azure Portal](https://portal.azure.com) y usar tu propio
`client_id`.

</details>

<details>
<summary><strong>🎨 Diseño y paleta</strong></summary>
<br />

Toda la interfaz sale de variables CSS definidas en `styles/theme.css`, así
que cambiar la identidad visual del launcher es tocar un bloque y no cazar
colores sueltos por los componentes.

| Rol | Variable | Valor |
|---|---|---|
| Fondo de la app | `--bg-app` | `#16181c` |
| Paneles / tarjetas | `--bg-panel` | `#222326` |
| Acento (rubí) | `--accent-primary` | `#d81f33` |
| Acento hover | `--accent-primary-hover` | `#ef4457` |
| Acento profundo | `--accent-secondary` | `#8c1220` |
| Éxito / Aviso / Error | `--success` / `--warning` / `--danger` | `#34d399` / `#fbbf24` / `#f87171` |

El rojo rubí es el acento en todos lados: botones, estados activos, bordes
de foco, el splash, el ícono de bandeja y el isotipo. Cambiar el acento
desde *Ajustes → Apariencia* se aplica al launcher entero sin reiniciar
—logo y pantalla de carga incluidos— porque todo cuelga del mismo set de
variables.

Tipografía: **Inter** en toda la UI, cargada localmente vía `@fontsource`
para que nunca dependa de la conexión.

El instalador de Windows también sigue la paleta: el panel lateral
(`build/installer/sidebar.bmp`) y la banda superior
(`build/installer/header.bmp`) usan el mismo fondo `#16181c` con el isotipo
rojo, así que la primera pantalla que se ve al instalar ya es la del
launcher.

</details>

<details>
<summary><strong>🧱 Stack elegido y por qué</strong></summary>
<br />

| Capa | Tecnología | Motivo |
|---|---|---|
| Shell de escritorio | **Electron** | Acceso completo a Node.js (fs, child_process) necesario para descargar/lanzar Minecraft; multiplataforma; mismo enfoque que launchers reales como GDLauncher. |
| UI | **React + Vite** | Recarga rápida en desarrollo, componentes reutilizables para tarjetas de mods/instancias. |
| Animación | **Framer Motion** | Transiciones de vistas y modales declarativas, con entrada/salida coordinada (`AnimatePresence`). |
| Estado global | **Zustand** | Más ligero que Redux para el tamaño de este proyecto. |
| Persistencia local | **electron-store** | Guarda cuentas e instancias en JSON en `userData`, sin necesidad de una base de datos. |
| Auth Premium | **msmc** | Encapsula el flujo completo MSA → Xbox Live → XSTS → Minecraft Services. |
| Descargas | **axios + streams nativos de Node** | Control fino sobre progreso de descarga y verificación SHA1. |
| Auto-actualización | **electron-updater** | Chequea, descarga e instala actualizaciones publicadas como GitHub Releases. |
| Empaquetado | **electron-builder** | Genera el instalador `.exe` (NSIS) con ícono, accesos directos y diseño propio. |

Alternativa evaluada: **Tauri + Rust** — produce binarios más livianos,
pero el ecosistema de librerías para el
protocolo de lanzamiento de Minecraft (Yggdrasil, Fabric Meta, etc.) está
mucho más maduro en Node.js, por lo que Electron acelera el desarrollo.

</details>

<details>
<summary><strong>📁 Estructura del proyecto</strong></summary>
<br />

```
hard-launcher/
├── package.json
├── vite.config.js
├── index.html
├── .github/
│   ├── assets/banner.png     # Banner del README
│   └── workflows/release.yml # Compila y publica al crear un tag vX.Y.Z
├── build/                    # Recursos de empaquetado (electron-builder)
│   ├── icon.png / icon.ico   # Ícono de la app y del instalador
│   └── installer/
│       ├── sidebar.bmp       # Panel lateral del instalador NSIS (164x314)
│       └── header.bmp        # Banda superior del instalador NSIS (150x57)
├── electron/
│   ├── main.js              # Proceso principal: registra todos los canales IPC
│   ├── preload.js           # Puente seguro contextBridge -> window.hardLauncher
│   ├── splash.html          # Pantalla de carga (sigue el acento elegido)
│   ├── discordPresence.js   # Rich Presence opcional
│   └── updater.js           # Lógica de auto-actualización (electron-updater)
├── src/
│   ├── auth/
│   │   ├── offlineAuth.js    # Generación de UUID offline (idéntico algoritmo a Mojang)
│   │   ├── microsoftAuth.js  # OAuth2 Microsoft vía msmc
│   │   ├── faceCache.js      # Cache de caras de skin para los avatares
│   │   └── accountManager.js # Persistencia y cuenta activa
│   ├── core/
│   │   ├── versionManager.js    # Manifest Mojang, descarga client.jar/libs/assets
│   │   ├── loaderManager.js     # Fabric/Quilt/Forge/NeoForge
│   │   ├── javaManager.js       # Descarga y elige el runtime de Java por versión
│   │   ├── launcherImporter.js  # Importa de Prism/MultiMC/PolyMC/CurseForge
│   │   ├── serverPing.js        # Ping + MOTD de servidores
│   │   ├── worldNbt.js          # Lee level.dat de cada mundo
│   │   └── launcher.js          # Construye el comando java y hace spawn()
│   ├── api/
│   │   ├── modrinthApi.js    # Wrapper API v2 de Modrinth (search, versions, etc.)
│   │   └── modInstaller.js   # Instala mods+dependencias, toggles, .mrpack
│   │                         # y arma el plan de cambio de versión
│   ├── store/
│   │   ├── instanceStore.js  # CRUD de instancias en disco
│   │   ├── settingsStore.js  # Ajustes del launcher (idioma, acento, términos)
│   │   └── serverListStore.js
│   └── renderer/
│       ├── main.jsx
│       ├── App.jsx
│       ├── store.js          # Estado global (Zustand)
│       ├── i18n.js           # Traducciones es/en/pt
│       ├── termsContent.js   # Texto de los Términos y Condiciones
│       ├── components/       # TermsModal, UpdateInstanceVersionModal, etc.
│       └── views/            # Inicio, Instancias, Detalle de instancia, Explorar
└── styles/
    └── theme.css              # Paleta "rubí" (#16181c de fondo, #d81f33 de acento)
```

</details>

<details>
<summary><strong>💬 Cómo funciona el ícono de server en la Rich Presence</strong></summary>
<br />

Al conectarte a un server puntual, la Rich Presence muestra solo la IP,
con el logo del launcher de imagen grande y el ícono de ESE server como
insignia chica al lado.

El ícono no puede ser un archivo que Hard Launcher tenga guardado local:
Discord no le pide la imagen al propio programa que llama `setActivity`,
se la pide desde su propia infraestructura (para poder mostrarla también
en el perfil de cualquier amigo que lo mire), así que tiene que ser una
URL pública de verdad. Como el launcher no tiene ningún servidor propio en
internet para alojar el favicon que podría sacar pingeando el server él
mismo (ver `core/serverPing.js`, usado para la lista de servidores
recomendados de Inicio), la URL de la insignia se arma contra
[mcsrvstat.us](https://mcsrvstat.us) — un servicio público y gratuito que,
dado un `host[:puerto]`, devuelve el ícono actual de ese server como PNG
(pingeándolo ellos del otro lado). Si el server no tiene ícono propio o
está caído, mcsrvstat.us devuelve un ícono de relleno genérico en vez de
romperse.

*(Versión anterior de este launcher intentaba servir el ícono desde un
mini servidor HTTP propio en `127.0.0.1` — se veía roto siempre, por la
misma razón de arriba: esa dirección nunca es alcanzable desde la
infraestructura de Discord.)*

</details>

<details>
<summary><strong>🔐 Cómo funciona la autenticación</strong></summary>

<br />

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

</details>

<details>
<summary><strong>⚒️ Notas sobre Forge/NeoForge</strong></summary>
<br />

Fabric y Quilt exponen una API REST que devuelve directamente el perfil de
lanzamiento (librerías + mainClass), así que se descargan sin ejecutar nada.
Forge y NeoForge, en cambio, distribuyen un `installer.jar` oficial; el
launcher lo ejecuta en modo headless (`--installClient`) y luego lee el
version-profile JSON que el propio instalador genera en `/versions/<id>/`.

</details>

<details>
<summary><strong>⚖️ Notas legales</strong></summary>
<br />

Este launcher no distribuye ni modifica los binarios de Minecraft: descarga
los `.jar` oficiales directamente desde los servidores de Mojang/Microsoft en
tiempo de ejecución, igual que el launcher oficial. El modo offline reutiliza
el mismo comportamiento que el propio cliente vanilla ofrece de fábrica al
ejecutarse sin conexión; jugar en servidores de terceros con `online-mode`
desactivado depende de las reglas de cada servidor, no del launcher.

Hard Launcher es un proyecto no oficial, sin relación con Mojang Studios ni
Microsoft. "Minecraft" es una marca registrada de Mojang Studios. Los
Términos y Condiciones completos se muestran dentro del launcher en el
primer arranque y cada vez que se actualiza a una versión nueva.

</details>

<br />

<div align="center">

Hecho con ❤️ y Electron.

</div>

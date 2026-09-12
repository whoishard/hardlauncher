# Cómo publicar una actualización

## Una sola vez (configuración inicial)

1. Creá un repo en GitHub (puede ser público o privado, pero **tiene que ser
   público** para que el auto-update funcione para tus jugadores sin que
   tengas que meter ningún token en la app).
2. Abrí `package.json` y en la sección `build.publish` reemplazá:
   ```json
   "publish": {
     "provider": "github",
     "owner": "TU-USUARIO-DE-GITHUB",
     "repo": "TU-REPOSITORIO"
   }
   ```
   por tu usuario y el nombre real del repo.
3. Generá un [Personal Access Token de GitHub](https://github.com/settings/tokens)
   (bastan los permisos de `repo`) y guardalo como variable de entorno
   `GH_TOKEN` en tu máquina (la que uses para compilar/publicar, no hace
   falta que esté en la de los jugadores):
   - Windows (PowerShell): `setx GH_TOKEN "tu_token_acá"` (después cerrá y
     abrí la terminal de nuevo para que tome el valor)
   - Windows (cmd): `set GH_TOKEN=tu_token_acá` (solo dura esa sesión de
     terminal; para que quede fijo usá `setx` como arriba)
4. `npm install` (para bajar `electron-updater`, que se agregó como
   dependencia nueva).

## Cada vez que sacás una versión nueva

1. Subí el número de versión en `package.json` (ej. `"version": "1.0.1"`).
   **Esto es obligatorio** — electron-updater decide si hay una versión
   nueva comparando este número, no la fecha ni nada más.
2. Corré:
   ```
   npm run release
   ```
   Esto compila el renderer, arma el instalador (`HardLauncher-Setup-1.0.1.exe`)
   y lo sube solo a un Release nuevo de tu repo de GitHub, junto con los
   archivos de metadata que necesita electron-updater (`latest.yml`,
   `*.blockmap`) — no hace falta subir nada a mano.
3. Listo. Los launchers que ya tengan instalada una versión anterior van a
   detectar la actualización solos (al abrir el launcher, y cada 4 horas
   mientras sigue abierto), bajarla en segundo plano, y ofrecer reiniciar
   para aplicarla. No hace falta que el jugador vuelva a instalar nada a
   mano.

## Para probarlo vos antes de publicarlo de verdad

`electron-updater` no hace nada corriendo con `npm run dev`/`npm start` — 
solo funciona sobre una versión ya instalada de verdad. Para probar el
flujo completo:
1. Publicá una versión (ej. 1.0.0) con `npm run release` e instalala en tu PC
   con el .exe que se generó.
2. Subí la versión en `package.json` a 1.0.1 y volvé a correr
   `npm run release`.
3. Abrí el Hard Launcher que instalaste (el de la versión 1.0.0) y esperá
   unos segundos — debería aparecer la descarga de la 1.0.1 solo.

## Cosas a tener en cuenta

- El instalador **no está firmado digitalmente** (firmar cuesta un
  certificado pago). Windows SmartScreen probablemente le muestre a tus
  jugadores un aviso de "Windows protegió tu PC" la primera vez — tienen que
  tocar "Más información" → "Ejecutar de todas formas". Es normal en apps
  chicas/indies sin certificado, no significa que esté roto.
- Los Releases de GitHub que uses para esto no pueden quedar marcados como
  "Draft" — `npm run release` ya los crea publicados directamente, así que
  si no tocás nada a mano en GitHub no vas a tener problema.

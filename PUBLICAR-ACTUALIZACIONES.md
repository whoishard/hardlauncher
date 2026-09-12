# Cómo publicar una actualización

Tu repo ya tiene configurado `.github/workflows/release.yml`, que compila el
instalador **en una máquina Windows de GitHub** (no en la tuya) y lo publica
solo. No hace falta que generes ningún token personal ni que compiles nada a
mano — GitHub Actions usa automáticamente su propio `GITHUB_TOKEN` interno,
que ya tiene permiso de publicar Releases en tu repo.

## Una sola vez (configuración inicial)

1. En `package.json`, dentro de `build.publish`, confirmá que `owner` y
   `repo` sean tu usuario y el nombre reales de tu repositorio de GitHub
   (sin `https://` ni `.git`, solo los nombres sueltos).
2. Subí el proyecto a GitHub (ver `SUBIR-A-GITHUB.md`) — con eso el workflow
   ya queda activo, no hay que "instalarlo" en ningún lado.

## Cada vez que sacás una versión nueva

1. Subí el número de `"version"` en `package.json` (ej. de `1.0.3` a
   `1.0.4`). **Esto es obligatorio** — así es como electron-updater sabe que
   hay algo nuevo.
2. Confirmá ese cambio a Git y subilo, y después creá un tag con el mismo
   número, con el prefijo `v`:
   ```
   git add package.json
   git commit -m "Versión 1.0.4"
   git push
   git tag v1.0.4
   git push origin v1.0.4
   ```
3. Eso dispara el workflow automáticamente. Andá a tu repo en GitHub →
   pestaña **Actions** y vas a ver correr "Build and Release Launcher" (tarda
   varios minutos, porque compila en una PC Windows en la nube). Cuando
   termina, el instalador queda publicado solo en
   `https://github.com/tu-usuario/tu-repo/releases`.
4. Los launchers que ya estén instalados en las PCs de tus jugadores lo
   van a detectar solos (al abrir el launcher, y cada 4 horas mientras
   sigue abierto), bajarlo en segundo plano, y ofrecer reiniciar para
   aplicarlo. No hace falta que nadie vuelva a instalar nada a mano.

## Si el workflow falla

Andá a la pestaña **Actions** de tu repo, tocá la corrida que falló, y fijate
en qué paso se cortó — el log suele decir bastante claro qué pasó. Si no
entendés el error, pegámelo tal cual y lo vemos.

## Cosas a tener en cuenta

- El instalador **no está firmado digitalmente** (firmar cuesta un
  certificado pago). Windows SmartScreen probablemente le muestre a tus
  jugadores un aviso de "Windows protegió tu PC" la primera vez — tienen que
  tocar "Más información" → "Ejecutar de todas formas". Es normal en apps
  chicas/indies sin certificado, no significa que esté roto.
- El repo tiene que ser **público** para que el auto-update funcione en las
  PCs de tus jugadores sin pedirles ningún token.

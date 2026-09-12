# Subir el launcher a GitHub

## 1. Crear el repositorio (si todavía no existe)

1. Entrá a [github.com](https://github.com) → botón **New** → nombre (ej.
   `hardlauncher`) → dejalo en **Public** → creá el repo, sin marcar README
   ni .gitignore (ya vienen en el proyecto).
2. Copiá la URL que te muestra, tipo
   `https://github.com/tu-usuario/hardlauncher.git`.

## 2. Subir el código

Parado en la carpeta del proyecto:

```
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

(Si ya habías hecho `git init` antes, saltate esa línea y las que ya
corriste.) Esto sube todo, incluida la carpeta `.github/workflows/`, que es
lo que hace que la publicación de actualizaciones sea automática — no hay
que configurar nada aparte en GitHub para que funcione.

## 3. Confirmar `package.json`

Abrí `package.json` y fijate que en `build.publish` estén tu usuario y
repo reales:

```json
"publish": {
  "provider": "github",
  "owner": "tu-usuario",
  "repo": "hardlauncher"
}
```

## 4. Publicar la primera versión

Seguí los pasos de `PUBLICAR-ACTUALIZACIONES.md` — básicamente: confirmar el
número de versión en `package.json`, y después:

```
git tag v1.0.3
git push origin v1.0.3
```

Eso arranca el build en GitHub Actions (pestaña **Actions** de tu repo para
ver el progreso) y en unos minutos el instalador va a estar publicado en:

```
https://github.com/tu-usuario/hardlauncher/releases/latest
```

Ese es el link que le pasás a tus jugadores para descargar el `.exe`.

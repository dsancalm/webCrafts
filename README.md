# webCrafts

Un sitio estático, desplegable gratis en **GitHub Pages**, que reúne en un panel las versiones web de
aplicaciones de código abierto que sustituyen a programas creativos y de oficina (PhotoCraft, VectorCraft,
WordCraft, GridCraft, FilmCraft, SolidCraft, Lemon Studio…). Inspirado en
[playground.daijro.dev](https://playground.daijro.dev/) ([daijro/openplayground](https://github.com/daijro/openplayground)),
pero escrito desde cero y sin servidor: cada app es el zip web oficial de la **última release** de su
repositorio en GitHub, servido tal cual.

## Cómo funciona

1. `apps.json` es el catálogo: grupos, apps, repositorio de cada una, descripción (inglés/español) y
   a qué programa sustituye.
2. `versions.lock.json` guarda la versión (tag de release) de cada app: la primera de cada lista es la
   publicada, y se conservan como mucho las 3 últimas.
3. `scripts/build.mjs` descarga de GitHub el zip web (`*-web.zip`, `*-web-<versión>.zip`…) de esa versión
   y lo descomprime en `dist/<id>/`. Después genera el panel (`dist/index.html`), una página 404 y
   `dist/versions.json` con lo instalado.
4. El workflow `.github/workflows/pages.yml` ejecuta los tests, el build y una prueba en Chrome sin
   interfaz, y publica `dist/` en GitHub Pages en cada push a `main`.
5. El workflow `.github/workflows/update.yml` busca cada día versiones nuevas (ver más abajo).

Detalles:

- Todas las rutas son relativas, así que el sitio funciona en `https://<usuario>.github.io/<repo>/` o en
  un dominio propio sin tocar nada.
- Lemon Studio necesita `SharedArrayBuffer` (cabeceras COOP/COEP), que GitHub Pages no puede enviar. El
  build le añade un pequeño service worker (`site/coi-sw.js`, limitado a su carpeta) que pone esas cabeceras,
  y retrasa los scripts de la app hasta que la página está aislada.
- Si una app del catálogo no tiene release con versión web, aparece en el panel como «Aún sin versión web»,
  o enlaza a la copia que indique su campo `external`. En cuanto publique un zip web, el siguiente build la
  incluye automáticamente.
- GitHub Pages admite como mucho 1 GB por sitio. Si el build supera el presupuesto (`--budget-mb`, 950 MB
  por defecto), quita primero las apps más grandes que tengan una copia alojada en otro sitio (`external`) y
  las enlaza a ella; si no tienen, las deja fuera. Con las 16 apps actuales el sitio ocupa algo más de
  500 MB (el resumen de cada ejecución del workflow da la cifra exacta).
- Si la descarga de una app falla, el resto se publica igualmente y esa app sale como «No disponible».
- Se descartan archivos que Pages no usa (`_headers`, `.htaccess`, copias `.gz`/`.br` duplicadas). Las
  licencias que traen los zips se conservan.
- Panel en inglés y español (según el idioma del navegador, con selector), modo claro/oscuro automático,
  buscador (tecla `/`) y conmutador de «nombres alternativos».
- Botón **«Borrar datos»** en la cabecera: tras confirmarlo, borra lo que las apps guardan en el navegador
  (service workers y cachés del sitio, bases de datos IndexedDB, archivos del almacenamiento del navegador,
  cookies, también las de la carpeta de cada app, y almacenamiento local) y conserva solo el idioma y el modo
  de nombres del panel. En `<usuario>.github.io` el almacenamiento lo comparten todos los sitios de Pages de
  ese usuario, y el diálogo lo avisa. La caché HTTP normal del navegador no se puede vaciar desde una web.

## Publicarlo en GitHub Pages

Solo hay que hacerlo una vez:

1. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**. El
   `GITHUB_TOKEN` del workflow no puede activarlo por ti (requiere permisos de administración); si no está
   activado, el job `deploy` falla con un mensaje que lo indica.
2. Ve a **Actions → Build and deploy to GitHub Pages → Run workflow** (o haz un push a la rama por
   defecto). Al terminar, el sitio queda en `https://<usuario>.github.io/<repo>/`.

Solo despliega la rama por defecto del repositorio; en las demás ramas el workflow compila y prueba sin
publicar.

### Actualización diaria de las apps

Todos los días a las 06:17 UTC el workflow **Daily app update** (`update.yml`) ejecuta
`scripts/update.mjs`:

- Para cada app busca su **última release estable** con zip web (las pre-releases y los borradores no
  cuentan, y tampoco los tags de `skipTags`).
- Si una app no tiene release estable, **se queda en la versión que tiene**. La excepción es **Lemon
  Studio** (`"prerelease": true` en `apps.json`): todas sus versiones web son pre-releases, así que sigue
  la más reciente.
- Si **ninguna app ha cambiado**, termina sin commit ni despliegue.
- Si alguna ha cambiado, actualiza `versions.lock.json` con un commit del bot en `main` (por ejemplo
  «Update PhotoCraft v0.10.0 → v0.11.0») y lanza el despliegue.

También se puede lanzar a mano desde **Actions → Daily app update → Run workflow**. Para fijar o volver a
una versión, edita el primer tag de esa app en `versions.lock.json` y haz push. Los push con cambios de
código usan las versiones de ese archivo, así que nunca actualizan apps por su cuenta.

GitHub pausa las tareas programadas de un repositorio público tras 60 días sin actividad. Si pasa, se
reactiva desde la pestaña Actions.

## Límites de GitHub Pages

- Tamaño del sitio publicado: 1 GB como máximo. El build muestra el total en el resumen del job y se
  ajusta al presupuesto como se explica arriba.
- Ancho de banda orientativo de 100 GB al mes. Las apps pesan decenas de MB cada una, así que es más que
  suficiente para uso personal o de un equipo pequeño.

## Desarrollo local

Requiere Node 20 o superior y `unzip`.

```sh
npm install
npm test                          # tests unitarios y de integración (con un GitHub simulado)
GITHUB_TOKEN=... npm run build    # genera dist/ (el token evita el límite de 60 peticiones/hora)
npm run serve                     # sirve dist/ en http://127.0.0.1:8080/webCrafts/
npm run smoke                     # abre cada app en Chrome sin interfaz y comprueba que carga
```

Opciones útiles del build: `--only photocraft,wordcraft` (solo esas apps), `--list` (muestra qué release
usaría cada app sin descargar nada) y `--strict` (falla si alguna app con release web no se instala).

### Añadir o quitar apps

Edita `apps.json` y pon el icono en `icons/<id>.png` (128×128). Campos opcionales por app: `asset`
(expresión regular para el nombre del zip si no sigue el patrón habitual), `isolated` (necesita
aislamiento cross-origin), `external` (URL alternativa si no hay release web o no cabe en el presupuesto),
`skipTags` (releases cuya versión web está rota: se usa la anterior) y `experimental`.

Ahora mismo `skipTags` salta DeckCraft `v0.8.0`, cuya versión web falla al arrancar en cualquier navegador
(llama a `std::process::id()`, que no existe en WebAssembly) y se sirve `v0.7.0`. Cuando DeckCraft publique
una release corregida, basta con quitar la línea (o dejarla: la nueva release se cogerá igualmente).

## Futuras mejoras

Qué se ganaría compilando las apps nosotros mismos (SIMD, `-O3`, parches), cómo lo hace el sitio original y los
pasos para hacerlo aquí: ver [`FUTURAS_MEJORAS.md`](FUTURAS_MEJORAS.md).

## Licencia

El código de este repositorio (scripts, panel, workflow y tests) se publica bajo la [licencia MIT](LICENSE).

## Créditos y marcas

Cada aplicación pertenece a su proyecto y se distribuye bajo su licencia (MIT/Apache-2.0 o GPL-3.0; el
panel enlaza al código fuente de cada una). Los iconos de `icons/` proceden de sus repositorios y conservan
la licencia de cada proyecto, no la MIT de este repositorio: ver [`icons/SOURCES.md`](icons/SOURCES.md).

Este sitio no tiene relación con Adobe, Microsoft, Autodesk, Avid, Image-Line ni Figma. Los nombres de sus
productos son marcas registradas de sus propietarios y solo se usan para indicar a qué programa sustituye
cada proyecto.

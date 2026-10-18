# webCrafts

Un sitio estático, desplegable gratis en **GitHub Pages**, que reúne en un panel las versiones web de
aplicaciones de código abierto que sustituyen a programas creativos y de oficina (PhotoCraft, VectorCraft,
WordCraft, GridCraft, FilmCraft, SolidCraft, Honeydew…). Inspirado en
[playground.daijro.dev](https://playground.daijro.dev/) ([daijro/openplayground](https://github.com/daijro/openplayground)),
pero escrito desde cero y sin servidor: cada app es el zip web oficial de la **última release** de su
repositorio en GitHub, servido tal cual.

## Cómo funciona

1. `apps.json` es el catálogo: grupos, apps, repositorio de cada una, descripción (inglés/español) y
   a qué programa sustituye.
2. `scripts/build.mjs` consulta la API de GitHub, elige la release más reciente que tenga un zip web
   (`*-web.zip`, `*-web-<versión>.zip`…; una release estable gana a una pre-release más nueva), lo descarga
   y lo descomprime en `dist/<id>/`. Después genera el panel (`dist/index.html`), una página 404 y
   `dist/versions.json` con lo instalado.
3. El workflow `.github/workflows/pages.yml` ejecuta los tests, el build y una prueba en Chrome sin
   interfaz, y publica `dist/` en GitHub Pages.

Detalles:

- Todas las rutas son relativas, así que el sitio funciona en `https://<usuario>.github.io/<repo>/` o en
  un dominio propio sin tocar nada.
- Lemon Studio necesita `SharedArrayBuffer` (cabeceras COOP/COEP), que GitHub Pages no puede enviar. El
  build le añade un pequeño service worker (`site/coi-sw.js`, limitado a su carpeta) que pone esas cabeceras,
  y retrasa los scripts de la app hasta que la página está aislada.
- Si una app no tiene release con versión web, aparece en el panel como «Aún sin versión web» (NoteCraft,
  MaterialCraft) o enlaza a la web que mantiene su propio proyecto (SubCraft). En cuanto publiquen un zip
  web, el siguiente build la incluye automáticamente.
- GitHub Pages admite como mucho 1 GB por sitio. Si el build supera el presupuesto (`--budget-mb`, 950 MB
  por defecto), quita primero las apps más grandes que tengan una copia alojada en otro sitio (`external`) y
  las enlaza a ella. Hoy es el caso de **Honeydew**: su release web pesa 1,36 GB (716 MB descomprimida, por
  su biblioteca de sonidos), así que el panel la abre en la copia que mantiene su autor en
  playground.daijro.dev. El resto de apps ocupa unos 570 MB.
- Si la descarga de una app falla, el resto se publica igualmente y esa app sale como «No disponible».
- Se descartan archivos que Pages no usa (`_headers`, `.htaccess`, copias `.gz`/`.br` duplicadas). Las
  licencias que traen los zips se conservan.
- Panel en inglés y español (según el idioma del navegador, con selector), modo claro/oscuro automático,
  buscador (tecla `/`) y conmutador de «nombres alternativos».

## Publicarlo en GitHub Pages

Solo hay que hacerlo una vez:

1. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**. El
   `GITHUB_TOKEN` del workflow no puede activarlo por ti (requiere permisos de administración); si no está
   activado, el job `deploy` falla con un mensaje que lo indica.
2. Ve a **Actions → Build and deploy to GitHub Pages → Run workflow** (o haz un push a la rama por
   defecto). Al terminar, el sitio queda en `https://<usuario>.github.io/<repo>/`.

Solo despliega la rama por defecto del repositorio; en las demás ramas el workflow compila y prueba sin
publicar.

### Actualizar a las releases nuevas

El sitio no se actualiza solo: cada ejecución del workflow coge la última release de cada app. Para
actualizar, vuelve a lanzar el workflow a mano. Si más adelante quieres que sea automático, descomenta
el bloque `schedule` de `.github/workflows/pages.yml` (por defecto, una vez al día).

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

## Créditos y marcas

Cada aplicación pertenece a su proyecto y se distribuye bajo su licencia (MIT/Apache-2.0 o GPL-3.0; el
panel enlaza al código fuente de cada una). Los iconos proceden de sus repositorios: ver
[`icons/SOURCES.md`](icons/SOURCES.md).

Este sitio no tiene relación con Adobe, Microsoft, Autodesk, Avid, Image-Line ni Figma. Los nombres de sus
productos son marcas registradas de sus propietarios y solo se usan para indicar a qué programa sustituye
cada proyecto.

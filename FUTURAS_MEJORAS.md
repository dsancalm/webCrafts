# Futuras mejoras: compilar las apps optimizadas para velocidad

Hoy webCrafts sirve, sin tocarlo, el zip web oficial de la última release de cada app. Este documento
explica qué se podría ganar compilando las apps nosotros mismos, cómo lo hace el sitio original
([playground.daijro.dev](https://playground.daijro.dev/), repositorio
[daijro/openplayground](https://github.com/daijro/openplayground)) y los pasos para hacerlo aquí.

## Contexto: qué publican las apps

Las apps están escritas en Rust y se compilan a WebAssembly (un archivo `.wasm`, el programa que ejecuta
el navegador). Al preparar su versión web, cada proyecto pasa ese `.wasm` por `wasm-opt -Oz`, que
**optimiza para tamaño**: el archivo descarga antes, pero el código se ejecuta algo más despacio.

Comprobado en el `index.html` de PhotoCraft, VectorCraft, WordCraft, GridCraft, CADCraft y SolidCraft
(`data-wasm-opt="z"`). Además, Rust no activa por defecto las instrucciones SIMD de WebAssembly.

## Por qué merecería la pena

- **Fluidez.** Las apps de foto, vídeo, efectos y audio pasan mucho tiempo en bucles numéricos (filtros,
  mezcla de capas, decodificación, renderizado por CPU). Ahí es donde más ayudan SIMD y una optimización
  orientada a velocidad.
- **Arreglos sin esperar a cada proyecto.** Con el código en nuestras manos se pueden aplicar parches,
  como el fallo de DeckCraft v0.8.0 que ahora esquivamos sirviendo la v0.7.0 (`skipTags` en `apps.json`).
- **Integración con el sitio.** Por ejemplo, que todas las apps sigan el tema claro u oscuro del sistema.

La ganancia real **no está medida**; el primer paso del plan es medirla.

## Lo que cuesta

- **Tiempo de compilación.** Son apps Rust grandes: cuenta con decenas de minutos por app y canal. En
  GitHub Actions es gratis para repositorios públicos, con un límite de 6 h por job.
- **Mantenimiento.** Cada proyecto usa su propia versión de Trunk, wasm-bindgen y su propio script de
  empaquetado (PhotoCraft trocea el `.wasm` en partes; Lemon Studio tiene su propio script de build). Los
  parches se rompen cuando cambia el código de cada proyecto.
- **Tamaño.** `-O3` y SIMD producen `.wasm` más grandes. GitHub Pages admite como mucho 1 GB por sitio
  (hoy ocupamos unos 536 MB con 16 apps), así que hay que servir los `.wasm` comprimidos.

## Cómo lo hace el original

Descripción del enfoque, escrita a partir de su repositorio. **Ese repositorio no tiene licencia:** se puede
estudiar, pero su código no se puede copiar; hay que reimplementarlo.

1. **Compila cada app desde el código fuente** en GitHub Actions, para dos canales: el tag de la última
   release y el último commit de la rama principal (el interruptor «Use latest commits» de su panel).
2. **Activa SIMD** (`simd128`) añadiendo un `.cargo/config.toml` con
   `rustflags = ["-Ctarget-feature=+simd128"]` al proyecto antes de compilar.
3. **Optimiza para velocidad:** desactiva el `wasm-opt` que el `index.html` de cada proyecto pide a Trunk
   (el `-Oz`) y luego pasa su propio `wasm-opt -O3` sobre el resultado, habilitando las mismas features
   del módulo (`--enable-simd`, `--enable-bulk-memory`, etc.).
4. **Aplica parches por app**: ficheros de reglas «buscar este código e insertar este otro» más algunos
   diffs. Con ellos conecta las apps a su explorador de archivos y a la colaboración en tiempo real, hace
   que sigan el tema del sistema y corrige fallos (incluido el de DeckCraft).
5. **Mejoras de rendimiento en tiempo de ejecución**, parte en parches y parte en un script que inyecta en
   cada página:
   - compila los shaders en segundo plano para que la app no se congele;
   - dibuja los visores en la GPU de la propia página en lugar de en workers;
   - en vídeo, copia los fotogramas a la GPU directamente en YUV y descarta los que llegan tarde;
   - en LightCraft y LightCraft Classic, precarga las fotos vecinas en workers.
6. **Comprime los `.wasm` con gzip** y un script de la página los descomprime en el navegador
   (`DecompressionStream`). Lo necesita porque su hosting (Cloudflare) no admite archivos de más de 25 MiB.
7. **Publica cada build como asset** de una release llamada `builds` en su propio repositorio. Al montar
   el sitio usa la build propia si existe para esa versión; si no existe o falló, sirve la release oficial.
8. Lo ejecuta todo **cada 15 minutos** para recoger releases y commits nuevos.

## Pasos para hacerlo en webCrafts

### 0. Medir antes de invertir

Compilar a mano 2 o 3 apps (PhotoCraft, FilmCraft, LightCraft) con SIMD y `-O3` y compararlas con la
release oficial: tiempo de carga, tiempo de aplicar un filtro pesado y fotogramas por segundo en la
reproducción. Si la mejora no se nota, no merece el coste de mantenimiento.

### 1. Recetas de compilación en `apps.json`

Añadir a cada app un bloque opcional `build` con lo que cambia entre proyectos:

- carpeta de la app web dentro del repo;
- comando de build (Trunk o el script del proyecto);
- versiones de Trunk y wasm-bindgen: la de wasm-bindgen debe coincidir exactamente con la de su
  `Cargo.lock`;
- pasos de empaquetado especiales (PhotoCraft trocea el `.wasm`).

Las apps sin bloque `build` siguen usando la release oficial.

### 2. Workflow nuevo `build-apps.yml`, separado del de Pages

- Una matriz con una entrada por app que tenga receta, para que se compilen en paralelo.
- Instalar Rust estable con el target `wasm32-unknown-unknown`, Trunk, `wasm-bindgen-cli` y `binaryen`
  (`wasm-opt`), y cachear Cargo (por ejemplo con `Swatinem/rust-cache`) para que las recompilaciones
  sean incrementales.
- Descargar el código del proyecto en el tag que elegiría `pickRelease` (respetando `skipTags`).
- Activar SIMD con `RUSTFLAGS="-C target-feature=+simd128"` o un `.cargo/config.toml`, sin pisar los
  flags que ya tenga el proyecto.
- Compilar con el `wasm-opt` de Trunk desactivado (`data-wasm-opt="0"` en su `index.html`) y después
  ejecutar `wasm-opt -O3` con las features del módulo.
- Empaquetar el resultado como `<id>-<tag>-<hash>.zip` y subirlo a una release `builds` de este
  repositorio con `gh release upload`. Si una app falla, el job falla solo para esa app.

### 3. Usar las builds propias en `scripts/build.mjs`

Para cada app: si existe en la release `builds` un zip para el tag que toca, instalar ese; si no, la
release oficial como ahora. El panel podría marcar qué apps van optimizadas.

### 4. Servir los `.wasm` comprimidos

En el último build, VectorCraft pasó de 22,4 MB en zip a 64,6 MB descomprimida, y DesignCraft de 18,4 a
47,2 MB: los `.wasm` se comprimen a aproximadamente un tercio. Para no acercarse a 1 GB:

- comprimir cada `.wasm` a `.wasm.gz` y borrar el original;
- inyectar en el `index.html` un script que intercepte las peticiones a `*.wasm`, pida el `.wasm.gz` y
  devuelva la respuesta descomprimida con `content-type: application/wasm`;
- inyectarlo también en los workers que cargan wasm;
- revisar las apps con service worker propio (EffectCraft y SolidCraft tienen `sw.js`), que precargan los
  `.wasm` por nombre.

Alternativa más general: un único service worker en la raíz del sitio que haga esa descompresión para
todas las apps. Cubre workers y precargas sin tocar cada página, pero choca con las apps que ya tienen
su propio service worker.

### 5. Parches (opcional)

Una carpeta `patches/<id>/` con diffs que se aplican con `git apply` antes de compilar. Si un parche no se
aplica (porque el proyecto cambió), se compila sin él o se usa la release oficial, sin romper el resto.

### 6. Verificar

- Ampliar el smoke test actual para que compruebe también las builds propias.
- Repetir las mediciones del paso 0 sobre el sitio publicado.

## Otras mejoras posibles

- **Canal de últimos commits:** con el pipeline de compilación anterior, compilar también la rama
  principal de cada app y publicarla en `/head/<id>/` con un interruptor en el panel.
- **Explorador de archivos en el navegador**, guardando los documentos en el almacenamiento del navegador
  (OPFS), como el original. Solo funcionaría en las apps que lo soporten o se parcheen para usarlo.

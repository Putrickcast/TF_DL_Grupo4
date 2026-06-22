# Entregables - demo final multimodal

## Contexto usado

El prototipo responde al enunciado del PDF `Contexto_TF.pdf`: una empresa que administra departamentos tipo Airbnb en Lima necesita un sistema multimodal para evaluar listados de Barranco. La demo integra:

- Vision/CNN para calidad fotografica del anuncio.
- MLP/tabular para estimar desempeno esperado desde atributos del listado.
- LLM/chatbot para responder preguntas con descripcion y resenas.
- Analisis de sentimiento/ABSA para convertir resenas en score textual.
- Fusion tardia para entregar una sola decision comercial.

## Fuentes

- `C:/TF_DL/G4_mod_finale.xlsx`
  - Hoja `Principal`: 52 listados con atributos de ubicacion, host, precio, rating y disponibilidad.
  - Hoja `Reviews`: resenas en espanol por `ID Airbnb`.
- `public/data/listings.json`
  - Generado con `scripts/extract_dataset.py`.
  - Contiene 52 listados y 1592 resenas cruzadas con IDs presentes en `Principal`.
- `public/data/image-manifest.json`
  - Referencia 520 fotos locales, 10 por cada listado.
- `public/data/cnn-scores.json`
  - Contiene la salida integrada del modelo CNN `convnext_tiny` por alojamiento.
- `public/data/mlp-scores.json`
  - Contiene la salida integrada del modelo `MLP 8` por alojamiento.
- `public/data/review-sentiment.json`
  - Contiene sentimiento, emociones y ABSA para alimentar el score textual.

Nota importante: el Excel no trae fotos. Se agrego `scripts/fetch_airbnb_images.py` para extraer imagenes publicas referenciadas por la URL canonica de cada anuncio y guardarlas localmente en `public/img/<ID Airbnb>/`.

## Fotos reales

Fotos usadas: `public/img/<ID Airbnb>/photo-01.jpg`, `photo-02.jpg`, etc.

Metodo: lectura de la pagina publica canonica de Airbnb, extraccion de URLs publicas `a0.muscache.com` ya presentes en el HTML y descarga local. No se hizo login, no se abrieron galerias ocultas, no se resolvieron CAPTCHAs y no se llamaron endpoints privados.

Manifiesto: `public/data/image-manifest.json`.

Cobertura actual: 520 imagenes reales referenciadas en el manifest, con 10 fotos por cada uno de los 52 listados.

## Reglas de scoring

### Vision/CNN

La demo usa la salida integrada del modelo CNN entrenado sobre fotos del alojamiento:

- Archivo integrado: `public/data/cnn-scores.json`.
- Modelo final: `convnext_tiny`.
- Score visual: proporcion de fotos clasificadas por la CNN por encima de la mediana de calidad visual, normalizada a escala 0-100.
- Confianza: F1 macro de validacion del modelo final estable.

Metricas registradas: F1 macro en test `79.01` y F1 macro en validacion `81.92`.

### MLP tabular

La demo usa predicciones del modelo MLP entrenado:

- Archivo integrado: `public/data/mlp-scores.json`.
- Modelo final: `MLP 8`.
- Score tabular: calificacion esperada por el MLP normalizada a escala 0-100.
- Variables seleccionadas: gimnasio, amenidades por huesped y camas por huesped.
- Confianza usada en fusion: `94`.

Metricas registradas en validacion: MAE `0.060257`, RMSE `0.070535` y R2 `0.197673`.

### LLM / resenas

La demo usa RAG local con Ollama cuando el servidor `server/rag-server.mjs` esta activo:

- Modelo usado en esta demo: `llama3.1:8b` via Ollama.
- Endpoint local: `POST http://127.0.0.1:8787/api/rag-chat`.
- Recuperacion: ficha de `Principal` + resenas relevantes de `Reviews` para el `ID Airbnb` seleccionado.
- Generacion: el prompt obliga a responder solo con evidencia recuperada y a indicar cuando falta informacion.

Si Ollama no esta instalado, no esta corriendo o el modelo no esta descargado, la app conserva un fallback extractivo. Ese fallback no reemplaza al LLM: solo mantiene la demo funcional y muestra explicitamente `Fallback extractivo`.

El LLM no calcula los scores CNN ni MLP. El chatbot explica con evidencia recuperada, mientras vision, tabular, resenas y fusion permanecen auditables mediante archivos JSON.

La interfaz incorpora el puente textual del notebook mediante el boton `Resumen comercial`. Esta consulta genera una sintesis orientada a decision con fortalezas, riesgos, datos operativos, senales sobre limpieza, ubicacion, host, precio y una recomendacion preliminar. A diferencia de las preguntas puntuales, el resumen comercial puede usar una muestra ampliada de resenas por cobertura de categorias; por eso la evidencia visual distingue entre `relevancia del recuperador` y `seleccion por cobertura comercial`.

El boton `Exportar decision + chat JSON` descarga un artefacto auditable por alojamiento: decision final, scores CNN/MLP/resenas, fusion tardia, conversacion actual del chatbot, facts usados y resenas citadas. Esto permite revisar posteriormente el resumen comercial sin depender solo de la pantalla de la demo.

### Fusion tardia

Puntaje final:

```text
0.333 * Vision + 0.333 * Tabular + 0.333 * Resenas
```

Umbrales:

- `>= 75`: Recomendado.
- `50-74`: Revisar.
- `< 50`: No recomendado.

La confianza final se calcula con los mismos pesos iguales usando las confianzas de los tres modulos.

## Como ejecutar

```bash
pnpm install
pnpm run rag
pnpm start
```

Luego abrir `http://127.0.0.1:4200`.

Para usar el chatbot generativo:

```bash
ollama serve
ollama pull llama3.1:8b
pnpm run rag
pnpm start
```

Si `pnpm` bloquea scripts nativos despues de instalar:

```bash
pnpm approve-builds --all
```

## Archivos principales

- `src/app/scoring.ts`: fusion de scores y reglas de fallback cuando falta una fuente.
- `src/app/app.ts`: estado de Angular, carga de scores CNN/MLP/resenas y flujo de chatbot.
- `src/app/app.html`: demo visual y secciones de evidencia.
- `src/app/models.ts`: contratos de datos para listados, scores y evidencia del chatbot.
- `scripts/extract_dataset.py`: preparacion auditable del JSON desde el Excel.

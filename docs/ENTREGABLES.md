# Entregables - demo final multimodal

## Contexto usado

El prototipo responde al enunciado del PDF `Contexto_TF.pdf`: una empresa que administra departamentos tipo Airbnb en Lima necesita un sistema multimodal para evaluar listados de Barranco. La demo integra:

- Vision/CNN para calidad fotografica del anuncio.
- MLP/tabular para estimar desempeno esperado desde atributos del listado.
- LLM/chatbot para responder preguntas con descripcion y resenas.
- Fusion tardia para entregar una sola decision comercial.

## Fuentes

- `C:/TF_DL/G4_mod_finale.xlsx`
  - Hoja `Principal`: 51 listados con atributos de ubicacion, host, precio, rating y disponibilidad.
  - Hoja `Reviews`: resenas en espanol por `ID Airbnb`.
- `public/data/listings.json`
  - Generado con `scripts/extract_dataset.py`.
  - Contiene 51 listados y 589 resenas cruzadas con IDs presentes en `Principal`.

Nota importante: el Excel no trae fotos. Se agrego `scripts/fetch_airbnb_images.py` para extraer las imagenes publicas referenciadas por la URL canonica de cada anuncio y guardarlas localmente en `public/img/<ID Airbnb>/`.

## Fotos reales

Fotos usadas: `public/img/<ID Airbnb>/photo-01.jpg`, `photo-02.jpg`, etc.

Metodo: lectura de la pagina publica canonica de Airbnb, extraccion de URLs publicas `a0.muscache.com` ya presentes en el HTML y descarga local. No se hizo login, no se abrieron galerias ocultas, no se resolvieron CAPTCHAs y no se llamaron endpoints privados.

Manifiesto: `public/data/image-manifest.json`.

Cobertura actual: 147 imagenes reales descargadas para 49 de 51 listados. Dos listados no expusieron imagenes publicas recuperables con este metodo y quedan marcados como sin foto real.

## Reglas de scoring

### Vision/CNN

La demo calcula un score reproducible sobre pixeles de las fotos reales cargadas desde `public/img/<ID Airbnb>/`:

- Iluminacion: penaliza fotos muy oscuras o sobreexpuestas.
- Contraste: mide variabilidad de luminancia.
- Nitidez: aproxima detalle por energia de bordes.
- Color natural: favorece saturacion moderada.
- Cobertura util: penaliza pixeles extremos casi negros o quemados.

Puntaje visual = promedio ponderado de esas metricas. En una version con CNN pre-entrenada, esta funcion se reemplaza por la salida normalizada del modelo.

### MLP tabular

Baseline de demo para representar la regresion MLP:

- Rating actual.
- Precio competitivo contra el grupo Barranco.
- Numero de amenidades.
- Senales de confianza del host.
- Tiempo como host.
- Instant booking y politica de cancelacion.

Todos los atributos se normalizan a 0-1 y producen un score 0-100.

### LLM / resenas

La demo usa RAG local con Ollama cuando el servidor `server/rag-server.mjs` esta activo:

- Modelo usado en esta demo: `llama3.1:8b` via Ollama.
- Endpoint local: `POST http://127.0.0.1:8787/api/rag-chat`.
- Recuperacion: ficha de `Principal` + resenas relevantes de `Reviews` para el `ID Airbnb` seleccionado.
- Generacion: el prompt obliga a responder solo con evidencia recuperada y a indicar cuando falta informacion.

Si Ollama no esta instalado, no esta corriendo o el modelo no esta descargado, la app conserva un fallback extractivo. Ese fallback no reemplaza al LLM: solo mantiene la demo funcional y muestra explicitamente `Fallback extractivo`.

El LLM no calcula scores. Vision, tabular, resenas y fusion siguen siendo reglas deterministicas para que el puntaje sea auditable.

### Fusion tardia

Puntaje final:

```text
0.40 * Vision + 0.30 * Tabular + 0.30 * Resenas
```

Umbrales:

- `>= 75`: Recomendado.
- `50-74`: Revisar.
- `< 50`: No recomendado.

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

- `src/app/scoring.ts`: reglas comentadas de Vision, MLP, LLM y fusion.
- `src/app/app.ts`: estado de Angular, carga de datos, analisis de imagenes y flujo de chatbot.
- `src/app/app.html`: demo visual y secciones de evidencia.
- `scripts/extract_dataset.py`: preparacion auditable del JSON desde el Excel.

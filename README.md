# TF_DL_Grupo4 - demo final Angular

Demo multimodal para el Trabajo Final de Deep Learning: evaluacion de listados Airbnb en Barranco, Lima.

La interfaz integra los tres modulos exigidos por el trabajo: CNN visual, MLP tabular y LLM/chatbot RAG. Los notebooks se conservan como evidencia tecnica del entrenamiento y evaluacion, mientras la demo Angular + Node + Ollama muestra los scores finales, la fusion multimodal y las respuestas del chatbot para cada alojamiento.

## Arquitectura

- Frontend: Angular en `http://127.0.0.1:4200/`.
- Backend RAG local: Node.js en `server/rag-server.mjs`.
- Endpoint de salud: `http://127.0.0.1:8787/api/health`.
- Endpoint chatbot: `POST http://127.0.0.1:8787/api/rag-chat`.
- LLM local: Ollama con `llama3.1:8b`.
- Dataset procesado: `public/data/listings.json`.
- Scores CNN: `public/data/cnn-scores.json`.
- Scores MLP: `public/data/mlp-scores.json`.
- Scores de resenas/sentimiento: `public/data/review-sentiment.json`.
- Manifest de fotos reales: `public/data/image-manifest.json`.
- Fuente original del dataset: `C:\TF_DL\G4_mod_finale.xlsx`.
- Evidencia tecnica LLM/RAG: `docs/llm-rag/TF_Chatbot_RAG_Ollama_v6_eval_automatica.ipynb`.

## Flujo LLM/RAG

1. El usuario selecciona un alojamiento Airbnb.
2. Angular envia `listingId` y `question` al backend.
3. Node busca solo ese alojamiento en `public/data/listings.json`.
4. El RAG recupera ficha del anuncio y resenas relevantes del mismo `ID Airbnb`.
5. El backend construye un prompt con facts, texto real de resenas y restricciones anti-alucinacion.
6. Ollama genera la respuesta con `llama3.1:8b`.
7. Angular muestra `answer`, `facts`, `evidence`, `mode`, `model`, `retrievalTopic` y `note`.

Si Ollama falla, la app usa fallback extractivo local y lo marca visualmente como `Fallback extractivo`.

Los scores tecnicos del recuperador no se envian a Ollama como parte del contexto semantico. La respuesta del chatbot no debe mencionar `score`, `similitud`, `relevancia` ni porcentajes de recuperacion. Esos valores se muestran solo en la seccion visual de evidencia como `relevancia del recuperador`.

## Modulos Multimodales

- LLM/chatbot: funcional con RAG por alojamiento seleccionado + Ollama.
- MLP tabular: integrado desde predicciones del modelo entrenado `MLP 8`, normalizadas para fusion tardia.
- CNN visual: integrado desde predicciones del modelo entrenado `convnext_tiny` sobre fotos del alojamiento.
- Resenas/sentimiento: integrado desde el cuadro de control de analisis de sentimiento y ABSA.
- Fusion multimodal: promedio ponderado con pesos iguales configurados en el dataset.

## Fusion Multimodal

El puntaje final usa el mismo peso para los tres modulos:

```text
Puntaje final = 0.333 * Vision + 0.333 * Tabular + 0.333 * Resenas
```

Umbrales de decision:

- `>= 75`: Recomendado.
- `50-74`: Revisar.
- `< 50`: No recomendado.

La confianza final se calcula con la misma fusion de pesos iguales a partir de las confianzas de CNN, MLP y resenas.

## Ejecutar La Demo

Abre una terminal en la carpeta del proyecto:

```bash
cd "C:\Users\andre\OneDrive\Documentos\Deep Learning\TF_DL_Grupo4"
```

Instala dependencias:

```bash
pnpm install
```

Verifica Ollama:

```bash
ollama list
```

Si falta el modelo:

```bash
ollama pull llama3.1:8b
```

Inicia Ollama si no esta corriendo:

```bash
ollama serve
```

En otra terminal, inicia el backend RAG:

```bash
pnpm run rag
```

En otra terminal, inicia Angular:

```bash
pnpm start
```

Abre:

```text
http://127.0.0.1:4200/
```

Verifica el backend:

```text
http://127.0.0.1:8787/api/health
```

Debe mostrar `ok: true`, `model: llama3.1:8b` y `ollamaReachable: true`.

## Verificar Que Usa Ollama

En la interfaz, pregunta por ejemplo:

```text
Que opinan los huespedes sobre la limpieza y la ubicacion?
```

La respuesta debe mostrar:

- `Modo: ollama-rag`
- `Modelo: llama3.1:8b`
- Datos de ficha usados
- Resenas recuperadas como evidencia
- Nota de recuperacion RAG
- En la evidencia visual, los porcentajes aparecen etiquetados como `relevancia del recuperador`

La respuesta generada no debe incluir metadatos tecnicos como:

```text
relevancia 28.6%
score 0.346
similitud 0.346
```

Si muestra `extractive-fallback`, revisa que Ollama este abierto y que el modelo exista:

```bash
ollama pull llama3.1:8b
```

## Preparar Datos Desde Excel

```bash
python scripts/extract_dataset.py
```

Esto lee `C:\TF_DL\G4_mod_finale.xlsx` y genera:

```text
public/data/listings.json
```

## Descargar Fotos Reales Desde URLs Canonicas

```bash
python scripts/fetch_airbnb_images.py
```

Esto genera:

```text
public/img/<ID Airbnb>/
public/data/image-manifest.json
```

## Build

```bash
pnpm run build
```

La trazabilidad completa esta en `docs/ENTREGABLES.md`.

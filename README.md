# TF_DL_Grupo4 - demo final Angular

Demo multimodal para el Trabajo Final de Deep Learning: evaluacion de listados Airbnb en Barranco, Lima.

La interfaz esta enfocada en mostrar el modulo LLM/chatbot RAG ya validado en notebook Python/Jupyter. El notebook se conserva como evidencia tecnica del desarrollo, mientras esta demo Angular + Node + Ollama funciona como interfaz visual y punto de integracion futura para MLP y CNN.

## Arquitectura

- Frontend: Angular en `http://127.0.0.1:4200/`.
- Backend RAG local: Node.js en `server/rag-server.mjs`.
- Endpoint de salud: `http://127.0.0.1:8787/api/health`.
- Endpoint chatbot: `POST http://127.0.0.1:8787/api/rag-chat`.
- LLM local: Ollama con `llama3.1:8b`.
- Dataset procesado: `public/data/listings.json`.
- Fuente original del dataset: `C:\TF_DL\G4_mod_finale.xlsx`.

## Flujo LLM/RAG

1. El usuario selecciona un alojamiento Airbnb.
2. Angular envia `listingId` y `question` al backend.
3. Node busca solo ese alojamiento en `public/data/listings.json`.
4. El RAG recupera ficha del anuncio y resenas relevantes del mismo `ID Airbnb`.
5. El backend construye un prompt con facts, evidencia y restricciones anti-alucinacion.
6. Ollama genera la respuesta con `llama3.1:8b`.
7. Angular muestra `answer`, `facts`, `evidence`, `mode`, `model`, `retrievalTopic` y `note`.

Si Ollama falla, la app usa fallback extractivo local y lo marca visualmente como `Fallback extractivo`.

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
¿Qué opinan los huéspedes sobre la limpieza y la ubicación?
```

La respuesta debe mostrar:

- `Modo: ollama-rag`
- `Modelo: llama3.1:8b`
- Datos de ficha usados
- Reseñas recuperadas como evidencia
- Nota de recuperacion RAG

Si muestra `extractive-fallback`, revisa que Ollama este abierto y que el modelo exista:

```bash
ollama pull llama3.1:8b
```

## Modulos Multimodales

- LLM/chatbot: funcional con RAG por alojamiento seleccionado + Ollama.
- MLP tabular: pendiente de integrar modelo entrenado; la demo muestra un baseline auditable.
- CNN visual: pendiente de integrar modelo entrenado; la demo muestra analisis visual heuristico.
- Fusion multimodal: baseline demostrativo con pesos configurados en el dataset.

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

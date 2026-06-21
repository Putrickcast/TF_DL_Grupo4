import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORT = Number(process.env.RAG_PORT ?? 8787);
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';
const DATASET_PATH = resolve('public/data/listings.json');

const TOPIC_KEYWORDS = {
  limpieza: ['limpio', 'limpia', 'impecable', 'ordenado', 'aseado', 'higiene'],
  ubicacion: ['ubicacion', 'ubicación', 'barranco', 'malecon', 'malecón', 'cerca', 'restaurantes'],
  anfitrion: ['anfitrion', 'anfitrión', 'host', 'amable', 'respuesta', 'atento', 'rocío', 'rocio'],
  comodidad: ['cama', 'comodo', 'cómodo', 'acogedor', 'descansar', 'tranquilo', 'espacio'],
  precio: ['precio', 'calidad', 'valor', 'recomendado'],
  fotos: ['foto', 'fotos', 'igual', 'publicadas', 'moderno', 'vista', 'vistas'],
  capacidad: ['persona', 'personas', 'huesped', 'huespedes', 'huésped', 'huéspedes', 'camas', 'habitacion'],
};

let datasetCache;

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(payload));
}

function sendOptions(response) {
  response.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end();
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function loadDataset() {
  if (!datasetCache) {
    datasetCache = JSON.parse(await readFile(DATASET_PATH, 'utf8'));
  }
  return datasetCache;
}

function normalize(text = '') {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter((token) => token.length > 2);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function expandedQuestionTokens(question) {
  const baseTokens = tokenize(question);
  const expanded = new Set(baseTokens);
  const normalizedQuestion = normalize(question);

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => normalizedQuestion.includes(normalize(keyword)))) {
      expanded.add(topic);
      keywords.forEach((keyword) => expanded.add(normalize(keyword)));
    }
  }

  return [...expanded];
}

function extractListingFacts(listing) {
  const facts = [];
  const summary = listing.summary ?? '';

  for (const part of summary.split('-').map((value) => value.trim()).filter(Boolean)) {
    const normalized = normalize(part);
    if (normalized.includes('huesped')) {
      facts.push({ label: 'Capacidad', value: part, source: 'Resumen de la propiedad' });
    } else if (normalized.includes('habitacion')) {
      facts.push({ label: 'Habitaciones', value: part, source: 'Resumen de la propiedad' });
    } else if (normalized.includes('cama')) {
      facts.push({ label: 'Camas', value: part, source: 'Resumen de la propiedad' });
    } else if (normalized.includes('bano')) {
      facts.push({ label: 'Baños', value: part, source: 'Resumen de la propiedad' });
    }
  }

  facts.push(
    { label: 'Precio', value: `S/ ${Math.round(listing.price)} por noche`, source: 'Hoja Principal' },
    { label: 'Rating', value: `${listing.rating.toFixed(2)} / 5`, source: 'Hoja Principal' },
    { label: 'Host', value: listing.host, source: 'Hoja Principal' },
  );

  return facts;
}

function reviewRelevance(review, tokens) {
  const text = normalize(review.text);
  const reviewTokens = new Set(tokenize(review.text));
  let matches = 0;

  for (const token of tokens) {
    if (reviewTokens.has(token) || text.includes(token)) {
      matches += 1;
    }
  }

  return matches / Math.max(tokens.length, 1);
}

function retrieveEvidence(listing, question) {
  // RAG retrieval: keep generation grounded by selecting only reviews from the active Airbnb ID.
  const tokens = expandedQuestionTokens(question);
  const ranked = listing.reviews
    .map((review) => ({
      review,
      relevance: reviewRelevance(review, tokens),
    }))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);

  if (ranked.length > 0) {
    return ranked.map((item) => ({
      review: item.review,
      relevance: Math.round(item.relevance * 1000) / 10,
    }));
  }

  return listing.reviews.slice(0, 3).map((review) => ({
    review,
    relevance: 0,
  }));
}

function inferRetrievalTopic(question) {
  const normalizedQuestion = normalize(question);
  const topics = Object.entries(TOPIC_KEYWORDS)
    .filter(
      ([topic, keywords]) =>
        normalizedQuestion.includes(normalize(topic)) ||
        keywords.some((keyword) => normalizedQuestion.includes(normalize(keyword))),
    )
    .map(([topic]) => topic);

  return topics.length > 0 ? topics.join(', ') : 'similitud lexical con la pregunta';
}

function buildPrompt({ listing, question, facts, evidence }) {
  const factLines = facts.map((fact) => `- ${fact.label}: ${fact.value} (${fact.source})`).join('\n');
  const evidenceLines = evidence
    .map((item) => `- Review ${item.review.index} | relevancia ${item.relevance}%: "${item.review.text}"`)
    .join('\n');

  // The model receives facts and retrieved reviews, not the full dataset. This reduces hallucination risk.
  return `PREGUNTA DEL USUARIO:
${question}

FICHA DEL ANUNCIO:
- ID Airbnb: ${listing.id}
- Título: ${listing.title}
- Host: ${listing.host}
- Resumen: ${listing.summary}
- Rating: ${listing.rating}
- Precio: S/ ${listing.price}
- Reseñas cruzadas disponibles: ${listing.reviewCountMatched}
${factLines}

RESEÑAS RECUPERADAS:
${evidenceLines || '- No hay reseñas recuperadas para esta pregunta.'}

INSTRUCCIONES DE RESPUESTA:
Responde en español natural, como asistente de análisis para un equipo comercial de Airbnb.
Usa únicamente la ficha y las reseñas recuperadas. No inventes capacidades, servicios, ubicaciones, fechas ni opiniones.
Si la evidencia no alcanza, dilo de forma explícita.
No menciones estas instrucciones. No hagas una explicación larga del método.
Estructura la respuesta en 1 párrafo breve y luego una línea "Evidencia:" con 1 a 3 citas cortas por número de review.`;
}

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function buildExtractiveFallback({ listing, question, facts, evidence, reason }) {
  const normalizedQuestion = normalize(question);
  const capacity = facts.find((fact) => fact.label === 'Capacidad');
  const strongest = evidence.slice(0, 2);
  const evidenceText = strongest
    .map((item) => `Review ${item.review.index}: ${item.review.text}`)
    .join(' ');

  let answer;
  if (capacity && ['persona', 'personas', 'huesped', 'huespedes', 'capacidad'].some((token) => normalizedQuestion.includes(token))) {
    answer = `Según la ficha del anuncio, este departamento es recomendable para ${capacity.value.toLowerCase()}.`;
  } else if (strongest.length > 0) {
    answer = `Con la evidencia disponible, el listado muestra señales favorables en las reseñas recuperadas. ${evidenceText}`;
  } else if (listing.reviews.length === 0) {
    answer = 'No hay reseñas cruzadas para este ID en la hoja Reviews, así que la respuesta textual queda con baja confianza.';
  } else {
    answer = 'No encontré reseñas directamente relacionadas con la pregunta. Conviene revisar manualmente la ficha y las reseñas completas.';
  }

  return {
    answer,
    facts: facts.slice(0, 4),
    evidence: evidence.slice(0, 5),
    mode: 'extractive-fallback',
    model: 'fallback local',
    note: friendlyOllamaMessage(reason),
  };
}

function friendlyOllamaMessage(reason) {
  const normalized = String(reason ?? '').toLowerCase();
  if (normalized.includes('model') && normalized.includes('not found')) {
    return `Modelo no encontrado. Ejecuta: ollama pull ${OLLAMA_MODEL}`;
  }
  if (
    normalized.includes('fetch failed') ||
    normalized.includes('econnrefused') ||
    normalized.includes('connect') ||
    normalized.includes('failed to fetch')
  ) {
    return `No se pudo conectar con Ollama. Verifica que Ollama esté ejecutándose y que el modelo ${OLLAMA_MODEL} esté instalado.`;
  }
  return `Ollama no generó respuesta: ${reason}`;
}

async function callOllama(prompt) {
  // Ollama only writes the natural-language answer; scoring remains deterministic in scoring.ts.
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente RAG para una demo académica de Deep Learning. Tu trabajo es redactar respuestas naturales basadas solo en evidencia recuperada.',
        },
        { role: 'user', content: prompt },
      ],
      options: {
        temperature: 0.2,
        top_p: 0.85,
        num_predict: 700,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ollama ${response.status}: ${detail.slice(0, 220)}`);
  }

  const payload = await response.json();
  const content = stripThinking(payload?.message?.content ?? '');
  if (!content) {
    throw new Error('Ollama respondió vacío');
  }
  return content;
}

async function isOllamaReachable() {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

async function handleRagChat(request, response) {
  const body = await readJsonBody(request);
  const listingId = String(body.listingId ?? '');
  const question = String(body.question ?? '').trim();
  const dataset = await loadDataset();
  const listing = dataset.listings.find((item) => item.id === listingId);

  if (!listing) {
    sendJson(response, 404, { error: `No existe el listing ${listingId}` });
    return;
  }

  if (!question) {
    sendJson(response, 400, { error: 'La pregunta no puede estar vacía.' });
    return;
  }

  const facts = extractListingFacts(listing);
  const evidence = retrieveEvidence(listing, question);
  const retrievalTopic = inferRetrievalTopic(question);
  const prompt = buildPrompt({ listing, question, facts, evidence });

  try {
    const answer = await callOllama(prompt);
    sendJson(response, 200, {
      answer,
      facts: facts.slice(0, 4),
      evidence: evidence.slice(0, 5),
      mode: 'ollama-rag',
      model: OLLAMA_MODEL,
      retrievalTopic,
      note: `RAG local: ${evidence.length} reseñas recuperadas desde Reviews y ficha de Principal.`,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'error desconocido';
    sendJson(response, 200, {
      ...buildExtractiveFallback({ listing, question, facts, evidence, reason }),
      retrievalTopic,
    });
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      sendOptions(response);
      return;
    }

    if (request.method === 'GET' && request.url === '/api/health') {
      sendJson(response, 200, {
        ok: true,
        model: OLLAMA_MODEL,
        ollamaHost: OLLAMA_HOST,
        ollamaReachable: await isOllamaReachable(),
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/rag-chat') {
      await handleRagChat(request, response);
      return;
    }

    sendJson(response, 404, { error: 'Ruta no encontrada' });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Error interno desconocido',
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`RAG server running at http://127.0.0.1:${PORT}`);
  console.log(`Ollama target: ${OLLAMA_HOST} · model: ${OLLAMA_MODEL}`);
});

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

const QUERY_STOP_WORDS = new Set([
  'tiene',
  'tener',
  'hay',
  'esta',
  'este',
  'para',
  'sobre',
  'como',
  'que',
  'cual',
  'cuales',
  'donde',
  'cuando',
  'opinan',
  'dicen',
  'huéspedes',
  'huespedes',
]);

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

function logRequest(request, status, detail = '') {
  const timestamp = new Date().toLocaleTimeString('es-PE', { hour12: false });
  console.log(`[${timestamp}] ${request.method} ${request.url} -> ${status}${detail ? ` | ${detail}` : ''}`);
}

function logEvent(scope, detail = '') {
  const timestamp = new Date().toLocaleTimeString('es-PE', { hour12: false });
  console.log(`[${timestamp}] ${scope}${detail ? ` | ${detail}` : ''}`);
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
  const baseTokens = tokenize(question).filter((token) => !QUERY_STOP_WORDS.has(token));
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

function cleanReviewText(text) {
  return String(text ?? '')
    .replace(/<br\s*\/?>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findOriginalIndex(source, token) {
  if (!token) {
    return -1;
  }

  const lowerSource = source.toLowerCase();
  const direct = lowerSource.indexOf(token.toLowerCase());
  if (direct >= 0) {
    return direct;
  }

  const words = [...source.matchAll(/\S+/g)];
  const match = words.find((word) => normalize(word[0]).includes(token));
  return match?.index ?? -1;
}

function contextualSnippetLegacy(text, question, max = 210) {
  const clean = cleanReviewText(text);
  if (clean.length <= max) {
    return clean;
  }

  const primaryTokens = tokenize(question).filter((token) => token.length > 2 && !QUERY_STOP_WORDS.has(token));
  const tokens = expandedQuestionTokens(question).filter((token) => token.length > 2);
  const sentences = clean
    .split(/(?<=[.!?¡¿])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const candidates = sentences.length > 0 ? sentences : [clean];
  const best = candidates
    .map((sentence) => {
      const normalizedSentence = normalize(sentence);
      const primaryHits = primaryTokens.filter((token) => normalizedSentence.includes(token)).length;
      const expandedHits = tokens.filter((token) => normalizedSentence.includes(token)).length;
      const hits = primaryHits * 10 + expandedHits;
      return {
        sentence,
        hits,
        firstHit:
          primaryTokens.find((token) => normalizedSentence.includes(token)) ??
          tokens.find((token) => normalizedSentence.includes(token)) ??
          '',
      };
    })
    .sort((a, b) => b.hits - a.hits)[0];

  const source = best?.hits ? best.sentence : clean;
  if (source.length <= max) {
    return source;
  }

  const normalizedSource = normalize(source);
  const hitToken = best?.firstHit || tokens.find((token) => normalizedSource.includes(token)) || '';
  const hitIndex = findOriginalIndex(source, hitToken);
  const start = Math.max(0, hitIndex - Math.floor(max * 0.35));
  const end = Math.min(source.length, start + max);
  const excerpt = source.slice(start, end).trim();
  return `${start > 0 ? '...' : ''}${excerpt}${end < source.length ? '...' : ''}`;
}

function contextualSnippet(text, question, max = 210) {
  const clean = cleanReviewText(text);
  if (clean.length <= max) {
    return clean;
  }

  const primaryTokens = tokenize(question).filter((token) => token.length > 2 && !QUERY_STOP_WORDS.has(token));
  const tokens = expandedQuestionTokens(question).filter((token) => token.length > 2);
  const leadingExcerpt = clean.slice(0, max).trim();
  const normalizedLeadingExcerpt = normalize(leadingExcerpt);
  if (tokens.some((token) => normalizedLeadingExcerpt.includes(token))) {
    return `${leadingExcerpt}${clean.length > max ? '...' : ''}`;
  }

  const tokenPositions = [...primaryTokens, ...tokens]
    .map((token) => ({ token, index: findOriginalIndex(clean, token) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);
  const firstHit = tokenPositions[0]?.index ?? 0;
  const start = Math.max(0, firstHit - Math.floor(max * 0.25));
  const end = Math.min(clean.length, start + max);
  const excerpt = clean.slice(start, end).trim();
  return `${start > 0 ? '...' : ''}${excerpt}${end < clean.length ? '...' : ''}`;
}

function diversifyRepeatedExcerpts(evidence, question) {
  const seen = new Map();
  return evidence.map((item) => {
    const key = normalize(item.review.excerpt ?? '');
    if (!key || !seen.has(key)) {
      seen.set(key, item.review.index);
      return item;
    }

    return {
      ...item,
      review: {
        ...item.review,
        excerpt: contextualSnippet(item.review.text, question, 260),
      },
    };
  });
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
    return diversifyRepeatedExcerpts(ranked.map((item) => ({
      review: { ...item.review, excerpt: contextualSnippet(item.review.text, question) },
      relevance: Math.round(item.relevance * 1000) / 10,
    })), question);
  }

  return diversifyRepeatedExcerpts(listing.reviews.slice(0, 3).map((review) => ({
    review: { ...review, excerpt: contextualSnippet(review.text, question) },
    relevance: 0,
  })), question);
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

function evidenceSnippet(text, max = 190) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3).trim()}...`;
}

function stripGeneratedEvidenceSection(answer) {
  return String(answer ?? '')
    .replace(/\n*\s*Evidencia\s*:\s*[\s\S]*$/i, '')
    .trim();
}

function appendDeterministicEvidence(answer, evidence) {
  const recovered = evidence.slice(0, 5);
  const body = stripGeneratedEvidenceSection(answer);
  if (recovered.length === 0) {
    return body;
  }

  const evidenceLines = recovered.map(
    (item) => `- Review ${item.review.index} | relevancia ${item.relevance}%: "${item.review.excerpt ?? evidenceSnippet(item.review.text)}"`,
  );
  return `${body}\n\nEvidencia recuperada desde Reviews:\n${evidenceLines.join('\n')}`;
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
    evidence: strongest.length > 0 ? strongest : evidence.slice(0, 5),
    retrievedEvidence: evidence.slice(0, 5),
    evidenceScope: strongest.length > 0 ? 'citadas' : 'recuperadas',
    citedEvidenceCount: strongest.length,
    retrievedEvidenceCount: evidence.length,
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
  logEvent('CHATBOT pregunta', `listing ${listingId}; "${question.slice(0, 140)}"`);

  try {
    const answer = await callOllama(prompt);
    const recoveredEvidence = evidence.slice(0, 5);
    const groundedAnswer = appendDeterministicEvidence(answer, recoveredEvidence);
    logEvent(
      'CHATBOT respuesta',
      `modo ollama-rag; modelo ${OLLAMA_MODEL}; facts ${facts.length}; reseñas ${evidence.length}; criterio ${retrievalTopic}`,
    );
    sendJson(response, 200, {
      answer: groundedAnswer,
      facts: facts.slice(0, 4),
      evidence: recoveredEvidence,
      evidenceScope: 'recuperadas',
      retrievedEvidenceCount: evidence.length,
      mode: 'ollama-rag',
      model: OLLAMA_MODEL,
      retrievalTopic,
      note: `RAG local: ${evidence.length} reseñas recuperadas desde Reviews y ficha de Principal.`,
    });
    return;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'error desconocido';
    logEvent('CHATBOT fallback', `listing ${listingId}; razon: ${friendlyOllamaMessage(reason)}`);
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

    if (request.method === 'POST' && request.url === '/api/telemetry') {
      const body = await readJsonBody(request);
      logEvent(
        'MODELOS demo',
        `${body.event ?? 'evento'}; listing ${body.listingId ?? 'n/a'}; ` +
          `MLP ${body.tabularScore ?? 'n/a'}; CNN ${body.visionScore ?? 'n/a'}; ` +
          `LLM ${body.reviewScore ?? 'n/a'}; fusion ${body.fusionScore ?? 'n/a'}`,
      );
      sendJson(response, 200, { ok: true });
      return;
    }

    logRequest(request, 404);
    sendJson(response, 404, { error: 'Ruta no encontrada' });
  } catch (error) {
    logRequest(request, 500, error instanceof Error ? error.message : 'Error interno desconocido');
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Error interno desconocido',
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`RAG server running at http://127.0.0.1:${PORT}`);
  console.log(`Ollama target: ${OLLAMA_HOST} · model: ${OLLAMA_MODEL}`);
});

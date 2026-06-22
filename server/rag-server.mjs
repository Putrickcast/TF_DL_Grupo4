import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseUrl } from 'node:url';

const PORT = Number(process.env.RAG_PORT ?? 8787);
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';
const DATASET_PATH = resolve('public/data/listings.json');
const IMAGE_OUTPUT_ROOT = resolve('public/img');
const IMAGE_MANIFEST_PATH = resolve('public/data/image-manifest.json');
const MAX_IMAGES_PER_LISTING = 8;
const IMAGE_USER_AGENT = 'Mozilla/5.0 (compatible; academic-project-airbnb-photo-fetch/1.0)';

const TOPIC_KEYWORDS = {
  amenidades: [
    'amenidad',
    'amenidades',
    'servicio',
    'servicios',
    'piscina',
    'pool',
    'jacuzzi',
    'gimnasio',
    'gym',
    'coworking',
    'cowork',
    'wifi',
    'internet',
    'aire acondicionado',
    'cocina',
    'lavadora',
    'secadora',
    'estacionamiento',
    'parrilla',
    'balcon',
    'balcón',
    'televisor',
    'smart tv',
  ],
  limpieza: ['limpieza', 'limpio', 'limpia', 'impecable', 'ordenado', 'aseado', 'higiene'],
  ubicacion: ['ubicacion', 'ubicación', 'zona', 'barranco', 'malecon', 'malecón', 'cerca', 'cercania', 'cercanía', 'restaurantes', 'tranquilo', 'acceso'],
  anfitrion: ['anfitrion', 'anfitrión', 'host', 'amable', 'respuesta', 'atento', 'atencion', 'atención', 'comunicacion', 'comunicación', 'rocío', 'rocio'],
  comodidad: ['cama', 'comodo', 'cómodo', 'acogedor', 'descansar', 'tranquilo', 'espacio'],
  precio: ['precio', 'calidad', 'valor', 'razonable', 'caro', 'barato', 'recomendado', 'cumple'],
  fotos: ['foto', 'fotos', 'igual', 'publicadas', 'moderno', 'vista', 'vistas'],
  remoto: ['wifi', 'internet', 'trabajo', 'remoto', 'cowork', 'coworking', 'computador', 'ordenador'],
  quejas: ['queja', 'quejas', 'problema', 'problemas', 'malo', 'mala', 'sucio', 'sucia', 'ruido', 'difícil', 'dificil', 'falta', 'fallo', 'privacidad'],
  mejoras: ['mejorar', 'mejora', 'mejoras', 'debilidad', 'debilidades', 'aspectos negativos', 'negativo', 'critica', 'crítica', 'criticas', 'críticas'],
  positivo: ['positivo', 'positivos', 'aspecto positivo', 'aspectos positivos', 'fortaleza', 'fortalezas', 'recomienda', 'recomendado', 'excelente', 'bueno', 'buena', 'bonito', 'agradable'],
  comercial: ['conviene', 'administrar', 'inversion', 'inversión', 'rentable', 'negocio', 'decision', 'decisión', 'comercial'],
  capacidad: [
    'persona',
    'personas',
    'pareja',
    'parejas',
    'familia',
    'familias',
    'grupo',
    'grupos',
    'huesped',
    'huespedes',
    'huésped',
    'huéspedes',
    'cama',
    'camas',
    'habitacion',
    'habitación',
    'bano',
    'baño',
    'comodo',
    'cómodo',
    'equipado',
    'preparado',
    'estancia',
    'estadía',
    'largo plazo',
    'mediana estadía',
  ],
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

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
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
    .replace(/\bwi[\s-]*fi\b/g, 'wifi')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter((token) => token.length > 2);
}

function normalizedIncludesTerm(normalizedText, term) {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) {
    return false;
  }

  if (normalizedTerm.includes(' ')) {
    return normalizedText.includes(normalizedTerm);
  }

  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalizedText);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeImageUrl(url = '') {
  return String(url)
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

function roomIdFromUrl(url = '') {
  return /\/rooms\/(\d+)/.exec(url)?.[1] ?? '';
}

function isPublicAirbnbPhoto(url = '') {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'a0.muscache.com' &&
      parsed.pathname.includes('/im/pictures/') &&
      !parsed.pathname.includes('AirbnbPlatformAssets')
    );
  } catch {
    return false;
  }
}

function hasHostingMarker(url, listingId) {
  return Boolean(listingId) && url.includes(`Hosting-${listingId}`);
}

function uniquePhotoUrls(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    try {
      const key = new URL(url).pathname;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(url);
    } catch {
      // Ignore malformed candidates.
    }
  }
  return result;
}

function extractListingImageUrls(htmlText, listingId, canonicalUrl) {
  const candidates = [];
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/g,
    /"picture_url"\s*:\s*"([^"]+)"/g,
    /"baseUrl"\s*:\s*"(https:\/\/a0\.muscache\.com\/[^"]+)"/g,
    /(https:\/\/a0\.muscache\.com\/im\/pictures\/[^"\\<>\s]+)/g,
  ];

  for (const pattern of patterns) {
    for (const match of htmlText.matchAll(pattern)) {
      const url = normalizeImageUrl(match[1]);
      if (isPublicAirbnbPhoto(url) && !candidates.includes(url)) {
        candidates.push(url);
      }
    }
  }

  const roomId = roomIdFromUrl(canonicalUrl);
  const strictMatches = candidates.filter(
    (url) => hasHostingMarker(url, listingId) || hasHostingMarker(url, roomId),
  );

  return uniquePhotoUrls(strictMatches.length > 0 ? strictMatches : candidates);
}

function imageExtensionFor(url, contentType = '') {
  const lowerContentType = contentType.toLowerCase();
  if (lowerContentType.includes('webp')) {
    return '.webp';
  }
  const pathname = parseUrl(url).pathname?.toLowerCase() ?? '';
  if (pathname.endsWith('.png')) {
    return '.png';
  }
  if (pathname.endsWith('.webp')) {
    return '.webp';
  }
  return '.jpg';
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': IMAGE_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) {
    throw new Error(`Airbnb ${response.status}: ${response.statusText}`);
  }
  return response.text();
}

async function downloadImage(url, outPathWithoutExtension) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': IMAGE_USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`Imagen ${response.status}: ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  const extension = imageExtensionFor(url, contentType);
  const outPath = `${outPathWithoutExtension}${extension}`;
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(outPath, bytes);
  return outPath;
}

async function loadImageManifest() {
  try {
    return JSON.parse(await readFile(IMAGE_MANIFEST_PATH, 'utf8'));
  } catch {
    return {
      meta: {
        generatedAt: new Date().toISOString(),
        source: 'Airbnb canonical public HTML + a0.muscache.com image URLs',
        method:
          'Fetch canonical page, extract public listing image URLs from HTML, save locally under public/img/<ID Airbnb>/.',
        maxImagesPerListing: MAX_IMAGES_PER_LISTING,
      },
      listings: {},
    };
  }
}

function expandedQuestionTokens(question) {
  const baseTokens = tokenize(question).filter((token) => !QUERY_STOP_WORDS.has(token));
  const expanded = new Set(baseTokens);
  const normalizedQuestion = normalize(question);

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => normalizedIncludesTerm(normalizedQuestion, keyword))) {
      expanded.add(topic);
      if (topic === 'amenidades' || topic === 'remoto') {
        keywords
          .filter((keyword) => normalizedIncludesTerm(normalizedQuestion, keyword))
          .forEach((keyword) => expanded.add(normalize(keyword)));
      } else {
        keywords.forEach((keyword) => expanded.add(normalize(keyword)));
      }
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
    { label: 'Distrito', value: listing.district, source: 'Hoja Principal' },
    { label: 'Amenidades', value: `${listing.amenities}`, source: 'Hoja Principal' },
    { label: 'Superhost', value: listing.superhost ? 'Sí' : 'No', source: 'Hoja Principal' },
    { label: 'Tiempo como host', value: `${listing.hostYears} años`, source: 'Hoja Principal' },
    { label: 'Reconocimiento', value: listing.recognition || 'No indicado', source: 'Hoja Principal' },
  );

  return facts;
}

function reviewRelevance(review, tokens) {
  const text = normalize(review.text);
  const reviewTokens = new Set(tokenize(review.text));
  let matches = 0;

  for (const token of tokens) {
    if (reviewTokens.has(token) || normalizedIncludesTerm(text, token)) {
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

function informativeReviewText(text) {
  const clean = cleanReviewText(text);
  const normalized = normalize(clean);
  if (clean.length < 35) {
    return false;
  }
  return ![
    'las resenas de los huespedes mencionan',
    'las reseñas de los huéspedes mencionan',
    'resenas de los huespedes',
    'reseñas de los huéspedes',
  ].some((phrase) => normalized.includes(normalize(phrase)));
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

function snippetAroundTerms(text, terms, max = 190) {
  const clean = cleanReviewText(text);
  if (!clean) {
    return '';
  }

  const normalizedClean = normalize(clean);
  const normalizedTerms = unique(terms.map((term) => normalize(term)).filter(Boolean));
  const hit = normalizedTerms
    .map((term) => ({ term, index: findOriginalIndex(clean, term) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0];

  if (!hit) {
    return clean.length <= max ? clean : `${clean.slice(0, max).trim()}...`;
  }

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const sentence = sentences.find((item) => normalizedTerms.some((term) => normalizedIncludesTerm(normalize(item), term)));
  if (sentence && sentence.length <= max) {
    return sentence;
  }

  const start = Math.max(0, hit.index - Math.floor(max * 0.35));
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

function detectIntent(question) {
  const normalizedQuestion = normalize(question);
  const hasAny = (tokens) => tokens.some((token) => normalizedIncludesTerm(normalizedQuestion, token));
  const categories = new Set();

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (normalizedIncludesTerm(normalizedQuestion, topic) || hasAny(keywords)) {
      categories.add(topic);
    }
  }

  if (hasAny(['que opinan', 'qué opinan', 'dicen los huespedes', 'dicen los huéspedes', 'experiencia'])) {
    categories.add('experiencia');
  }

  const explicitCapacityIntent = hasAny([
    'capacidad',
    'cuantas',
    'cuántas',
    'cuantos',
    'cuántos',
    'persona',
    'personas',
    'familia',
    'familias',
    'grupo',
    'grupos',
    'cama',
    'camas',
    'habitacion',
    'habitación',
    'banos',
    'baños',
  ]);
  const hasSpecificNonCapacityIntent = ['amenidades', 'limpieza', 'ubicacion', 'anfitrion', 'precio', 'quejas', 'mejoras', 'remoto', 'fotos', 'positivo']
    .some((category) => categories.has(category));
  if (categories.has('capacidad') && hasSpecificNonCapacityIntent && !explicitCapacityIntent) {
    categories.delete('capacidad');
  }

  if (categories.size === 0) {
    categories.add('general');
  }

  const asksAboutImprovements = categories.has('mejoras') || hasAny([
    'deberia mejorar',
    'debería mejorar',
    'que puede mejorar',
    'qué puede mejorar',
  ]);
  const asksAboutComplaints = categories.has('quejas');
  const asksAboutCapacity = categories.has('capacidad');
  const asksCommercialDecision = categories.has('comercial');
  const asksAboutAmenities = categories.has('amenidades') || categories.has('remoto');
  const amenityTerms = ['amenidades', 'remoto']
    .flatMap((category) => TOPIC_KEYWORDS[category] ?? [])
    .filter((keyword) => !['amenidad', 'amenidades', 'servicio', 'servicios'].includes(normalize(keyword)))
    .filter((keyword) => normalizedIncludesTerm(normalizedQuestion, keyword));

  return {
    categories: [...categories],
    asksAboutImprovements,
    asksAboutComplaints,
    asksAboutCapacity,
    asksCommercialDecision,
    asksAboutAmenities,
    amenityTerms,
  };
}

function reviewKeywordsForIntent(intent) {
  const keywords = new Set();
  for (const category of intent.categories) {
    const topicKeywords = TOPIC_KEYWORDS[category] ?? [];
    if ((category === 'amenidades' || category === 'remoto') && intent.amenityTerms?.length) {
      intent.amenityTerms.forEach((keyword) => keywords.add(normalize(keyword)));
    } else {
      topicKeywords.forEach((keyword) => keywords.add(normalize(keyword)));
    }
  }

  if (intent.categories.includes('experiencia') || intent.asksCommercialDecision || intent.categories.includes('general')) {
    ['excelente', 'bueno', 'buena', 'limpio', 'ubicacion', 'comodo', 'anfitrion', 'recomendado', 'problema', 'valor'].forEach((keyword) => keywords.add(keyword));
  }

  return [...keywords].filter(Boolean);
}

function reviewMatchesIntent(review, question, intent) {
  if (intent.asksCommercialDecision || intent.categories.includes('general') || intent.categories.includes('experiencia')) {
    return true;
  }

  const normalizedText = normalize(review.text);
  const intentKeywords = reviewKeywordsForIntent(intent);
  if (intentKeywords.some((keyword) => normalizedIncludesTerm(normalizedText, keyword))) {
    return true;
  }

  return expandedQuestionTokens(question).some((token) => normalizedIncludesTerm(normalizedText, token));
}

function dedupeExactReviews(reviews) {
  const seen = new Set();
  return reviews.filter((item) => {
    const key = normalize(cleanReviewText(item.review.text));
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function reviewTokenSet(text) {
  return new Set(tokenize(text).filter((token) => !QUERY_STOP_WORDS.has(token)));
}

function tokenJaccard(a, b) {
  const aTokens = reviewTokenSet(a);
  const bTokens = reviewTokenSet(b);
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (aTokens.size + bTokens.size - intersection);
}

function dedupeNearDuplicateEvidence(evidence) {
  const diverse = [];
  for (const item of evidence) {
    const clean = cleanReviewText(item.review.text);
    const isDuplicate = diverse.some((kept) => tokenJaccard(clean, cleanReviewText(kept.review.text)) >= 0.78);
    if (!isDuplicate) {
      diverse.push(item);
    }
  }
  return diverse;
}

function retrieveEvidence(listing, question, intent) {
  // RAG retrieval: keep generation grounded by selecting only reviews from the active Airbnb ID.
  const tokens = expandedQuestionTokens(question);
  const ranked = dedupeNearDuplicateEvidence(dedupeExactReviews(listing.reviews
    .filter((review) => informativeReviewText(review.text))
    .map((review) => ({
      review,
      relevance: reviewRelevance(review, tokens),
    }))))
    .filter((item) => reviewMatchesIntent(item.review, question, intent))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);

  if (ranked.length > 0) {
    return diversifyRepeatedExcerpts(ranked.map((item) => ({
      review: { ...item.review, excerpt: contextualSnippet(item.review.text, question) },
      relevance: Math.round(item.relevance * 1000) / 10,
    })), question);
  }

  if (!intent.asksCommercialDecision && !intent.categories.includes('general') && !intent.categories.includes('experiencia')) {
    return [];
  }

  return diversifyRepeatedExcerpts(dedupeExactReviews(listing.reviews.filter((review) => informativeReviewText(review.text)).map((review) => ({
    review: { ...review, excerpt: contextualSnippet(review.text, question) },
    relevance: 0,
  }))).slice(0, 3), question);
}

function selectUsefulEvidenceForIntent(evidence, question, intent) {
  const candidates = dedupeNearDuplicateEvidence(evidence)
    .filter((item) => informativeReviewText(item.review.text))
    .filter((item) => item.relevance > 0 || reviewMatchesIntent(item.review, question, intent));

  if (intent.asksAboutAmenities) {
    const terms = amenityTermsFromIntent(intent);
    return candidates.filter((item) =>
      terms.some((term) => normalizedIncludesTerm(normalize(item.review.text), term)),
    );
  }

  if (intent.asksAboutCapacity && !intent.asksAboutImprovements) {
    const capacityTerms = [
      'pareja',
      'familia',
      'grupo',
      'huesped',
      'huésped',
      'huespedes',
      'huéspedes',
      'persona',
      'personas',
      'dos personas',
      'comodo',
      'cómodo',
      'acogedor',
      'equipado',
      'preparado',
      'estadia',
      'estadía',
      'estancia',
    ];
    return candidates.filter((item) =>
      capacityTerms.some((term) => normalizedIncludesTerm(normalize(item.review.text), term)),
    );
  }

  if (intent.asksAboutComplaints || intent.asksAboutImprovements) {
    return improvementSignalsFromEvidence(candidates);
  }

  const patternCategories = categoriesForPatternContext(intent);
  if (patternCategories.length > 0) {
    const byIndex = new Map();
    for (const category of patternCategories) {
      directlyRelevantReviews(category, candidates).forEach((item) => byIndex.set(item.review.index, item));
    }
    return [...byIndex.values()];
  }

  return candidates;
}

function evidenceSnippetTerms(intent, question) {
  if (intent.asksAboutAmenities) {
    return amenityTermsFromIntent(intent);
  }

  const terms = [];
  const snippetCategories = intent.categories.filter((category) => REVIEW_SIGNAL_PATTERNS[category] && category !== 'experiencia');
  const categories = snippetCategories.length > 0 ? snippetCategories : categoriesForPatternContext(intent);
  for (const category of categories) {
    (TOPIC_KEYWORDS[category] ?? []).forEach((keyword) => terms.push(keyword));
    (REVIEW_SIGNAL_PATTERNS[category] ?? []).forEach((pattern) => {
      pattern.keywords.forEach((keyword) => terms.push(keyword));
    });
  }

  if (intent.asksAboutCapacity && !intent.asksAboutImprovements) {
    terms.push('persona', 'personas', 'pareja', 'familia', 'grupo', 'huesped', 'huésped', 'cama', 'estadia', 'estadía', 'estancia');
  }

  if (terms.length > 0) {
    return unique(terms);
  }

  return unique(expandedQuestionTokens(question).filter((token) => token.length > 3 && !QUERY_STOP_WORDS.has(token)));
}

function applyUsefulSnippets(evidence, question, intent) {
  const terms = evidenceSnippetTerms(intent, question);
  return evidence.map((item) => ({
    ...item,
    review: {
      ...item.review,
      excerpt: snippetAroundTerms(item.review.text, terms, 190),
    },
  }));
}

function inferRetrievalTopic(question) {
  const normalizedQuestion = normalize(question);
  const topics = Object.entries(TOPIC_KEYWORDS)
    .filter(
      ([topic, keywords]) =>
        normalizedIncludesTerm(normalizedQuestion, topic) ||
        keywords.some((keyword) => normalizedIncludesTerm(normalizedQuestion, keyword)),
    )
    .map(([topic]) => topic);

  return topics.length > 0 ? topics.join(', ') : 'coincidencia lexical con la pregunta';
}

function buildIntentInstructions(intent) {
  const categories = intent.categories.join(', ');
  const lines = [
    'Responde únicamente a la pregunta actual del usuario. No agregues comentarios sobre temas no solicitados.',
    `Intención detectada: ${categories}. Usa esta intención para decidir qué fuentes son relevantes.`,
    'No menciones ausencia de mejoras, quejas o problemas si la pregunta no trata sobre mejoras, quejas o problemas.',
    'Usa únicamente las fuentes listadas en este prompt. Si una fuente no aparece o no aporta evidencia útil para la intención, no la menciones artificialmente.',
    'Ficha del anuncio = fuente para datos objetivos: capacidad, habitaciones, camas, baños, precio, rating, host, superhost, amenidades, distrito y descripción objetiva.',
    'Reseñas recuperadas = fuente para experiencia del huésped: comodidad, limpieza, ubicación percibida, trato del anfitrión, comunicación, quejas, relación precio-calidad, percepción de fotos, recomendación de uso y adecuación para tipos de huésped.',
    'Si ficha y reseñas aportan evidencia relevante, sintetiza ambas. Si solo una fuente aporta, responde solo con esa fuente.',
    'Cuando haya varias reseñas relevantes, no bases la respuesta en una sola. Resume patrones comunes y menciona matices importantes de las reseñas recuperadas.',
    'El score de recuperación no decide por sí solo qué se menciona; considera también frases directamente relacionadas con la pregunta aunque provengan de una reseña con menor score.',
    'Si varias reseñas coinciden en un tema, usa formulaciones como “Varias reseñas destacan”, “Los huéspedes coinciden en” o “Se repite como fortaleza”.',
    'Si solo una reseña aporta información real sobre la pregunta, aclara que la evidencia textual es limitada.',
    'Si no hay evidencia suficiente para la intención preguntada, responde exactamente: “No hay evidencia suficiente en la ficha o reseñas recuperadas para afirmarlo con seguridad.”',
  ];

  if (intent.asksAboutImprovements) {
    lines.push(
      'Como la pregunta trata sobre mejoras, quejas, debilidades o problemas, puedes mencionar mejoras solo si aparecen críticas claras en la ficha o reseñas; si no aparecen, indica que no se identifican mejoras específicas con la evidencia disponible.',
    );
  }

  if (intent.asksAboutCapacity) {
    lines.push(
      'Como la pregunta trata sobre capacidad, enfócate solo en capacidad, número de huéspedes, habitaciones, camas, baños y reseñas directamente relacionadas si existen.',
      'Para preguntas de capacidad no menciones mejoras, host, problemas, privacidad ni falta de críticas, salvo que el usuario lo pida explícitamente.',
    );
  }

  if (intent.asksAboutComplaints) {
    lines.push(
      'Como la pregunta trata sobre quejas o problemas, usa principalmente críticas claras en las reseñas. Si hay una crítica aislada, aclara que no parece frecuente. No inventes problemas.',
    );
  }

  if (intent.categories.includes('precio')) {
    lines.push(
      'Como la pregunta trata sobre precio o valor, combina precio, rating o amenidades de la ficha con reseñas de valor, recomendación, comodidad, ubicación o cumplimiento solo si esas reseñas existen.',
    );
  }

  if (intent.categories.includes('limpieza')) {
    lines.push('Como la pregunta trata sobre limpieza, usa principalmente reseñas que mencionen limpieza, orden o higiene.');
  }

  if (intent.categories.includes('ubicacion')) {
    lines.push('Como la pregunta trata sobre ubicación, usa distrito o descripción objetiva si aportan y reseñas que mencionen zona, cercanía, tranquilidad, acceso o restaurantes.');
  }

  if (intent.categories.includes('anfitrion')) {
    lines.push('Como la pregunta trata sobre anfitrión, usa reseñas sobre trato, comunicación, cordialidad o atención, y datos de host/superhost solo si aportan.');
  }

  if (intent.asksAboutAmenities) {
    lines.push(
      'Como la pregunta trata sobre amenidades o servicios, usa descripción objetiva, amenidades, reconocimiento del anuncio y reseñas que mencionen esa amenidad o experiencia relacionada. No menciones capacidad, habitaciones, camas ni baños salvo que el usuario también pregunte por eso.',
    );
  }

  if (intent.asksCommercialDecision) {
    lines.push(
      'Como la pregunta es de conveniencia comercial, puedes integrar ficha y reseñas para resumir fortalezas, riesgos y señales de decisión.',
    );
  }

  return lines.map((line) => `- ${line}`).join('\n');
}

function capacitySignalsFromEvidence(evidence) {
  const specificSignals = [];
  const generalSignals = [];
  const seen = new Set();

  for (const item of evidence) {
    const text = cleanReviewText(item.review.text);
    const normalized = normalize(text);
    const add = (key, phrase) => {
      if (!seen.has(key)) {
        seen.add(key);
        specificSignals.push(phrase);
      }
    };
    const addGeneral = (key, phrase) => {
      if (!seen.has(key)) {
        seen.add(key);
        generalSignals.push(phrase);
      }
    };

    if (/(dos|2)\s+personas/.test(normalized) || normalized.includes('pareja')) {
      add('pareja', 'especialmente cómodo para 2 personas o una pareja');
    }
    if (normalized.includes('familia') || normalized.includes('grupo')) {
      add('familia-grupo', 'con menciones compatibles con familias o grupos');
    }
    if (normalized.includes('equipado') || normalized.includes('preparado') || normalized.includes('todo lo necesario')) {
      addGeneral('equipado', 'bien equipado');
    }
    if (normalized.includes('comodo') || normalized.includes('comodidad') || normalized.includes('acogedor')) {
      addGeneral('comodidad', 'cómodo o acogedor');
    }
    if (normalized.includes('estadia') || normalized.includes('estancia') || normalized.includes('largo plazo') || normalized.includes('mediana')) {
      addGeneral('estadia', 'apto para una buena estadía');
    }
  }

  return { specificSignals, generalSignals };
}

function capacityAnswerFromFacts(facts, evidence = []) {
  const wanted = ['Capacidad', 'Habitaciones', 'Camas', 'Baños'];
  const parts = wanted
    .map((label) => facts.find((fact) => fact.label === label))
    .filter(Boolean)
    .map((fact) => `${fact.label.toLowerCase()}: ${fact.value}`);

  if (parts.length === 0) {
    return 'La ficha del anuncio no muestra datos suficientes de capacidad, habitaciones, camas o baños para responder con precisión.';
  }

  const { specificSignals, generalSignals } = capacitySignalsFromEvidence(evidence);
  const reviewSentence = specificSignals.length > 0
    ? ` Las reseñas complementan esa ficha con señales de uso: ${specificSignals.slice(0, 3).join(', ')}.`
    : generalSignals.length > 0
      ? ` Las reseñas refuerzan que el espacio es ${generalSignals.slice(0, 2).join(' y ')}, pero no precisan un número ideal de huéspedes.`
      : ' Las reseñas recuperadas no agregan evidencia clara sobre un perfil específico de huésped.';

  return `Según la ficha del anuncio, el alojamiento tiene ${parts.join(', ')}.${reviewSentence}`;
}

function improvementSignalsFromEvidence(evidence) {
  const negativeTokens = [
    'problema',
    'problemas',
    'malo',
    'mala',
    'sucio',
    'sucia',
    'ruido',
    'ruidoso',
    'incomodo',
    'incómodo',
    'lejos',
    'demora',
    'difícil',
    'dificil',
    'falta',
    'fallo',
    'queja',
    'quejas',
    'privacidad',
    'mantenimiento',
  ];

  return evidence.filter((item) => {
    const normalized = normalize(item.review.text);
    return negativeTokens.some((token) => normalized.includes(normalize(token)));
  });
}

function improvementAnswerFromEvidence(facts, evidence) {
  const host = facts.find((fact) => fact.label === 'Host')?.value;
  const criticalEvidence = improvementSignalsFromEvidence(evidence);

  if (criticalEvidence.length === 0) {
    return `Con la evidencia disponible no se identifican mejoras específicas para ${host ? `el host ${host}` : 'el host'}. Las reseñas recuperadas no muestran críticas claras o problemas frecuentes sobre la experiencia del alojamiento.`;
  }

  const excerpts = criticalEvidence
    .slice(0, 2)
    .map((item) => item.review.excerpt ?? cleanReviewText(item.review.text));
  return `Las mejoras deben revisarse a partir de las críticas encontradas en las reseñas recuperadas: ${excerpts.join(' ')}`;
}

function topicEvidence(category, evidence) {
  const keywords = TOPIC_KEYWORDS[category] ?? [];
  return evidence.filter((item) => {
    const normalizedText = normalize(item.review.text);
    return keywords.some((keyword) => normalizedIncludesTerm(normalizedText, keyword));
  });
}

function firstEvidenceSnippet(evidence) {
  return evidence[0]?.review.excerpt ?? (evidence[0] ? contextualSnippet(evidence[0].review.text, '', 180) : '');
}

const REVIEW_SIGNAL_PATTERNS = {
  amenidades: [
    { phrase: 'piscina disponible o mencionada', keywords: ['piscina'] },
    { phrase: 'wifi o internet para trabajar', keywords: ['wifi', 'internet'] },
    { phrase: 'coworking o espacio de trabajo', keywords: ['cowork', 'coworking', 'trabajo', 'ordenador', 'computador'] },
    { phrase: 'gimnasio disponible o mencionado', keywords: ['gimnasio', 'gym'] },
    { phrase: 'jacuzzi disponible o mencionado', keywords: ['jacuzzi'] },
    { phrase: 'aire acondicionado mencionado', keywords: ['aire acondicionado'] },
    { phrase: 'cocina o lavandería equipada', keywords: ['cocina', 'lavadora', 'lavanderia', 'lavandería'] },
    { phrase: 'estacionamiento o acceso vehicular', keywords: ['estacionamiento', 'parking', 'cochera'] },
  ],
  limpieza: [
    { phrase: 'limpieza del departamento', keywords: ['limpieza', 'limpio', 'limpia', 'impecable'] },
    { phrase: 'orden y cuidado del espacio', keywords: ['ordenado', 'ordenada', 'aseado', 'higiene'] },
    { phrase: 'sensación agradable al llegar', keywords: ['aroma', 'agradable', 'muy agradable'] },
  ],
  ubicacion: [
    { phrase: 'ubicación céntrica o conveniente', keywords: ['centrico', 'céntrico', 'ubicacion', 'ubicación', 'perfecta'] },
    { phrase: 'cercanía a restaurantes y servicios', keywords: ['restaurante', 'restaurantes', 'tienda', 'tiendas', 'farmacia', 'cafe', 'cafeteria', 'cafetería'] },
    { phrase: 'Barranco como entorno atractivo', keywords: ['barranco', 'malecon', 'malecón'] },
    { phrase: 'acceso práctico a lo necesario', keywords: ['cerca', 'acceso', 'rodeado', 'necesitabamos', 'necesitábamos'] },
  ],
  anfitrion: [
    { phrase: 'amabilidad del anfitrión o del equipo', keywords: ['amable', 'amables', 'cordial', 'atento', 'atenta'] },
    { phrase: 'buena comunicación y respuestas', keywords: ['respuesta', 'respondia', 'respondía', 'comunicacion', 'comunicación'] },
    { phrase: 'apoyo durante check-in o estadía', keywords: ['check in', 'check-in', 'facilito', 'facilitó', 'apoyo', 'ayuda'] },
  ],
  precio: [
    { phrase: 'buena relación entre lo ofrecido y la experiencia', keywords: ['precio', 'valor', 'calidad', 'recomendado', 'recomiendo', 'cumple'] },
    { phrase: 'comodidad y equipamiento que respaldan el valor', keywords: ['comodo', 'cómodo', 'equipado', 'necesario', 'moderno'] },
  ],
  positivo: [
    { phrase: 'recomendación positiva de los huéspedes', keywords: ['recomendado', 'recomiendo', 'volveria', 'volvería', 'excelente'] },
    { phrase: 'comodidad y ambiente acogedor', keywords: ['comodo', 'cómodo', 'acogedor', 'bonito', 'agradable'] },
    { phrase: 'limpieza y buen estado del espacio', keywords: ['limpio', 'limpia', 'impecable', 'nuevo'] },
    { phrase: 'ubicación favorable', keywords: ['ubicacion', 'ubicación', 'centrico', 'céntrico', 'barranco', 'cerca'] },
  ],
};

function reviewHasAnyKeyword(review, keywords) {
  const normalizedText = normalize(review.text);
  return keywords.some((keyword) => normalizedIncludesTerm(normalizedText, keyword));
}

function signalSummaryForCategory(category, evidence) {
  const patterns = REVIEW_SIGNAL_PATTERNS[category] ?? [];
  const signals = patterns
    .map((pattern) => ({
      phrase: pattern.phrase,
      count: evidence.filter((item) => reviewHasAnyKeyword(item.review, pattern.keywords)).length,
    }))
    .filter((signal) => signal.count > 0)
    .sort((a, b) => b.count - a.count);

  return signals;
}

function signalPhrasesForCategory(category, evidence) {
  return signalSummaryForCategory(category, evidence).slice(0, 4).map((signal) => signal.phrase);
}

function hasSignalPhrase(signalPhrases, text) {
  const normalizedText = normalize(text);
  return signalPhrases.some((phrase) => normalize(phrase).includes(normalizedText));
}

function joinNatural(items) {
  const values = items.filter(Boolean);
  if (values.length <= 1) {
    return values[0] ?? '';
  }
  if (values.length === 2) {
    return `${values[0]} y ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')} y ${values.at(-1)}`;
}

function directlyRelevantReviews(category, evidence) {
  const topicMatches = topicEvidence(category, evidence);
  const signalPatterns = REVIEW_SIGNAL_PATTERNS[category] ?? [];
  const signalMatches = evidence.filter((item) =>
    signalPatterns.some((pattern) => reviewHasAnyKeyword(item.review, pattern.keywords)),
  );
  const byIndex = new Map();
  [...topicMatches, ...signalMatches].forEach((item) => byIndex.set(item.review.index, item));
  return [...byIndex.values()];
}

function buildPatternSentence({ label, category, evidence, fallbackFact }) {
  const relevant = directlyRelevantReviews(category, evidence);
  if (relevant.length === 0) {
    return fallbackFact
      ? `${label}, la ficha aporta ${fallbackFact}, pero las reseñas recuperadas no agregan evidencia específica.`
      : `${label}, no hay evidencia suficiente en las reseñas recuperadas para afirmarlo con seguridad.`;
  }

  const signals = signalSummaryForCategory(category, relevant);
  if (signals.length > 0) {
    const signalPhrases = signals.slice(0, 4).map((signal) => signal.phrase);
    const limitNote = relevant.length === 1 ? ' La evidencia textual es limitada a una reseña.' : '';
    if (category === 'limpieza') {
      const details = [];
      if (hasSignalPhrase(signalPhrases, 'limpieza')) {
        details.push('lo describen como muy limpio');
      }
      if (hasSignalPhrase(signalPhrases, 'orden')) {
        details.push('también resaltan el orden y cuidado del espacio');
      }
      if (hasSignalPhrase(signalPhrases, 'agradable')) {
        details.push('mencionan una sensación agradable al llegar');
      }
      return `Los huéspedes hablan muy bien de la limpieza: ${joinNatural(details.length ? details : ['las reseñas usadas apuntan a un espacio limpio y bien cuidado'])}.${limitNote}`;
    }
    if (category === 'ubicacion') {
      const details = [];
      if (hasSignalPhrase(signalPhrases, 'ubicación')) {
        details.push('una ubicación céntrica o conveniente');
      }
      if (hasSignalPhrase(signalPhrases, 'restaurantes')) {
        details.push('cercanía a restaurantes, cafeterías o servicios');
      }
      if (hasSignalPhrase(signalPhrases, 'Barranco')) {
        details.push('Barranco como un entorno atractivo');
      }
      if (hasSignalPhrase(signalPhrases, 'acceso')) {
        details.push('acceso práctico a lo necesario');
      }
      return `La ubicación aparece como una fortaleza clara: las reseñas destacan ${joinNatural(details.length ? details : signalPhrases)}.${limitNote}`;
    }
    if (category === 'anfitrion') {
      const details = [];
      if (hasSignalPhrase(signalPhrases, 'comunicación')) {
        details.push('respuestas rápidas con buena comunicación');
      }
      if (hasSignalPhrase(signalPhrases, 'amabilidad')) {
        details.push('trato amable del anfitrión o del equipo');
      }
      if (hasSignalPhrase(signalPhrases, 'check')) {
        details.push('apoyo durante el check-in o la estadía');
      }
      return `Las reseñas valoran muy bien la atención: ${joinNatural(details.length ? details : signalPhrases)}.${limitNote}`;
    }
    if (category === 'positivo') {
      return `Los aspectos positivos más repetidos son ${joinNatural(signalPhrases)}.${limitNote}`;
    }

    const prefix = relevant.length > 1 ? `${label}, varias reseñas destacan` : `${label}, la reseña recuperada destaca`;
    return `${prefix} ${joinNatural(signalPhrases)}.${limitNote}`;
  }

  const snippets = relevant.slice(0, 2).map((item) => `"${item.review.excerpt ?? contextualSnippet(item.review.text, '', 170)}"`);
  const prefix = relevant.length > 1 ? `${label}, las reseñas recuperadas apuntan a` : `${label}, una reseña recuperada apunta a`;
  return `${prefix}: ${snippets.join(' ')}`;
}

function categoriesForPatternContext(intent) {
  const categories = new Set(intent.categories.filter((category) => REVIEW_SIGNAL_PATTERNS[category]));
  if (intent.asksCommercialDecision || intent.categories.includes('general') || intent.categories.includes('experiencia')) {
    ['ubicacion', 'limpieza', 'anfitrion', 'precio', 'positivo'].forEach((category) => categories.add(category));
  }
  return [...categories];
}

function buildReviewPatternContext(intent, evidence) {
  const lines = [];
  for (const category of categoriesForPatternContext(intent)) {
    const relevant = directlyRelevantReviews(category, evidence);
    if (relevant.length === 0) {
      continue;
    }

    const signals = signalSummaryForCategory(category, relevant);
    const signalText = signals.length > 0
      ? signals.slice(0, 4).map((signal) => `${signal.phrase} (${signal.count} reseña${signal.count === 1 ? '' : 's'})`).join('; ')
      : 'sin patrón repetido claro';
    const sampleIds = relevant.slice(0, 5).map((item) => `Review ${item.review.index}`).join(', ');
    lines.push(`- ${category}: ${relevant.length} reseña${relevant.length === 1 ? '' : 's'} relevantes; patrones: ${signalText}; evidencias: ${sampleIds}.`);
  }

  return lines.join('\n');
}

function complaintsAnswerFromEvidence(evidence) {
  const criticalEvidence = improvementSignalsFromEvidence(evidence);
  if (criticalEvidence.length === 0) {
    return 'No hay evidencia suficiente de quejas frecuentes en las reseñas recuperadas. La evidencia disponible no muestra críticas claras o problemas repetidos.';
  }

  const snippets = criticalEvidence.slice(0, 2).map((item) => firstEvidenceSnippet([item]));
  const frequency = criticalEvidence.length === 1 ? 'Aparece una crítica aislada' : 'Aparecen algunas críticas';
  return `${frequency} en las reseñas recuperadas: ${snippets.join(' ')} No conviene presentarlo como frecuente sin más evidencia repetida.`;
}

function amenityTermsFromIntent(intent) {
  if (intent.amenityTerms?.length) {
    return unique(intent.amenityTerms);
  }

  const terms = new Set();
  for (const category of intent.categories) {
    if (category === 'amenidades' || category === 'remoto') {
      (TOPIC_KEYWORDS[category] ?? []).forEach((keyword) => terms.add(keyword));
    }
  }
  return [...terms];
}

function serviceEvidenceName(serviceName) {
  const normalizedName = normalize(serviceName);
  if (normalizedName.includes('wifi') || normalizedName.includes('internet')) {
    return 'del wifi';
  }
  if (normalizedName.includes('piscina')) {
    return 'de la piscina';
  }
  if (normalizedName.includes('cocina')) {
    return 'de la cocina';
  }
  if (normalizedName.includes('lavadora') || normalizedName.includes('secadora')) {
    return 'de la lavandería';
  }
  return `de ${serviceName}`;
}

function amenityReviewInsight(serviceName, relevantReviews, terms) {
  if (relevantReviews.length === 0) {
    return `No encontré reseñas recuperadas que evalúen específicamente la calidad o experiencia ${serviceEvidenceName(serviceName)}.`;
  }

  const normalizedTerms = terms.map((term) => normalize(term));
  const reviewTexts = relevantReviews.map((item) => normalize(item.review.text)).join(' ');
  if (normalizedTerms.some((term) => term.includes('piscina') || term.includes('pool'))) {
    if (reviewTexts.includes('disfrutar')) {
      return 'Además, una reseña menciona que les hubiera gustado tener más tiempo para disfrutar la piscina y otros servicios.';
    }
    return 'Además, las reseñas usadas mencionan la piscina como parte de la experiencia del alojamiento.';
  }
  if (normalizedTerms.some((term) => term.includes('cowork') || term.includes('gimnasio') || term.includes('gym'))) {
    return 'Además, las reseñas usadas mencionan servicios del edificio o espacios relacionados con esa experiencia.';
  }
  if (normalizedTerms.some((term) => term.includes('wifi') || term.includes('internet'))) {
    return 'Además, las reseñas usadas mencionan conectividad o condiciones para trabajar, aunque conviene revisar si hablan de calidad o estabilidad.';
  }

  return `Además, ${relevantReviews.length > 1 ? 'varias reseñas usadas mencionan' : 'una reseña usada menciona'} ese servicio dentro de la experiencia del huésped.`;
}

function amenityAnswerFromEvidence(facts, evidence, intent) {
  const terms = amenityTermsFromIntent(intent);
  const relevantFacts = facts.filter((fact) =>
    fact.label !== 'Amenidades' &&
    terms.some((term) => normalizedIncludesTerm(normalize(fact.value), term)),
  );
  const relevantReviews = dedupeNearDuplicateEvidence(evidence.filter((item) =>
    terms.some((term) => normalizedIncludesTerm(normalize(item.review.text), term)),
  ));
  const amenityNames = unique(
    terms.filter((term) =>
      relevantFacts.some((fact) => normalizedIncludesTerm(normalize(fact.value), term)) ||
      relevantReviews.some((item) => normalizedIncludesTerm(normalize(item.review.text), term)),
    ),
  ).slice(0, 4);

  if (relevantFacts.length === 0 && relevantReviews.length === 0) {
    return 'No hay evidencia suficiente en la ficha o reseñas recuperadas para afirmarlo con seguridad.';
  }

  const serviceName = amenityNames.length > 0 ? amenityNames.join(' o ') : 'ese servicio';
  const directAnswer = relevantFacts.length > 0 || relevantReviews.length > 0
    ? 'Sí.'
    : 'No hay evidencia suficiente en la ficha o reseñas recuperadas para afirmarlo con seguridad.';
  const factSentence = relevantFacts.length > 0
    ? `La ficha del anuncio menciona ${serviceName} en ${unique(relevantFacts.map((fact) => fact.label.toLowerCase())).join(', ')}.`
    : 'La ficha recuperada no lo menciona explícitamente.';
  const reviewSentence = ` ${amenityReviewInsight(serviceName, relevantReviews, terms)}`;

  return `${directAnswer} ${factSentence}${reviewSentence}`;
}

function focusedExperienceAnswer(intent, facts, evidence) {
  const parts = [];

  if (intent.categories.includes('limpieza')) {
    parts.push(buildPatternSentence({ label: 'Sobre limpieza', category: 'limpieza', evidence }));
  }

  if (intent.categories.includes('ubicacion')) {
    const district = facts.find((fact) => fact.label === 'Distrito')?.value;
    parts.push(buildPatternSentence({
      label: 'Sobre ubicación',
      category: 'ubicacion',
      evidence,
      fallbackFact: district ? `distrito ${district}` : '',
    }));
  }

  if (intent.categories.includes('anfitrion')) {
    const host = facts.find((fact) => fact.label === 'Host')?.value;
    const superhost = facts.find((fact) => fact.label === 'Superhost')?.value;
    const hostFacts = [host ? `la ficha identifica al host como ${host}` : '', superhost ? `Superhost: ${superhost}` : '']
      .filter(Boolean)
      .join(' y ');
    const sentence = buildPatternSentence({
      label: 'Sobre el anfitrión',
      category: 'anfitrion',
      evidence,
      fallbackFact: hostFacts,
    });
    parts.push(hostFacts && !sentence.includes('ficha aporta') ? `${sentence} Además, ${hostFacts}.` : sentence);
  }

  if (intent.categories.includes('positivo')) {
    parts.push(buildPatternSentence({ label: 'Sobre aspectos positivos', category: 'positivo', evidence }));
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function deterministicAnswerForIntent(intent, facts, evidence) {
  if (intent.asksAboutAmenities && !intent.asksAboutCapacity) {
    return amenityAnswerFromEvidence(facts, evidence, intent);
  }

  if (intent.asksAboutCapacity && !intent.asksAboutImprovements) {
    return capacityAnswerFromFacts(facts, evidence);
  }

  if (intent.asksAboutImprovements) {
    return improvementAnswerFromEvidence(facts, evidence);
  }

  if (intent.asksAboutComplaints) {
    return complaintsAnswerFromEvidence(evidence);
  }

  const focusCategories = ['limpieza', 'ubicacion', 'anfitrion', 'positivo'];
  if (intent.categories.some((category) => focusCategories.includes(category))) {
    return focusedExperienceAnswer(intent, facts, evidence);
  }

  return null;
}

function hasIntentText(text, intent) {
  const normalizedText = normalize(text);
  return reviewKeywordsForIntent(intent).some((keyword) => normalizedIncludesTerm(normalizedText, keyword));
}

function shortFactText(text, max = 260) {
  const clean = cleanReviewText(text);
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max).trim()}...`;
}

function amenityFactText(descriptionSource, intent) {
  const terms = amenityTermsFromIntent(intent);
  const presentTerms = unique(terms.filter((term) => normalizedIncludesTerm(normalize(descriptionSource), term)));
  if (presentTerms.length > 0) {
    return `Incluye ${presentTerms.slice(0, 4).join(', ')}.`;
  }

  const snippet = snippetAroundTerms(descriptionSource, terms, 170);
  return snippet || shortFactText(descriptionSource, 170);
}

function locationFactText(listing, descriptionSource) {
  const parts = [];
  if (listing.district) {
    parts.push(`Alojamiento ubicado en ${listing.district}.`);
  }

  const locationSnippet = snippetAroundTerms(
    descriptionSource,
    ['ubicacion', 'ubicación', 'cerca', 'zona', 'restaurante', 'restaurantes', 'cafeteria', 'cafetería', 'malecon', 'malecón', 'miraflores'],
    150,
  );
  const normalizedSnippet = normalize(locationSnippet);
  const hasLocationDetail = ['cerca', 'zona', 'restaurante', 'cafeteria', 'malecon', 'miraflores']
    .some((term) => normalizedIncludesTerm(normalizedSnippet, term));
  if (locationSnippet && hasLocationDetail) {
    parts.push(locationSnippet);
  }

  return unique(parts).join(' ');
}

function selectFactsForIntent(listing, allFacts, intent) {
  const labels = new Set();
  const addLabels = (values) => values.forEach((value) => labels.add(value));

  for (const category of intent.categories) {
    if (category === 'amenidades') {
      addLabels(['Reconocimiento']);
    }
    if (category === 'capacidad') {
      addLabels(['Capacidad', 'Habitaciones', 'Camas', 'Baños']);
    }
    if (category === 'precio') {
      addLabels(['Precio', 'Rating', 'Amenidades', 'Distrito']);
    }
    if (category === 'ubicacion') {
      addLabels(['Distrito']);
    }
    if (category === 'anfitrion') {
      addLabels(['Host', 'Superhost', 'Tiempo como host']);
    }
    if (category === 'remoto') {
      addLabels(['Reconocimiento']);
    }
    if (category === 'fotos') {
      addLabels(['Rating']);
    }
    if (category === 'mejoras') {
      addLabels(['Host']);
    }
    if (category === 'comercial' || category === 'general') {
      addLabels(['Capacidad', 'Habitaciones', 'Camas', 'Baños', 'Precio', 'Rating', 'Distrito', 'Amenidades', 'Host', 'Superhost']);
    }
  }

  const selected = allFacts.filter((fact) => {
    if (!labels.has(fact.label)) {
      return false;
    }
    if (intent.asksAboutAmenities) {
      const terms = amenityTermsFromIntent(intent);
      return terms.some((term) => normalizedIncludesTerm(normalize(fact.value), term));
    }
    return true;
  });
  const descriptionSource = [listing.description, listing.summary].filter(Boolean).join(' ');
  const shouldIncludeDescription =
    descriptionSource &&
    (intent.asksCommercialDecision ||
      intent.asksAboutAmenities ||
      intent.categories.includes('ubicacion') ||
      intent.categories.includes('precio') ||
      intent.categories.includes('remoto') ||
      hasIntentText(descriptionSource, intent));

  if (shouldIncludeDescription) {
    const descriptionValue = intent.asksAboutAmenities
      ? amenityFactText(descriptionSource, intent)
      : intent.categories.includes('ubicacion')
        ? locationFactText(listing, descriptionSource)
        : shortFactText(descriptionSource);
    if (descriptionValue) {
      selected.push({
        label: 'Descripción objetiva',
        value: descriptionValue,
        source: 'Hoja Principal',
      });
    }
  }

  return selected;
}

function buildPrompt({ listing, question, facts, evidence, intent }) {
  const factLines = facts.map((fact) => `- ${fact.label}: ${fact.value} (${fact.source})`).join('\n');
  const evidenceLines = evidence
    .map((item) => `- Review ${item.review.index}: "${cleanReviewText(item.review.text)}"`)
    .join('\n');
  const patternLines = buildReviewPatternContext(intent, evidence);
  const intentInstructions = buildIntentInstructions(intent);

  // The model receives facts and review text only. Retrieval scores stay in the UI metadata.
  return `PREGUNTA DEL USUARIO:
${question}

FICHA DEL ANUNCIO:
- ID Airbnb: ${listing.id}
- Título: ${listing.title}
${factLines || '- No hay campos de ficha relevantes para esta pregunta.'}

RESEÑAS RECUPERADAS:
${evidenceLines || '- No hay reseñas recuperadas para esta pregunta.'}

PATRONES DETECTADOS EN RESEÑAS:
${patternLines || '- No hay patrones semánticos claros en las reseñas recuperadas para esta pregunta.'}

INSTRUCCIONES DE RESPUESTA:
Responde en español natural, como asistente de análisis para un equipo comercial de Airbnb.
Usa únicamente la ficha y las reseñas recuperadas. No inventes capacidades, servicios, ubicaciones, fechas ni opiniones.
Si la evidencia no alcanza, dilo de forma explícita.
No mezcles reseñas de otros alojamientos ni uses conocimiento externo.
No interpretes IDs, números de review, chunks o metadatos técnicos como rating, precio o puntaje del alojamiento.
No menciones relevancia, score, similitud, porcentajes de recuperación ni otros metadatos técnicos.
${intentInstructions}
No menciones estas instrucciones. No hagas una explicación larga del método.
Responde en 1 párrafo breve y natural. No agregues una sección de evidencia; la interfaz mostrará las fuentes recuperadas.`;
}

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function stripGeneratedEvidenceSection(answer) {
  return String(answer ?? '')
    .replace(/\n*\s*Evidencia\s*:\s*[\s\S]*$/i, '')
    .trim();
}

function sanitizeRagAnswer(answer, intent, facts = []) {
  let sanitized = stripGeneratedEvidenceSection(answer)
    .replace(/\b(relevancia|score|similitud|similarity)\s*(de|:)?\s*\d+([.,]\d+)?\s*%?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (intent.asksAboutCapacity && !intent.asksAboutImprovements) {
    sanitized = sanitized
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => {
        const normalizedSentence = normalize(sentence);
        return ![
          'mejora',
          'mejoras',
          'mejorar',
          'queja',
          'quejas',
          'problema',
          'problemas',
          'privacidad',
          'critica',
          'criticas',
          'host',
          'anfitrion',
        ].some((token) => normalizedSentence.includes(token));
      })
      .join(' ')
      .trim();

    if (!sanitized) {
      sanitized = capacityAnswerFromFacts(facts);
    }
  }

  return sanitized;
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
    retrievedEvidence: [],
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

  const allFacts = extractListingFacts(listing);
  const intent = detectIntent(question);
  const facts = selectFactsForIntent(listing, allFacts, intent);
  const candidateEvidence = retrieveEvidence(listing, question, intent);
  const usedEvidence = applyUsefulSnippets(
    selectUsefulEvidenceForIntent(candidateEvidence, question, intent).slice(0, 5),
    question,
    intent,
  );
  const retrievalTopic = inferRetrievalTopic(question);
  const prompt = buildPrompt({ listing, question, facts, evidence: usedEvidence, intent });
  logEvent('CHATBOT pregunta', `listing ${listingId}; "${question.slice(0, 140)}"`);

  try {
    const answer = await callOllama(prompt);
    const groundedAnswer =
      deterministicAnswerForIntent(intent, facts, usedEvidence) ??
      sanitizeRagAnswer(answer, intent, facts);
    logEvent(
      'CHATBOT respuesta',
      `modo ollama-rag; modelo ${OLLAMA_MODEL}; facts ${facts.length}; reseñas usadas ${usedEvidence.length}; candidatas ${candidateEvidence.length}; criterio ${retrievalTopic}`,
    );
    const usedReviewIds = new Set(usedEvidence.map((item) => item.review.index));
    const unusedCandidateEvidence = usedEvidence.length > 0
      ? candidateEvidence.filter((item) => !usedReviewIds.has(item.review.index)).slice(0, 5)
      : [];
    sendJson(response, 200, {
      answer: groundedAnswer,
      facts: facts.slice(0, 4),
      evidence: usedEvidence,
      retrievedEvidence: unusedCandidateEvidence,
      evidenceScope: 'citadas',
      citedEvidenceCount: usedEvidence.length,
      retrievedEvidenceCount: candidateEvidence.length,
      mode: 'ollama-rag',
      model: OLLAMA_MODEL,
      retrievalTopic,
      note: `RAG local: ${countLabel(usedEvidence.length, 'reseña usada', 'reseñas usadas')} de ${candidateEvidence.length} candidatas recuperadas desde Reviews y ficha de Principal.`,
    });
    return;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'error desconocido';
    logEvent('CHATBOT fallback', `listing ${listingId}; razon: ${friendlyOllamaMessage(reason)}`);
    sendJson(response, 200, {
      ...buildExtractiveFallback({ listing, question, facts, evidence: usedEvidence, reason }),
      retrievalTopic,
    });
  }
}

async function handleDownloadListingImages(request, response) {
  const body = await readJsonBody(request);
  const listingId = String(body.listingId ?? '');
  const maxImages = Math.max(
    1,
    Math.min(Number(body.maxImages ?? MAX_IMAGES_PER_LISTING), MAX_IMAGES_PER_LISTING),
  );
  const dataset = await loadDataset();
  const listing = dataset.listings.find((item) => item.id === listingId);

  if (!listing) {
    sendJson(response, 404, { error: `No existe el listing ${listingId}` });
    return;
  }

  if (!listing.canonicalUrl) {
    sendJson(response, 400, { error: 'El anuncio no tiene URL canonica.' });
    return;
  }

  const listingDir = resolve(IMAGE_OUTPUT_ROOT, listingId);
  await mkdir(listingDir, { recursive: true });

  const html = await fetchText(listing.canonicalUrl);
  const sourceUrls = extractListingImageUrls(html, listingId, listing.canonicalUrl).slice(
    0,
    maxImages,
  );

  if (sourceUrls.length === 0) {
    sendJson(response, 200, {
      ok: false,
      listingId,
      imageCount: 0,
      images: [],
      sourceUrls: [],
      message: 'No se encontraron fotos publicas en el HTML canonico del anuncio.',
    });
    return;
  }

  const images = [];
  for (const [index, imageUrl] of sourceUrls.entries()) {
    const outPath = await downloadImage(imageUrl, resolve(listingDir, `photo-${index + 1}`));
    images.push(outPath.replace(resolve('public'), '').replace(/^[/\\]/, '').replace(/\\/g, '/'));
  }

  const manifest = await loadImageManifest();
  manifest.meta = {
    generatedAt: new Date().toISOString(),
    source: 'Airbnb canonical public HTML + a0.muscache.com image URLs',
    method:
      'Fetch canonical page, extract public listing image URLs from HTML, save locally under public/img/<ID Airbnb>/.',
    maxImagesPerListing: MAX_IMAGES_PER_LISTING,
  };
  manifest.listings = manifest.listings ?? {};
  manifest.listings[listingId] = {
    title: listing.title,
    canonicalUrl: listing.canonicalUrl,
    status: 'ok',
    imageCount: images.length,
    images,
    sourceUrls,
  };

  await writeFile(IMAGE_MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  logEvent('CNN fotos', `listing ${listingId}; descargadas ${images.length}`);

  sendJson(response, 200, {
    ok: true,
    listingId,
    imageCount: images.length,
    images,
    sourceUrls,
    manifestEntry: manifest.listings[listingId],
  });
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

    if (request.method === 'POST' && request.url === '/api/download-listing-images') {
      await handleDownloadListingImages(request, response);
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

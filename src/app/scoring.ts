import {
  ChatFact,
  ChatResult,
  CohortStats,
  FusionResult,
  FusionWeights,
  Listing,
  ModelScore,
  Review,
  ScoreFactor,
} from './models';

const POSITIVE_WORDS = new Set([
  'agradable',
  'amable',
  'atento',
  'bonito',
  'buena',
  'bueno',
  'cerca',
  'comodo',
  'cómodo',
  'excelente',
  'fantastico',
  'fantástico',
  'genial',
  'impecable',
  'increible',
  'increíble',
  'limpia',
  'limpio',
  'perfecta',
  'perfecto',
  'recomendado',
  'recomiendo',
  'seguro',
  'tranquilo',
]);

const NEGATIVE_WORDS = new Set([
  'calor',
  'desafortunadamente',
  'dificil',
  'difícil',
  'incómodo',
  'incomodo',
  'mala',
  'malo',
  'odio',
  'problema',
  'problemas',
  'ruido',
  'sucia',
  'sucio',
]);

const TOPIC_KEYWORDS: Record<string, string[]> = {
  limpieza: ['limpio', 'limpia', 'impecable', 'ordenado', 'aseado'],
  ubicacion: ['ubicacion', 'ubicación', 'barranco', 'malecon', 'malecón', 'cerca', 'restaurantes'],
  anfitrion: ['anfitrion', 'anfitrión', 'host', 'amable', 'respuesta', 'atento'],
  comodidad: ['cama', 'comodo', 'cómodo', 'acogedor', 'descansar', 'tranquilo'],
  precio: ['precio', 'calidad', 'valor'],
  fotos: ['foto', 'fotos', 'igual', 'publicadas', 'moderno'],
};

export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function percent(value: number): number {
  return Math.round(clamp(value) * 1000) / 10;
}

export function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildCohortStats(listings: Listing[]): CohortStats {
  const prices = listings.map((item) => item.price).filter((value) => value > 0);
  const amenities = listings.map((item) => item.amenities).filter((value) => value > 0);
  const hostYears = listings.map((item) => item.hostYears).filter((value) => value >= 0);

  if (prices.length === 0 || amenities.length === 0 || hostYears.length === 0) {
    return {
      minPrice: 0,
      maxPrice: 1,
      minAmenities: 0,
      maxAmenities: 1,
      minHostYears: 0,
      maxHostYears: 1,
    };
  }

  return {
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    minAmenities: Math.min(...amenities),
    maxAmenities: Math.max(...amenities),
    minHostYears: Math.min(...hostYears),
    maxHostYears: Math.max(...hostYears),
  };
}

export function scoreTabular(listing: Listing, cohort: CohortStats): ModelScore {
  const normalizedPrice =
    listing.price <= 0
      ? 0.5
      : cohort.maxPrice === cohort.minPrice
      ? 0.5
      : (listing.price - cohort.minPrice) / (cohort.maxPrice - cohort.minPrice);
  const normalizedAmenities =
    cohort.maxAmenities === cohort.minAmenities
      ? 0.5
      : (listing.amenities - cohort.minAmenities) / (cohort.maxAmenities - cohort.minAmenities);
  const normalizedHostYears =
    cohort.maxHostYears === cohort.minHostYears
      ? 0.5
      : (listing.hostYears - cohort.minHostYears) / (cohort.maxHostYears - cohort.minHostYears);

  const ratingScore = clamp((listing.rating - 4.5) / 0.5);
  const priceScore = listing.price > 0 ? clamp(1 - normalizedPrice) : 0.35;
  const trustScore =
    [
      listing.superhost,
      listing.verifiedIdentity,
      listing.hostHasPhoto,
      listing.exactLocation,
      listing.availabilityOver90,
    ].filter(Boolean).length / 5;
  const bookingScore = listing.instantBookable ? 1 : 0.72;
  const cancellationScore = clamp(listing.cancellationPolicy / 3);

  /*
   * MLP tabular demo rule:
   * - The assignment asks for an MLP regression over tabular listing attributes.
   * - In this frontend-only demo we expose the same feature logic as a transparent
   *   surrogate: each numeric/categorical attribute is normalized to 0-1 and then
   *   converted to a 0-100 expected satisfaction score.
   * - In a production notebook/backend, this function is the exact replacement
   *   point for model.predict(features). The UI and fusion layer remain identical.
   */
  const score =
    100 *
    (0.27 * ratingScore +
      0.2 * priceScore +
      0.2 * normalizedAmenities +
      0.16 * trustScore +
      0.09 * normalizedHostYears +
      0.05 * bookingScore +
      0.03 * cancellationScore);

  return {
    score: roundOne(score),
    confidence: roundOne(78 + Math.min(listing.reviewCountExcel, 50) * 0.24),
    label: score >= 75 ? 'Alta' : score >= 50 ? 'Media' : 'Baja',
    factors: [
      factor('Rating actual', ratingScore, `${listing.rating.toFixed(2)} / 5`),
      factor('Precio competitivo', priceScore, `S/ ${listing.price.toFixed(0)} por noche`),
      factor('Amenidades', normalizedAmenities, `${listing.amenities.toFixed(0)} servicios`),
      factor('Confianza host', trustScore, hostTrustDetail(listing)),
      factor('Tiempo como host', normalizedHostYears, `${listing.hostYears.toFixed(1)} años`),
    ],
    notes: [
      'Los valores se normalizan contra el grupo Barranco para evitar comparar con otros distritos.',
      'La salida representa el score que alimentaría la regresión MLP en el prototipo completo.',
    ],
  };
}

export function scoreReviews(listing: Listing): ModelScore {
  const reviews = listing.reviews;
  if (reviews.length === 0) {
    return {
      score: 50,
      confidence: 25,
      label: 'Sin evidencia',
      factors: [
        factor('Cobertura reseñas', 0, 'No hay reseñas cruzadas para este ID en Reviews'),
        factor('Sentimiento', 0.5, 'Neutral por falta de evidencia textual'),
      ],
      notes: [
        'El Excel trae reseñas para algunos IDs que no aparecen en Principal.',
        'Cuando no hay reseñas cruzadas, la fusión baja la confianza del LLM.',
      ],
    };
  }

  const allText = reviews.map((review) => normalize(review.text)).join(' ');
  const words = allText.split(' ').filter(Boolean);
  const positiveHits = words.filter((word) => POSITIVE_WORDS.has(word)).length;
  const negativeHits = words.filter((word) => NEGATIVE_WORDS.has(word)).length;
  const sentimentBalance = (positiveHits - negativeHits) / Math.max(positiveHits + negativeHits, 1);
  const sentimentScore = clamp(0.5 + sentimentBalance * 0.45);
  const coverageScore = clamp(Math.log10(reviews.length + 1) / Math.log10(60));

  const topicScores = Object.entries(TOPIC_KEYWORDS).map(([topic, keywords]) => {
    const hits = keywords.filter((keyword) => allText.includes(normalize(keyword))).length;
    return { topic, value: clamp(hits / Math.min(keywords.length, 4)) };
  });
  const topicCoverage =
    topicScores.reduce((sum, item) => sum + item.value, 0) / Math.max(topicScores.length, 1);

  /*
   * LLM/reviews demo rule:
   * - The real LLM is represented as retrieval + evidence extraction over the
   *   Spanish reviews. This keeps the demo deterministic and auditable.
   * - Sentiment has the highest weight because reviews are direct guest feedback.
   * - Topic coverage rewards repeated mention of limpieza, ubicacion, anfitrion,
   *   comodidad and precio, which match common guest questions.
   */
  const score = 100 * (0.56 * sentimentScore + 0.24 * topicCoverage + 0.2 * coverageScore);

  return {
    score: roundOne(score),
    confidence: roundOne(45 + coverageScore * 50),
    label: score >= 75 ? 'Alta' : score >= 50 ? 'Media' : 'Baja',
    factors: [
      factor('Sentimiento general', sentimentScore, `${positiveHits} positivos / ${negativeHits} alertas`),
      factor('Cobertura de reseñas', coverageScore, `${reviews.length} reseñas cruzadas`),
      ...topicScores
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map((item) => factor(topicLabel(item.topic), item.value, 'tema detectado en reseñas')),
    ],
    notes: [
      'El chatbot devuelve fragmentos de reseñas como evidencia, no respuestas inventadas.',
      'Si se conecta un LLM real, debe recibir estas evidencias como contexto recuperado.',
    ],
  };
}

export function analyzeImagePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ScoreFactor[] {
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let saturationSum = 0;
  let edgeSum = 0;
  let sampled = 0;
  let balancedPixels = 0;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      lumaSum += luma;
      lumaSquaredSum += luma * luma;
      saturationSum += max === 0 ? 0 : (max - min) / max;
      balancedPixels += luma > 0.08 && luma < 0.94 ? 1 : 0;
      sampled += 1;

      if (x + 2 < width) {
        const rightIndex = (y * width + x + 2) * 4;
        const rightLuma =
          0.2126 * (data[rightIndex] / 255) +
          0.7152 * (data[rightIndex + 1] / 255) +
          0.0722 * (data[rightIndex + 2] / 255);
        edgeSum += Math.abs(luma - rightLuma);
      }
    }
  }

  const meanLuma = lumaSum / sampled;
  const variance = Math.max(lumaSquaredSum / sampled - meanLuma * meanLuma, 0);
  const contrast = Math.sqrt(variance);
  const saturation = saturationSum / sampled;
  const edgeEnergy = edgeSum / sampled;
  const usableCoverage = balancedPixels / sampled;

  /*
   * Vision/CNN demo rule:
   * The PDF asks for a CNN over apartment photos. This frontend implements the
   * visible scoring contract over real uploaded pixels: exposure, contrast,
   * sharpness/detail, color naturalness and usable coverage. Those are common
   * quality proxies for listing photos and can be replaced by a pre-trained CNN
   * classifier while preserving the same 0-100 output.
   */
  return [
    factor('Iluminacion', clamp(1 - Math.abs(meanLuma - 0.58) / 0.45), `luma media ${meanLuma.toFixed(2)}`),
    factor('Contraste', clamp(contrast / 0.24), `desv. luma ${contrast.toFixed(2)}`),
    factor('Nitidez', clamp(edgeEnergy / 0.08), `energia de bordes ${edgeEnergy.toFixed(2)}`),
    factor('Color natural', clamp(1 - Math.abs(saturation - 0.32) / 0.42), `saturacion ${saturation.toFixed(2)}`),
    factor('Cobertura util', clamp(usableCoverage), `${Math.round(usableCoverage * 100)}% sin extremos`),
  ];
}

export function scoreImageMetrics(metrics: ScoreFactor[]): number {
  const weights = [0.24, 0.22, 0.22, 0.14, 0.18];
  return roundOne(
    metrics.reduce((sum, metric, index) => sum + (metric.value / 100) * weights[index] * 100, 0),
  );
}

export function fuseScores(
  visionScore: number,
  tabularScore: number,
  reviewScore: number,
  visionConfidence: number,
  tabularConfidence: number,
  reviewConfidence: number,
  weights: FusionWeights,
): FusionResult {
  /*
   * Late fusion baseline from the slides:
   * each modality produces a 0-100 score, then the business decision is a
   * weighted average. Vision receives 40% because listing quality depends heavily
   * on photos; tabular and reviews receive 30% each to keep attributes and guest
   * evidence balanced.
   */
  const score =
    visionScore * weights.vision + tabularScore * weights.tabular + reviewScore * weights.reviews;
  const confidence =
    visionConfidence * weights.vision +
    tabularConfidence * weights.tabular +
    reviewConfidence * weights.reviews;

  return {
    score: roundOne(score),
    confidence: roundOne(confidence),
    weights,
    label: score >= 75 ? 'Recomendado' : score >= 50 ? 'Revisar' : 'No recomendado',
  };
}

export function answerQuestion(listing: Listing, question: string): ChatResult {
  const normalizedQuestion = normalize(question);
  const queryTokens = new Set(normalizedQuestion.split(' ').filter((token) => token.length > 2));
  const expandedTokens = expandQuestionTokens(queryTokens);
  const listingFacts = extractListingFacts(listing);
  const capacityQuestion = isCapacityQuestion(normalizedQuestion);

  const ranked = listing.reviews
    .map((review) => ({
      review,
      relevance: reviewRelevance(review, expandedTokens),
    }))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3);
  const evidence = ranked.map((item) => ({
    review: item.review,
    relevance: roundOne(item.relevance * 100),
  }));

  if (capacityQuestion && listingFacts.length > 0) {
    const capacity = listingFacts.find((fact) => fact.label === 'Capacidad');
    return {
      answer: capacity
        ? `Según la ficha del anuncio, este departamento es recomendable para ${capacity.value.toLowerCase()}. También puedes revisar abajo la distribución del espacio tomada del resumen del listado.`
        : `Según la ficha del anuncio, la distribución disponible es: ${listing.summary}.`,
      facts: listingFacts,
      evidence,
    };
  }

  if (ranked.length === 0) {
    return {
      answer:
        listing.reviews.length === 0
          ? 'No hay reseñas cruzadas para este ID en la hoja Reviews. La recomendación textual debe marcarse con baja confianza.'
          : 'No encontré una reseña directamente relacionada con la pregunta. Revisa la descripción del anuncio y las reseñas completas antes de decidir.',
      evidence: [],
    };
  }

  const topic = inferQuestionTopic(normalizedQuestion);
  const answer =
    topic === 'general'
      ? `Las reseñas disponibles para este listado son mayormente útiles como evidencia operativa. Los fragmentos más relevantes aparecen abajo para evitar inventar conclusiones.`
      : `Sobre ${topic}, las reseñas recuperadas apuntan a esta evidencia concreta. La respuesta se basa solo en textos de la hoja Reviews.`;

  return {
    answer,
    facts: listingFacts.slice(0, 2),
    evidence,
  };
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function snippet(text: string, max = 170): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max).trim()}...`;
}

function factor(label: string, value: number, detail: string): ScoreFactor {
  return {
    label,
    value: roundOne(clamp(value) * 100),
    detail,
  };
}

function hostTrustDetail(listing: Listing): string {
  const active = [
    listing.superhost ? 'superhost' : '',
    listing.verifiedIdentity ? 'identidad verificada' : '',
    listing.hostHasPhoto ? 'foto de perfil' : '',
    listing.exactLocation ? 'ubicacion exacta' : '',
    listing.availabilityOver90 ? 'disponibilidad >90d' : '',
  ].filter(Boolean);
  return active.length ? active.join(', ') : 'sin senales suficientes';
}

function topicLabel(topic: string): string {
  const labels: Record<string, string> = {
    anfitrion: 'Anfitrion',
    limpieza: 'Limpieza',
    ubicacion: 'Ubicacion',
    comodidad: 'Comodidad',
    precio: 'Precio',
    fotos: 'Fotos',
  };
  return labels[topic] ?? topic;
}

function expandQuestionTokens(tokens: Set<string>): Set<string> {
  const expanded = new Set(tokens);
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (tokens.has(topic)) {
      keywords.forEach((keyword) => expanded.add(normalize(keyword)));
    }
  }
  return expanded;
}

function inferQuestionTopic(question: string): string {
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => question.includes(normalize(keyword)))) {
      return topicLabel(topic).toLowerCase();
    }
  }
  return 'general';
}

function reviewRelevance(review: Review, tokens: Set<string>): number {
  const text = normalize(review.text);
  const reviewTokens = new Set(text.split(' ').filter(Boolean));
  let matches = 0;
  tokens.forEach((token) => {
    if (reviewTokens.has(token) || text.includes(token)) {
      matches += 1;
    }
  });
  return matches / Math.max(tokens.size, 1);
}

function isCapacityQuestion(question: string): boolean {
  return [
    'persona',
    'personas',
    'huesped',
    'huespedes',
    'capacidad',
    'cuantas',
    'cuantos',
    'camas',
    'habitacion',
    'habitaciones',
    'banos',
  ].some((token) => question.includes(token));
}

function extractListingFacts(listing: Listing): ChatFact[] {
  const summary = listing.summary || '';
  const parts = summary
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean);
  const facts: ChatFact[] = [];

  for (const part of parts) {
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

  if (facts.length === 0 && summary) {
    facts.push({ label: 'Resumen', value: summary, source: 'Resumen de la propiedad' });
  }

  return facts;
}

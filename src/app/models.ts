export interface Review {
  date: string;
  index: number;
  text: string;
  excerpt?: string;
  sentimentHint: string;
}

export interface Listing {
  id: string;
  city: string;
  district: string;
  collectionDate: string;
  host: string;
  canonicalUrl: string;
  title: string;
  propertyTitle: string;
  summary: string;
  recognition: string;
  description: string;
  superhost: boolean;
  verifiedIdentity: boolean;
  hostHasPhoto: boolean;
  hostYears: number;
  exactLocation: boolean;
  bedType: number;
  rooms: number;
  accommodationType: number;
  amenities: number;
  price: number;
  rating: number;
  instantBookable: boolean;
  cancellationPolicy: number;
  guestPhoneRequired: boolean;
  availabilityOver90: boolean;
  reviewCountExcel: number;
  reviewCountMatched: number;
  reviews: Review[];
  searchText: string;
}

export interface DatasetMeta {
  sourceWorkbook: string;
  generatedFromSheets: string[];
  context: string;
  listingCount: number;
  reviewCount: number;
  matchedListingCount: number;
  unmatchedListingCount: number;
  district: string;
  imagePolicy: string;
  fusionWeights: FusionWeights;
  decisionThresholds: {
    recommended: number;
    review: number;
    notRecommendedBelow: number;
  };
  topReviewTopics: [string, number][];
}

export interface ListingDataset {
  meta: DatasetMeta;
  listings: Listing[];
}

export interface ScoreFactor {
  label: string;
  value: number;
  detail: string;
  displayValue?: string;
}

export interface ModelScore {
  score: number;
  confidence: number;
  label: string;
  factors: ScoreFactor[];
  notes: string[];
}

export interface ImageAnalysis {
  id: string;
  name: string;
  previewUrl: string;
  source: 'airbnb-canonical' | 'uploaded';
  score: number;
  metrics: ScoreFactor[];
}

export interface ListingImageManifestEntry {
  title: string;
  canonicalUrl: string;
  status: string;
  imageCount: number;
  images: string[];
  sourceUrls: string[];
}

export interface ImageManifest {
  meta: {
    generatedAt: string;
    source: string;
    method: string;
    maxImagesPerListing: number;
  };
  listings: Record<string, ListingImageManifestEntry>;
}

export interface CnnScoreEntry {
  score: number;
  label: 'Alta' | 'Media' | 'Baja';
  confidence: number;
  nImagenesPredTotal: number;
  nImagenesPredEncimaMediana: number;
  nImagenesPredDebajoMediana: number;
  propImagenesPredEncimaMediana: number;
  propImagenesPredDebajoMediana: number;
  probAltaPromedio: number;
}

export interface CnnScores {
  meta: {
    generatedAt: string;
    source: string;
    model: string;
    scoreField: string;
    scoreMeaning: string;
    scoreFormula: string;
    labelThresholds: {
      altaMin: number;
      mediaMin: number;
    };
    confidenceMetric: string;
    confidence: number;
    testF1Macro: number;
    validationF1Macro: number;
  };
  listings: Record<string, CnnScoreEntry>;
}

export interface MlpScoreEntry {
  observedRating: number | null;
  predictedRating: number;
  observedNormalized: number | null;
  predictedNormalized: number;
  score: number;
  residual: number | null;
  absoluteError: number | null;
  set: 'evaluado' | 'inferencia_sin_rating';
}

export interface MlpScores {
  meta: {
    generatedFrom: string;
    model: string;
    runId: string;
    target: string;
    scoreField: string;
    scoreMeaning: string;
    ratingField: string;
    selectedFeatures: string[];
    validationMAE: number;
    validationRMSE: number;
    validationR2: number;
    allRowsMAE: number;
    allRowsRMSE: number;
    labelThresholds: {
      altaMin: number;
      mediaMin: number;
    };
    confidence: number;
    listingCount: number;
  };
  listings: Record<string, MlpScoreEntry>;
}

export interface ReviewSentimentAspect {
  aspect: string;
  positivePct: number;
  neutralPct: number;
  negativePct: number;
  mentions: number;
}

export interface ReviewSentimentEmotion {
  emotion: string;
  pct: number;
  count: number;
}

export interface ReviewSentimentEntry {
  positivePct: number;
  neutralPct: number;
  negativePct: number;
  reviewCount: number;
  score: number;
  confidence: number;
  averageRawScore: number | null;
  topEmotion: string;
  topEmotionPct: number;
  emotions: ReviewSentimentEmotion[];
  aspects: ReviewSentimentAspect[];
}

export interface ReviewSentimentScores {
  meta: {
    generatedFrom: string;
    sourceSheets: string[];
    scoreField: string;
    scoreMeaning: string;
    confidenceMeaning: string;
    listingCount: number;
    aspectRows: number;
  };
  listings: Record<string, ReviewSentimentEntry>;
}

export interface FusionWeights {
  vision: number;
  tabular: number;
  reviews: number;
}

export interface FusionResult {
  score: number;
  label: 'Recomendado' | 'Revisar' | 'No recomendado';
  confidence: number;
  weights: FusionWeights;
}

export interface ChatEvidence {
  review: Review;
  relevance: number;
  selectionSource?: string;
}

export interface ChatFact {
  label: string;
  value: string;
  source: string;
}

export interface ChatResult {
  answer: string;
  facts?: ChatFact[];
  evidence: ChatEvidence[];
  retrievedEvidence?: ChatEvidence[];
  evidenceScope?: 'citadas' | 'recuperadas';
  citedEvidenceCount?: number;
  retrievedEvidenceCount?: number;
  mode?: 'ollama-rag' | 'extractive-local' | 'extractive-fallback';
  model?: string;
  note?: string;
  retrievalTopic?: string;
}

export interface CohortStats {
  minPrice: number;
  maxPrice: number;
  minAmenities: number;
  maxAmenities: number;
  minHostYears: number;
  maxHostYears: number;
}

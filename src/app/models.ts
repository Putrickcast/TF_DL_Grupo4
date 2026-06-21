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

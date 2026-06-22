import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ChatResult,
  CnnScores,
  ImageManifest,
  ImageAnalysis,
  Listing,
  ListingDataset,
  ModelScore,
  ScoreFactor,
} from './models';
import {
  analyzeImagePixels,
  answerQuestion,
  buildCohortStats,
  fuseScores,
  normalize,
  roundOne,
  scoreImageMetrics,
  scoreReviews,
  scoreTabular,
  snippet,
} from './scoring';

type ListingFilter = 'all' | 'withReviews' | 'withoutReviews';
type SectionId = 'datos' | 'modelos' | 'chatbot' | 'evidencia';

const RAG_CHAT_ENDPOINT = '/api/rag-chat';
const TELEMETRY_ENDPOINT = '/api/telemetry';
const DOWNLOAD_IMAGES_ENDPOINT = '/api/download-listing-images';
const OLLAMA_MODEL_NAME = 'llama3.1:8b';

interface DownloadImagesResponse {
  ok: boolean;
  listingId: string;
  imageCount: number;
  images: string[];
  sourceUrls: string[];
  message?: string;
  manifestEntry?: ImageManifest['listings'][string];
}

interface ListingPreview {
  listing: Listing;
  tabularScore: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  result?: ChatResult;
  loading?: boolean;
  error?: string;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  readonly dataset = signal<ListingDataset | null>(null);
  readonly selectedId = signal('');
  readonly searchTerm = signal('');
  readonly filter = signal<ListingFilter>('all');
  readonly question = signal('¿Qué opinan los huéspedes sobre la limpieza y la ubicación?');
  readonly chatResult = signal<ChatResult | null>(null);
  readonly chatMessages = signal<ChatMessage[]>([]);
  readonly chatLoading = signal(false);
  readonly chatError = signal('');
  readonly activeSection = signal('datos');
  readonly imageManifest = signal<ImageManifest | null>(null);
  readonly cnnScores = signal<CnnScores | null>(null);
  readonly listingImages = signal<ImageAnalysis[]>([]);
  readonly imageLoadError = signal('');
  readonly imageDownloadLoading = signal(false);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly ragModelName = OLLAMA_MODEL_NAME;

  private readonly sectionIds: SectionId[] = ['datos', 'modelos', 'chatbot', 'evidencia'];
  private imageLoadSequence = 0;
  private chatSequence = 0;
  private scrollSyncFrame = 0;

  readonly listings = computed(() => this.dataset()?.listings ?? []);
  readonly meta = computed(() => this.dataset()?.meta ?? null);
  readonly cohort = computed(() => buildCohortStats(this.listings()));

  readonly selectedListing = computed(() => {
    const listings = this.listings();
    return listings.find((listing) => listing.id === this.selectedId()) ?? listings[0] ?? null;
  });

  readonly tabularScore = computed(() => {
    const listing = this.selectedListing();
    return listing ? scoreTabular(listing, this.cohort()) : null;
  });

  readonly reviewScore = computed(() => {
    const listing = this.selectedListing();
    return listing ? scoreReviews(listing) : null;
  });

  readonly visionImages = computed(() => this.listingImages());

  readonly visionScore = computed<ModelScore | null>(() => {
    const listing = this.selectedListing();
    const cnnScore = listing ? this.cnnScores()?.listings[listing.id] : null;
    if (cnnScore) {
      return {
        score: cnnScore.score,
        confidence: cnnScore.confidence,
        label: cnnScore.label,
        factors: [
          {
            label: 'Fotos clase alta',
            value: roundOne(cnnScore.propImagenesPredEncimaMediana * 100),
            detail: `${cnnScore.nImagenesPredEncimaMediana} de ${cnnScore.nImagenesPredTotal} fotos`,
            displayValue: `${cnnScore.nImagenesPredEncimaMediana}/${cnnScore.nImagenesPredTotal}`,
          },
          {
            label: 'Fotos clase media',
            value: roundOne(cnnScore.propImagenesPredDebajoMediana * 100),
            detail: `${cnnScore.nImagenesPredDebajoMediana} de ${cnnScore.nImagenesPredTotal} fotos`,
            displayValue: `${cnnScore.nImagenesPredDebajoMediana}/${cnnScore.nImagenesPredTotal}`,
          },
          {
            label: 'Prob. alta promedio',
            value: roundOne(cnnScore.probAltaPromedio * 100),
            detail: 'promedio de probabilidad CNN',
          },
          {
            label: 'Fotos evaluadas',
            value: 100,
            detail: `${cnnScore.nImagenesPredTotal} fotos procesadas por la CNN`,
            displayValue: `${cnnScore.nImagenesPredTotal}`,
          },
        ],
        notes: [
          'Score CNN = proporcion de fotos clasificadas por encima de la mediana visual.',
          'Confianza basada en F1 macro de validacion del modelo final estable.',
        ],
      };
    }

    const images = this.visionImages();
    if (images.length === 0) {
      return {
        score: 50,
        confidence: 15,
        label: 'Sin foto',
        factors: [
          { label: 'Cobertura fotos', value: 0, detail: 'No hay imagen local para este ID' },
          { label: 'Confianza visual', value: 15, detail: 'Pendiente de captura real' },
        ],
        notes: [
          'No se encontro foto real descargada para este ID.',
          'Coloca imagenes en public/img/<ID Airbnb>/ y actualiza public/data/image-manifest.json.',
        ],
      };
    }

    const metrics = averageImageMetrics(images);
    const score = roundOne(images.reduce((sum, image) => sum + image.score, 0) / images.length);

    return {
      score,
      confidence: 55,
      label: score >= 75 ? 'Alta' : score >= 50 ? 'Media' : 'Baja',
      factors: metrics,
      notes: [
        'Score calculado sobre fotos reales descargadas desde la URL canónica del anuncio.',
        'Estas imágenes están guardadas localmente bajo public/img/<ID Airbnb>/.',
      ],
    };
  });

  readonly fusion = computed(() => {
    const meta = this.meta();
    const vision = this.visionScore();
    const tabular = this.tabularScore();
    const reviews = this.reviewScore();
    if (!meta || !vision || !tabular || !reviews) {
      return null;
    }

    return fuseScores(
      vision.score,
      tabular.score,
      reviews.score,
      vision.confidence,
      tabular.confidence,
      reviews.confidence,
      meta.fusionWeights,
    );
  });

  readonly filteredListings = computed<ListingPreview[]>(() => {
    const term = normalize(this.searchTerm());
    const filter = this.filter();
    return this.listings()
      .filter((listing) => {
        const matchesTerm =
          !term ||
          normalize(`${listing.title} ${listing.host} ${listing.id}`).includes(term) ||
          listing.searchText.includes(term);
        const matchesFilter =
          filter === 'all' ||
          (filter === 'withReviews' && listing.reviewCountMatched > 0) ||
          (filter === 'withoutReviews' && listing.reviewCountMatched === 0);
        return matchesTerm && matchesFilter;
      })
      .map((listing) => ({
        listing,
        tabularScore: scoreTabular(listing, this.cohort()).score,
      }))
      .sort((a, b) => b.tabularScore - a.tabularScore);
  });

  async ngOnInit(): Promise<void> {
    try {
      const response = await fetch('data/listings.json');
      if (!response.ok) {
        throw new Error(`No se pudo cargar listings.json (${response.status})`);
      }
      const dataset = (await response.json()) as ListingDataset;
      const imageManifestResponse = await fetch('data/image-manifest.json');
      if (!imageManifestResponse.ok) {
        throw new Error(`No se pudo cargar image-manifest.json (${imageManifestResponse.status})`);
      }
      const imageManifest = (await imageManifestResponse.json()) as ImageManifest;
      const cnnScoresResponse = await fetch('data/cnn-scores.json');
      if (!cnnScoresResponse.ok) {
        throw new Error(`No se pudo cargar cnn-scores.json (${cnnScoresResponse.status})`);
      }
      const cnnScores = (await cnnScoresResponse.json()) as CnnScores;
      this.dataset.set(dataset);
      this.imageManifest.set(imageManifest);
      this.cnnScores.set(cnnScores);
      const cohort = buildCohortStats(dataset.listings);
      const initialListing =
        [...dataset.listings].sort(
          (a, b) => scoreTabular(b, cohort).score - scoreTabular(a, cohort).score,
        )[0] ?? null;
      this.selectedId.set(initialListing?.id ?? '');
      if (initialListing) {
        await this.loadListingImages(initialListing);
        this.emitModelTelemetry('listing-inicial');
      }
      this.resetChatForListing(false);
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Error desconocido al cargar datos');
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    if (this.scrollSyncFrame) {
      cancelAnimationFrame(this.scrollSyncFrame);
    }
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.scrollSyncFrame) {
      return;
    }
    this.scrollSyncFrame = requestAnimationFrame(() => {
      this.scrollSyncFrame = 0;
      this.syncActiveSectionFromScroll();
    });
  }

  selectListing(listingId: string): void {
    this.selectedId.set(listingId);
    const listing = this.selectedListing();
    if (listing) {
      void this.loadListingImages(listing).finally(() => {
        this.emitModelTelemetry('listing-seleccionado');
      });
    }
    this.question.set('¿Qué opinan los huéspedes sobre la limpieza y la ubicación?');
    this.resetChatForListing(true);
  }

  setFilter(filter: ListingFilter): void {
    this.filter.set(filter);
  }

  async runQuestion(scrollToAnswer = true): Promise<void> {
    const listing = this.selectedListing();
    if (!listing) {
      this.chatResult.set(null);
      this.chatMessages.set([]);
      return;
    }

    const question = this.question().trim();
    if (!question) {
      return;
    }
    const sequence = ++this.chatSequence;
    const assistantMessageId = this.createChatMessageId('assistant');

    this.chatMessages.update((messages) => [
      ...messages,
      {
        id: this.createChatMessageId('user'),
        role: 'user',
        text: question,
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        text: 'Consultando Ollama con las reseñas recuperadas del listado...',
        loading: true,
      },
    ]);
    this.question.set('');
    this.chatResult.set(null);
    this.chatError.set('');
    this.chatLoading.set(true);
    this.scrollChatToBottom();

    if (scrollToAnswer) {
      this.activeSection.set('chatbot');
      window.setTimeout(() => {
        document
          .getElementById('chat-thread')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }

    try {
      const response = await fetch(RAG_CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: listing.id,
          question,
        }),
      });

      if (!response.ok) {
        throw new Error(`RAG HTTP ${response.status}`);
      }

      const ragResult = (await response.json()) as ChatResult;
      if (sequence === this.chatSequence) {
        this.chatResult.set(ragResult);
        this.replaceChatMessage(assistantMessageId, {
          text: ragResult.answer,
          result: ragResult,
          loading: false,
        });
        this.chatError.set('');
      }
    } catch (error) {
      if (sequence === this.chatSequence) {
        const fallback: ChatResult = {
          ...answerQuestion(listing, question),
          mode: 'extractive-fallback',
          model: 'fallback local',
          note: this.friendlyRagError(error),
        };
        const message = this.friendlyRagError(error);
        this.chatResult.set(fallback);
        this.replaceChatMessage(assistantMessageId, {
          text: fallback.answer,
          result: fallback,
          loading: false,
          error: message,
        });
        this.chatError.set(message);
      }
    } finally {
      if (sequence === this.chatSequence) {
        this.chatLoading.set(false);
        this.scrollChatToBottom();
      }
    }
  }

  askQuickQuestion(question: string): void {
    this.question.set(question);
    void this.runQuestion(true);
  }

  scrollToSection(sectionId: SectionId): void {
    this.activeSection.set(sectionId);
    this.scrollElementBelowTopbar(sectionId);
  }

  primaryImageFor(listing: Listing): string {
    const image = this.imageManifest()?.listings[listing.id]?.images[0];
    return image ? image : 'images/no-real-photo.svg';
  }

  selectedImageCount(): number {
    const listing = this.selectedListing();
    if (!listing) {
      return 0;
    }
    return this.imageManifest()?.listings[listing.id]?.imageCount ?? 0;
  }

  downloadDecision(): void {
    const listing = this.selectedListing();
    const fusion = this.fusion();
    const vision = this.visionScore();
    const tabular = this.tabularScore();
    const reviews = this.reviewScore();
    if (!listing || !fusion || !vision || !tabular || !reviews) {
      return;
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      listing: {
        id: listing.id,
        title: listing.title,
        host: listing.host,
        canonicalUrl: listing.canonicalUrl,
      },
      decision: fusion,
      modalityScores: { vision, tabular, reviews },
      note: 'Export académico de demo. El score visual usa fotos reales locales cuando existen para el ID seleccionado.',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `decision-${listing.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  scoreClass(score: number): string {
    if (score >= 75) {
      return 'good';
    }
    if (score >= 50) {
      return 'watch';
    }
    return 'bad';
  }

  labelClass(label: string): string {
    if (label === 'Alta' || label === 'Recomendado') {
      return 'good';
    }
    if (label === 'Media' || label === 'Revisar') {
      return 'watch';
    }
    return 'bad';
  }

  displayScore(score: number | undefined): string {
    return typeof score === 'number' ? score.toFixed(1) : '--';
  }

  shortText(text: string, max = 150): string {
    return snippet(text, max);
  }

  evidenceSummary(chat: ChatResult): string {
    return `${chat.evidence.length} reseñas recuperadas`;
  }

  reviewCountLabel(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  countLabel(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  evidenceNote(chat: ChatResult): string {
    const retrievedCount = chat.retrievedEvidenceCount ?? chat.retrievedEvidence?.length ?? chat.evidence.length;
    return chat.note ?? `RAG local: ${this.reviewCountLabel(chat.evidence.length, 'reseña usada', 'reseñas usadas')} de ${retrievedCount} candidatas recuperadas desde Reviews.`;
  }

  private resetChatForListing(contextChanged = false): void {
    const listing = this.selectedListing();
    this.chatSequence += 1;
    this.chatResult.set(null);
    this.chatLoading.set(false);
    this.chatError.set('');
    this.chatMessages.set([
      {
        id: this.createChatMessageId('assistant'),
        role: 'assistant',
        text: listing
          ? contextChanged
            ? `Contexto actualizado. Ahora estás preguntando sobre: "${listing.title}". Usaré solo la ficha de este anuncio y sus reseñas recuperadas.`
            : `Hola. Estoy listo para responder sobre "${listing.title}" usando la ficha del anuncio y sus reseñas recuperadas.`
          : 'Hola. Selecciona un listado para iniciar el análisis.',
      },
    ]);
  }

  private friendlyRagError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    const normalized = raw.toLowerCase();
    if (normalized.includes('model') && normalized.includes('not found')) {
      return `Modelo no encontrado. Ejecuta: ollama pull ${OLLAMA_MODEL_NAME}`;
    }
    if (
      normalized.includes('failed to fetch') ||
      normalized.includes('fetch failed') ||
      normalized.includes('econnrefused') ||
      normalized.includes('connect') ||
      normalized.includes('rag http')
    ) {
      return `No se pudo conectar con Ollama. Verifica que Ollama esté ejecutándose y que el modelo ${OLLAMA_MODEL_NAME} esté instalado.`;
    }
    return `No se pudo consultar Ollama/RAG: ${raw}`;
  }

  private emitModelTelemetry(event: string): void {
    const listing = this.selectedListing();
    const tabular = this.tabularScore();
    const vision = this.visionScore();
    const reviews = this.reviewScore();
    const fusion = this.fusion();
    if (!listing || !tabular || !vision || !reviews || !fusion) {
      return;
    }

    void fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        listingId: listing.id,
        title: listing.title,
        tabularScore: tabular.score,
        tabularLabel: tabular.label,
        visionScore: vision.score,
        visionLabel: vision.label,
        reviewScore: reviews.score,
        reviewLabel: reviews.label,
        fusionScore: fusion.score,
        fusionLabel: fusion.label,
      }),
    }).catch(() => {
      // La telemetria es solo para monitoreo; la demo sigue funcionando si el backend no responde.
    });
  }

  private createChatMessageId(role: ChatMessage['role']): string {
    return `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private replaceChatMessage(messageId: string, update: Partial<ChatMessage>): void {
    this.chatMessages.update((messages) =>
      messages.map((message) => (message.id === messageId ? { ...message, ...update } : message)),
    );
  }

  private scrollChatToBottom(): void {
    window.setTimeout(() => {
      const thread = document.getElementById('chat-thread');
      if (thread) {
        thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
      }
    });
  }

  private topbarOffset(): number {
    const topbar = document.querySelector<HTMLElement>('.topbar');
    return (topbar?.offsetHeight ?? 56) + 18;
  }

  private scrollElementBelowTopbar(sectionId: SectionId): void {
    const element = document.getElementById(sectionId);
    if (!element) {
      return;
    }

    const top = window.scrollY + element.getBoundingClientRect().top - this.topbarOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  private syncActiveSectionFromScroll(): void {
    const offset = this.topbarOffset() + 8;
    const sections = this.sectionIds
      .map((id) => ({ id, element: document.getElementById(id) }))
      .filter((item): item is { id: SectionId; element: HTMLElement } => Boolean(item.element));

    if (sections.length === 0) {
      return;
    }

    const current =
      [...sections]
        .reverse()
        .find(({ element }) => element.getBoundingClientRect().top <= offset)?.id ?? sections[0].id;
    if (current !== this.activeSection()) {
      this.activeSection.set(current);
    }
  }

  private analyzeImageUrl(
    url: string,
    name: string,
    source: ImageAnalysis['source'],
  ): Promise<ImageAnalysis> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const maxWidth = 260;
        const ratio = image.naturalHeight / Math.max(image.naturalWidth, 1);
        const width = maxWidth;
        const height = Math.max(1, Math.round(maxWidth * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          reject(new Error('No se pudo crear contexto canvas para analizar imagen'));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        const imageData = context.getImageData(0, 0, width, height);
        const metrics = analyzeImagePixels(imageData.data, width, height);

        resolve({
          id: `${source}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name,
          previewUrl: url,
          source,
          metrics,
          score: scoreImageMetrics(metrics),
        });
      };
      image.onerror = () => reject(new Error(`No se pudo cargar la imagen ${name}`));
      image.src = url;
    });
  }

  private async loadListingImages(listing: Listing): Promise<void> {
    const sequence = ++this.imageLoadSequence;
    this.imageLoadError.set('');

    let imagePaths = this.imageManifest()?.listings[listing.id]?.images ?? [];

    if (imagePaths.length === 0) {
      this.imageDownloadLoading.set(true);
      try {
        await this.ensureListingImages(listing);
        imagePaths = this.imageManifest()?.listings[listing.id]?.images ?? [];
      } catch (error) {
        if (sequence === this.imageLoadSequence) {
          this.listingImages.set([]);
          this.imageLoadError.set(
            error instanceof Error ? error.message : 'No se pudieron descargar las fotos reales',
          );
        }
        return;
      } finally {
        this.imageDownloadLoading.set(false);
      }

      if (imagePaths.length === 0) {
        this.listingImages.set([]);
        this.imageLoadError.set('No hay fotos reales descargadas para este listado.');
        return;
      }
    }

    try {
      const analyses = await Promise.all(
        imagePaths.map((path) =>
          this.analyzeImageUrl(path, path.split('/').pop() ?? 'foto real', 'airbnb-canonical'),
        ),
      );
      if (sequence === this.imageLoadSequence) {
        this.listingImages.set(analyses);
      }
    } catch (error) {
      if (sequence === this.imageLoadSequence) {
        this.listingImages.set([]);
        this.imageLoadError.set(
          error instanceof Error ? error.message : 'No se pudieron analizar las fotos reales',
        );
      }
    }
  }

  private async ensureListingImages(listing: Listing): Promise<void> {
    const response = await fetch(DOWNLOAD_IMAGES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: listing.id, maxImages: 8 }),
    });
    const payload = (await response.json()) as DownloadImagesResponse;

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message ?? `No se pudieron descargar fotos (${response.status})`);
    }

    const currentManifest = this.imageManifest();
    this.imageManifest.set({
      meta: currentManifest?.meta ?? {
        generatedAt: new Date().toISOString(),
        source: 'Airbnb canonical public HTML + a0.muscache.com image URLs',
        method: 'Descarga desde el servidor local de la app.',
        maxImagesPerListing: 8,
      },
      listings: {
        ...(currentManifest?.listings ?? {}),
        [listing.id]: payload.manifestEntry ?? {
          title: listing.title,
          canonicalUrl: listing.canonicalUrl,
          status: 'ok',
          imageCount: payload.imageCount,
          images: payload.images,
          sourceUrls: payload.sourceUrls,
        },
      },
    });

    this.emitModelTelemetry('cnn-fotos-descargadas');
  }
}

function averageImageMetrics(images: ImageAnalysis[]): ScoreFactor[] {
  if (images.length === 0) {
    return [];
  }
  return images[0].metrics.map((metric, index) => {
    const average = images.reduce((sum, image) => sum + image.metrics[index].value, 0) / images.length;
    return {
      label: metric.label,
      value: roundOne(average),
      detail: images.length === 1 ? metric.detail : `promedio de ${images.length} imagenes`,
    };
  });
}

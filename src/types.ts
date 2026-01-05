// ============================================================================
// Plugin Settings
// ============================================================================

export interface SummarizeSettings {
  // OpenRouter Configuration
  openRouterApiKey: string;
  defaultModel: string;

  // Summarization defaults
  defaultLength: SummaryLength;
  outputLanguage: string; // empty = auto-detect from content

  // Output behavior
  insertBehavior: InsertBehavior;

  // OpenRouter model cache
  openRouter: OpenRouterCache;
}

export type SummaryLength = "short" | "medium" | "long";
export type InsertBehavior = "below" | "replace" | "clipboard";

// ============================================================================
// OpenRouter Types
// ============================================================================

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: OpenRouterPricing;
  architecture?: OpenRouterArchitecture;
}

export interface OpenRouterPricing {
  prompt: number;
  completion: number;
  request?: number;
  image?: number;
}

export interface OpenRouterArchitecture {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  tokenizer?: string;
}

export interface OpenRouterCache {
  models: OpenRouterModel[];
  lastFetched: string | null;
  selectedModels: string[];
  freeModelRank: string[];
}

// ============================================================================
// API Types (for other plugins)
// ============================================================================

export interface SummarizeOptions {
  /** Summary length: short (~100 words), medium (~250 words), long (~500 words) */
  length?: SummaryLength;
  /** Output language (e.g., "en", "de"). Empty = auto-detect from content */
  language?: string;
  /** Override the default model */
  model?: string;
  /** Optional callback for streaming responses */
  onStream?: (chunk: string) => void;
}

export interface SummarizeAPI {
  /** Summarize text content */
  summarize(content: string, options?: SummarizeOptions): Promise<string>;
  /** Summarize content from a URL */
  summarizeUrl(url: string, options?: SummarizeOptions): Promise<string>;
  /** Check if the plugin is configured (has API key) */
  isConfigured(): boolean;
}

// ============================================================================
// Internal Types
// ============================================================================

export interface ExtractedContent {
  title: string;
  content: string;
  url: string;
  wordCount: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_SETTINGS: SummarizeSettings = {
  openRouterApiKey: "",
  defaultModel: "google/gemini-2.0-flash-exp:free",
  defaultLength: "medium",
  outputLanguage: "",
  insertBehavior: "below",
  openRouter: {
    models: [],
    lastFetched: null,
    selectedModels: [],
    freeModelRank: [],
  },
};

// ============================================================================
// Length to word count mapping
// ============================================================================

export const LENGTH_WORD_COUNTS: Record<SummaryLength, number> = {
  short: 100,
  medium: 250,
  long: 500,
};

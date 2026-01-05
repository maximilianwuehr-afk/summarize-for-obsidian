// ============================================================================
// Plugin Settings
// ============================================================================

export interface SummarizeSettings {
  // OpenRouter Configuration
  openRouterApiKey: string;
  defaultModel: string;

  // Summarization defaults
  defaultLength: SummaryLength;
  customPrompt: string; // custom prompt template (empty = use default)

  // Output behavior
  insertBehavior: InsertBehavior;

  // OpenRouter model cache
  openRouter: OpenRouterCache;
}

export type SummaryLength = "brief" | "short" | "medium" | "long";
export type InsertBehavior = "below" | "replace" | "clipboard";

// ============================================================================
// OpenRouter Types
// ============================================================================

export interface OpenRouterModel {
  id: string;
  canonical_slug?: string;
  hugging_face_id?: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: OpenRouterPricing;
  supported_parameters?: string[];
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

export interface OpenRouterBenchmarks {
  arenaScores: Record<string, number>;
  openLlmScores: Record<string, number>;
  openLlmFetched: Record<string, string>;
  lastFetched: string | null;
}

export interface OpenRouterCache {
  models: OpenRouterModel[];
  lastFetched: string | null;
  selectedModels: string[];
  freeModelRank: string[];
  benchmarks: OpenRouterBenchmarks;
}

// ============================================================================
// API Types (for other plugins)
// ============================================================================

export interface SummarizeOptions {
  /** Summary length: brief (~50 words), short (~100 words), medium (~250 words), long (~500 words) */
  length?: SummaryLength;
  /** Override the default model */
  model?: string;
  /** Custom prompt template. Use {{content}} and {{wordCount}} as placeholders */
  prompt?: string;
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

export const DEFAULT_PROMPT = `Summarize the following content in approximately {{wordCount}} words.

Rules:
- Lead with the single most important insight or finding
- Format as bullets: one-liner "why this matters", then elaboration
- Include specific details: numbers, names, concrete examples
- Skip meta-commentary ("This article discusses...")
- Skip obvious context ("In today's world...")
- If something important is NOT covered, note it briefly at the end

{{content}}`;

export const DEFAULT_SETTINGS: SummarizeSettings = {
  openRouterApiKey: "",
  defaultModel: "google/gemini-2.0-flash-exp:free",
  defaultLength: "medium",
  customPrompt: "",
  insertBehavior: "below",
  openRouter: {
    models: [],
    lastFetched: null,
    selectedModels: [],
    freeModelRank: [],
    benchmarks: {
      arenaScores: {},
      openLlmScores: {},
      openLlmFetched: {},
      lastFetched: null,
    },
  },
};

// ============================================================================
// Length to word count mapping
// ============================================================================

export const LENGTH_WORD_COUNTS: Record<SummaryLength, number> = {
  brief: 50,
  short: 100,
  medium: 250,
  long: 500,
};

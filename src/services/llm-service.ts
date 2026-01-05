import { requestUrl, Notice } from "obsidian";
import {
  SummarizeSettings,
  LLMResponse,
  SummaryLength,
  LENGTH_WORD_COUNTS,
  OpenRouterModel,
  DEFAULT_PROMPT,
} from "../types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/**
 * Service for interacting with OpenRouter LLM API
 */
export class LLMService {
  private settings: SummarizeSettings;

  constructor(settings: SummarizeSettings) {
    this.settings = settings;
  }

  updateSettings(settings: SummarizeSettings): void {
    this.settings = settings;
  }

  /**
   * Check if the service is configured with an API key
   */
  isConfigured(): boolean {
    return Boolean(this.settings.openRouterApiKey);
  }

  /**
   * Generate a summary of the provided content
   */
  async summarize(
    content: string,
    options: {
      length?: SummaryLength;
      language?: string;
      model?: string;
      prompt?: string;
      onStream?: (chunk: string) => void;
    } = {}
  ): Promise<LLMResponse> {
    const requestedModel = options.model || this.settings.defaultModel;
    const length = options.length || this.settings.defaultLength;
    const language = options.language || this.settings.outputLanguage;

    const prompt = this.buildSummarizationPrompt(content, length, language, options.prompt);

    // Handle auto-free model selection with fallback
    if (requestedModel === "auto-free") {
      return this.completionWithAutoFree(prompt, options.onStream);
    }

    // Use streaming if callback provided, otherwise regular request
    if (options.onStream) {
      return this.streamCompletion(requestedModel, prompt, options.onStream);
    } else {
      return this.completion(requestedModel, prompt);
    }
  }

  /**
   * Build the summarization prompt using template with placeholders.
   * Placeholders: {{content}}, {{wordCount}}, {{language}}
   */
  private buildSummarizationPrompt(
    content: string,
    length: SummaryLength,
    language: string,
    customPrompt?: string
  ): string {
    const wordCount = LENGTH_WORD_COUNTS[length];
    const languageInstruction = language
      ? `Write the summary in ${language}.`
      : "Write the summary in the same language as the source content.";

    // Priority: parameter prompt > settings customPrompt > DEFAULT_PROMPT
    const template = customPrompt || this.settings.customPrompt || DEFAULT_PROMPT;

    return template
      .replace(/\{\{content\}\}/g, content)
      .replace(/\{\{wordCount\}\}/g, String(wordCount))
      .replace(/\{\{language\}\}/g, languageInstruction);
  }

  /**
   * Try completion with auto-free model fallback on rate limits
   */
  private async completionWithAutoFree(
    prompt: string,
    onStream?: (chunk: string) => void
  ): Promise<LLMResponse> {
    const freeModels = this.settings.openRouter.freeModelRank;

    if (freeModels.length === 0) {
      throw new Error(
        "No free models ranked. Add models in Settings > Free Rank tab."
      );
    }

    let lastError: Error | null = null;

    for (const modelId of freeModels) {
      try {
        console.log(`[Summarize] Trying model: ${modelId}`);

        if (onStream) {
          return await this.streamCompletion(modelId, prompt, onStream);
        } else {
          return await this.completion(modelId, prompt);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if it's a rate limit error (429)
        const isRateLimit =
          lastError.message.includes("429") ||
          lastError.message.toLowerCase().includes("rate limit") ||
          lastError.message.toLowerCase().includes("too many requests");

        if (isRateLimit) {
          console.log(`[Summarize] Rate limited on ${modelId}, trying next...`);
          new Notice(`Rate limited on ${this.getModelName(modelId)}, trying next...`);
          continue;
        }

        // For other errors, throw immediately
        throw lastError;
      }
    }

    // All models failed
    throw new Error(
      `All ranked free models are rate limited. Last error: ${lastError?.message}`
    );
  }

  /**
   * Get model display name from ID
   */
  private getModelName(modelId: string): string {
    const model = this.settings.openRouter.models.find((m) => m.id === modelId);
    return model?.name || modelId;
  }

  /**
   * Make a completion request (non-streaming)
   */
  private async completion(model: string, prompt: string): Promise<LLMResponse> {
    const response = await requestUrl({
      url: OPENROUTER_API_URL,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://obsidian.md",
        "X-Title": "Obsidian Summarize Plugin",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
      }),
      throw: false, // Don't throw on non-2xx, we handle it
    });

    if (response.status === 429) {
      throw new Error(`Rate limit exceeded (429) for model ${model}`);
    }

    if (response.status !== 200) {
      const errorText = response.text || `HTTP ${response.status}`;
      throw new Error(`OpenRouter API error: ${errorText}`);
    }

    const data = response.json;

    // Check for error in response body
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }

    const content = data.choices?.[0]?.message?.content || "";

    return {
      content,
      model: data.model || model,
      usage: data.usage,
    };
  }

  /**
   * Make a streaming completion request
   */
  private async streamCompletion(
    model: string,
    prompt: string,
    onStream: (chunk: string) => void
  ): Promise<LLMResponse> {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://obsidian.md",
        "X-Title": "Obsidian Summarize Plugin",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
        stream: true,
      }),
    });

    if (response.status === 429) {
      throw new Error(`Rate limit exceeded (429) for model ${model}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body reader available");
    }

    const decoder = new TextDecoder();
    let fullContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            // Check for error in stream
            if (parsed.error) {
              throw new Error(parsed.error.message || JSON.stringify(parsed.error));
            }

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              onStream(content);
            }
          } catch (e) {
            // Only rethrow if it's our error, ignore JSON parse errors
            if (e instanceof Error && e.message.includes("error")) {
              throw e;
            }
          }
        }
      }
    }

    return {
      content: fullContent,
      model,
    };
  }

  /**
   * Fetch available models from OpenRouter
   */
  async fetchModels(): Promise<OpenRouterModel[]> {
    const response = await requestUrl({
      url: OPENROUTER_MODELS_URL,
      headers: {
        Authorization: `Bearer ${this.settings.openRouterApiKey}`,
      },
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = response.json;
    return (data.data || [])
      .map((m: Record<string, unknown>) => this.normalizeModel(m))
      .filter((m): m is OpenRouterModel => m !== null);
  }

  /**
   * Normalize model data from OpenRouter API (handles string/number type coercion)
   */
  private normalizeModel(raw: Record<string, unknown>): OpenRouterModel | null {
    const id = typeof raw.id === "string" ? raw.id : null;
    if (!id) return null;

    const pricing = (raw.pricing as Record<string, unknown> | undefined) ?? {};

    // OpenRouter API returns pricing as strings, need to parse them
    const parseNumber = (value: unknown): number => {
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    };

    const contextLengthRaw = raw.context_length;
    const contextLength =
      typeof contextLengthRaw === "number"
        ? contextLengthRaw
        : typeof contextLengthRaw === "string"
          ? parseInt(contextLengthRaw, 10)
          : 4096;

    return {
      id,
      canonical_slug: typeof raw.canonical_slug === "string" ? raw.canonical_slug : undefined,
      hugging_face_id: typeof raw.hugging_face_id === "string" ? raw.hugging_face_id : undefined,
      name: typeof raw.name === "string" ? raw.name : id,
      description: typeof raw.description === "string" ? raw.description : undefined,
      context_length: Number.isFinite(contextLength) ? contextLength : 4096,
      pricing: {
        prompt: parseNumber(pricing.prompt),
        completion: parseNumber(pricing.completion),
        request: parseNumber(pricing.request) || undefined,
        image: parseNumber(pricing.image) || undefined,
      },
      supported_parameters: Array.isArray(raw.supported_parameters)
        ? (raw.supported_parameters as string[])
        : [],
      architecture: raw.architecture as OpenRouterModel["architecture"],
    };
  }

  /**
   * Check if a model is free (has :free suffix or zero pricing)
   */
  isModelFree(model: OpenRouterModel): boolean {
    return model.id.endsWith(":free") || (model.pricing.prompt === 0 && model.pricing.completion === 0);
  }

  /**
   * Format model pricing for display
   */
  formatModelPricing(model: OpenRouterModel): string {
    if (this.isModelFree(model)) {
      return "Free";
    }
    const promptCost = model.pricing?.prompt || 0;
    const completionCost = model.pricing?.completion || 0;
    return `$${(promptCost * 1000000).toFixed(2)}/$${(completionCost * 1000000).toFixed(2)} per 1M tokens`;
  }
}

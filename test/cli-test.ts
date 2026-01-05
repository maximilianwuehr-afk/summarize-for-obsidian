#!/usr/bin/env npx tsx
/**
 * CLI Test Script for Summarize Plugin
 *
 * Usage:
 *   npx tsx test/cli-test.ts <url> [--summarize] [--length=brief|short|medium|long]
 *
 * Examples:
 *   npx tsx test/cli-test.ts https://example.com/article
 *   npx tsx test/cli-test.ts https://example.com/article --summarize
 *   npx tsx test/cli-test.ts https://twitter.com/user/status/123 --summarize --length=brief
 *
 * API Key Resolution (in order):
 *   1. OPENROUTER_API_KEY environment variable
 *   2. Auto-read from Obsidian plugin settings (data.json)
 */

import TurndownService from "turndown";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ============================================================================
// Settings Loader
// ============================================================================

interface PluginSettings {
  openRouterApiKey?: string;
  defaultModel?: string;
  defaultLength?: SummaryLength;
  openRouter?: {
    freeModelRank?: string[];
  };
}

// Default free models to try (fallback if no rank configured)
const DEFAULT_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "qwen/qwen3-32b:free",
];

function loadPluginSettings(): PluginSettings | null {
  // Try common vault locations
  const possiblePaths = [
    join(homedir(), "Workspace/wuehr/.obsidian/plugins/summarize/data.json"),
    join(homedir(), "Workspace/wuehr/.obsidian/plugins/summarize-for-obsidian/data.json"),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const settings = JSON.parse(content);
        console.log(`[Config] Loaded settings from: ${path}`);
        return settings;
      } catch (e) {
        console.warn(`[Config] Failed to parse ${path}: ${e}`);
      }
    }
  }

  return null;
}

function getApiKey(): string | null {
  // 1. Environment variable takes precedence
  if (process.env.OPENROUTER_API_KEY) {
    console.log("[Config] Using API key from OPENROUTER_API_KEY env var");
    return process.env.OPENROUTER_API_KEY;
  }

  // 2. Try to load from plugin settings
  const settings = loadPluginSettings();
  if (settings?.openRouterApiKey) {
    console.log("[Config] Using API key from Obsidian plugin settings");
    return settings.openRouterApiKey;
  }

  return null;
}

function getFreeModelRank(): string[] {
  const settings = loadPluginSettings();
  if (settings?.openRouter?.freeModelRank?.length) {
    console.log(`[Config] Using ${settings.openRouter.freeModelRank.length} ranked free models from settings`);
    return settings.openRouter.freeModelRank;
  }
  console.log("[Config] Using default free model list");
  return DEFAULT_FREE_MODELS;
}

// ============================================================================
// Types
// ============================================================================

interface ExtractedContent {
  title: string;
  content: string;
  url: string;
  wordCount: number;
}

type SummaryLength = "brief" | "short" | "medium" | "long";

const LENGTH_WORD_COUNTS: Record<SummaryLength, number> = {
  brief: 50,
  short: 100,
  medium: 250,
  long: 500,
};

// ============================================================================
// Content Extractor (adapted from plugin)
// ============================================================================

class ContentExtractor {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });

    // Remove script, style, nav, footer, aside elements
    this.turndown.remove(["script", "style", "nav", "footer", "aside", "header", "noscript", "iframe"]);

    // Keep links but simplify
    this.turndown.addRule("links", {
      filter: "a",
      replacement: (content) => content,
    });
  }

  async extractFromUrl(url: string, followLinks: boolean = true): Promise<ExtractedContent> {
    // Resolve URL shorteners (t.co, bit.ly, etc.) first
    let resolvedUrl = url;
    if (this.isUrlShortener(url)) {
      resolvedUrl = await this.resolveShortUrl(url);
      console.log(`[Extractor] Resolved ${url} → ${resolvedUrl}`);
    }

    // Convert GitHub blob URLs to raw URLs
    const processedUrl = this.convertGitHubUrl(resolvedUrl);

    // Handle raw GitHub/text content
    if (this.isRawTextUrl(processedUrl)) {
      return this.extractRawText(processedUrl);
    }

    // Use Jina Reader for JS-heavy sites
    if (this.needsJsRendering(processedUrl)) {
      const tweetContent = await this.extractViaJina(url);

      // For tweets, optionally follow the first URL in the content
      if (followLinks) {
        const linkedUrl = this.extractFirstUrl(tweetContent.content);
        if (linkedUrl) {
          console.log(`[Extractor] Found linked URL in tweet: ${linkedUrl}`);
          try {
            const linkedContent = await this.extractFromUrl(linkedUrl, false); // Don't recurse further
            console.log(`[Extractor] Extracted ${linkedContent.wordCount} words from linked content`);

            // Combine tweet + linked content
            return {
              title: tweetContent.title,
              content: `${tweetContent.content}\n\n---\n\n## Linked Article: ${linkedContent.title}\n\n${linkedContent.content}`,
              url: tweetContent.url,
              wordCount: tweetContent.wordCount + linkedContent.wordCount,
            };
          } catch (error) {
            console.log(`[Extractor] Failed to fetch linked URL: ${error instanceof Error ? error.message : error}`);
            // Fall back to just the tweet content
          }
        }
      }

      return tweetContent;
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Obsidian Summarize Plugin)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Parse HTML using linkedom (Node.js DOM parser)
    const { parseHTML } = await import("linkedom");
    const { document: doc } = parseHTML(html);

    // Extract title
    const title = this.extractTitle(doc);

    // Extract main content
    const mainContent = this.extractMainContent(doc);

    // Convert to markdown
    const markdown = this.turndown.turndown(mainContent);

    // Clean up the markdown
    const cleanedContent = this.cleanMarkdown(markdown);

    return {
      title,
      content: cleanedContent,
      url,
      wordCount: this.countWords(cleanedContent),
    };
  }

  /**
   * Check if URL is a shortener service
   */
  private isUrlShortener(url: string): boolean {
    try {
      const parsed = new URL(url);
      const shorteners = ["t.co", "bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "is.gd"];
      return shorteners.includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  /**
   * Resolve a shortened URL to its final destination
   */
  private async resolveShortUrl(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
      });
      return response.url;
    } catch {
      // Fallback: try GET request
      try {
        const response = await fetch(url, { redirect: "follow" });
        return response.url;
      } catch {
        return url;
      }
    }
  }

  /**
   * Convert GitHub blob URLs to raw URLs for direct content access
   */
  private convertGitHubUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Convert github.com/user/repo/blob/branch/path to raw.githubusercontent.com/user/repo/branch/path
      if (parsed.hostname === "github.com" && parsed.pathname.includes("/blob/")) {
        const newPath = parsed.pathname.replace("/blob/", "/");
        return `https://raw.githubusercontent.com${newPath}`;
      }

      return url;
    } catch {
      return url;
    }
  }

  /**
   * Check if URL returns raw text (not HTML)
   */
  private isRawTextUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === "raw.githubusercontent.com";
    } catch {
      return false;
    }
  }

  /**
   * Extract content from raw text URLs (GitHub raw, etc.)
   */
  private async extractRawText(url: string): Promise<ExtractedContent> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Obsidian Summarize Plugin)",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();

    // Extract title from first heading or filename
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const pathParts = new URL(url).pathname.split("/");
    const filename = pathParts[pathParts.length - 1];
    const title = titleMatch ? titleMatch[1].trim() : filename;

    return {
      title,
      content: content.trim(),
      url,
      wordCount: this.countWords(content),
    };
  }

  private needsJsRendering(url: string): boolean {
    try {
      const parsed = new URL(url);
      const jsHeavyDomains = [
        "twitter.com",
        "x.com",
        "mobile.twitter.com",
        "mobile.x.com",
      ];
      return jsHeavyDomains.some(
        (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
      );
    } catch {
      return false;
    }
  }

  private async extractViaJina(url: string): Promise<ExtractedContent> {
    const jinaUrl = `https://r.jina.ai/${url}`;

    const response = await fetch(jinaUrl, {
      headers: {
        Accept: "text/markdown",
      },
    });

    if (!response.ok) {
      throw new Error(`Jina Reader failed: ${response.status} ${response.statusText}`);
    }

    const markdown = await response.text();

    // Extract title from first heading or first line
    const titleMatch = markdown.match(/^#\s+(.+)$/m) || markdown.match(/^(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "Tweet";

    const cleanedContent = this.cleanMarkdown(markdown);

    return {
      title,
      content: cleanedContent,
      url,
      wordCount: this.countWords(cleanedContent),
    };
  }

  private extractTitle(doc: Document): string {
    // Try og:title first
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      return ogTitle.getAttribute("content") || "";
    }

    // Fall back to <title>
    const titleEl = doc.querySelector("title");
    if (titleEl) {
      return titleEl.textContent || "";
    }

    // Fall back to first h1
    const h1 = doc.querySelector("h1");
    if (h1) {
      return h1.textContent || "";
    }

    return "Untitled";
  }

  private extractMainContent(doc: Document): string {
    const selectors = [
      "article",
      '[role="main"]',
      "main",
      ".post-content",
      ".article-content",
      ".entry-content",
      ".content",
      "#content",
      ".post",
      ".article",
    ];

    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (element && this.hasSubstantialContent(element)) {
        return element.innerHTML;
      }
    }

    // Fall back to body with cleanup
    const body = doc.body;
    if (!body) return "";

    // Remove non-content elements
    const removeSelectors = [
      "nav", "header", "footer", "aside", ".sidebar", ".navigation",
      ".menu", ".comments", ".related", ".share", ".social",
      "#sidebar", "#navigation", "#menu", "#comments",
    ];

    for (const selector of removeSelectors) {
      body.querySelectorAll(selector).forEach((el) => el.remove());
    }

    return body.innerHTML;
  }

  private hasSubstantialContent(element: Element): boolean {
    const text = element.textContent || "";
    const words = text.trim().split(/\s+/).length;
    return words > 100;
  }

  private cleanMarkdown(markdown: string): string {
    return markdown
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s+$/gm, "")
      .trim();
  }

  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Extract the first HTTP(S) URL from text content.
   * Filters out twitter/x.com URLs and common non-article URLs.
   */
  private extractFirstUrl(content: string): string | null {
    // Match URLs - be careful not to include trailing punctuation
    const urlRegex = /https?:\/\/[^\s<>")\]]+/g;
    const matches = content.match(urlRegex);

    if (!matches) return null;

    // Filter and clean URLs
    for (const rawUrl of matches) {
      // Clean trailing punctuation that might have been captured
      const url = rawUrl.replace(/[.,;:!?)]+$/, "");

      try {
        const parsed = new URL(url);

        // Skip twitter/x.com URLs (we're already processing those)
        // But allow t.co - those are shortlinks to external content
        if (
          parsed.hostname === "twitter.com" ||
          parsed.hostname === "x.com" ||
          parsed.hostname.endsWith(".twitter.com") ||
          parsed.hostname.endsWith(".x.com")
        ) {
          continue;
        }

        // Skip common non-article URLs
        const skipPatterns = [
          /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i,
          /\.(mp4|webm|mov|avi)$/i,
          /\.(pdf)$/i, // Could support PDFs later
          /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/,
        ];

        if (skipPatterns.some((pattern) => pattern.test(url))) {
          continue;
        }

        return url;
      } catch {
        continue;
      }
    }

    return null;
  }
}

// ============================================================================
// LLM Service (adapted from plugin)
// ============================================================================

class LLMService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async summarize(
    content: string,
    options: { length?: SummaryLength; language?: string; model?: string } = {}
  ): Promise<{ content: string; model: string }> {
    const model = options.model || "auto-free";
    const length = options.length || "medium";
    const language = options.language || "";

    const prompt = this.buildPrompt(content, length, language);

    // Use auto-fallback for auto-free or if no model specified
    if (model === "auto-free") {
      return this.completionWithFallback(prompt);
    }

    return this.completion(model, prompt);
  }

  private buildPrompt(content: string, length: SummaryLength, language: string): string {
    const wordCount = LENGTH_WORD_COUNTS[length];
    const languageInstruction = language
      ? `Write the summary in ${language}.`
      : "Write the summary in the same language as the source content.";

    return `Summarize the following content in approximately ${wordCount} words.

Instructions:
- Focus on the key points and main ideas
- ${languageInstruction}
- Use clear, concise language
- Maintain the original meaning and intent
- Do not include meta-commentary like "This article discusses..."
- Start directly with the summary content

Content to summarize:
---
${content}
---

Summary:`;
  }

  private async completionWithFallback(prompt: string): Promise<{ content: string; model: string }> {
    const freeModels = getFreeModelRank();
    let lastError: Error | null = null;

    for (const modelId of freeModels) {
      try {
        console.log(`[LLM] Trying model: ${modelId}`);
        return await this.completion(modelId, prompt);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if it's a rate limit error (429)
        const isRateLimit =
          lastError.message.includes("429") ||
          lastError.message.toLowerCase().includes("rate limit") ||
          lastError.message.toLowerCase().includes("too many requests");

        if (isRateLimit) {
          console.log(`[LLM] Rate limited on ${modelId}, trying next...`);
          continue;
        }

        // For other errors, throw immediately
        throw lastError;
      }
    }

    throw new Error(`All free models rate limited. Last error: ${lastError?.message}`);
  }

  private async completion(model: string, prompt: string): Promise<{ content: string; model: string }> {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://obsidian.md",
        "X-Title": "Obsidian Summarize Plugin Test",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }

    return {
      content: data.choices?.[0]?.message?.content || "",
      model: data.model || model,
    };
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Summarize Plugin CLI Test

Usage:
  npx tsx test/cli-test.ts <url> [options]

Options:
  --summarize          Also run LLM summarization
  --length=<len>       Summary length: brief (50), short (100), medium (250), long (500)
  --model=<model>      OpenRouter model ID (default: auto-free with fallback)
  --no-follow          Don't fetch linked URLs in tweets (tweet content only)
  --verbose            Show detailed extraction info

Examples:
  npx tsx test/cli-test.ts https://example.com/article
  npx tsx test/cli-test.ts https://news.ycombinator.com --summarize --length=brief
  npx tsx test/cli-test.ts https://x.com/user/status/123 --summarize
  npx tsx test/cli-test.ts https://x.com/user/status/123 --summarize --no-follow

Environment:
  OPENROUTER_API_KEY   Required for --summarize flag
`);
    process.exit(0);
  }

  // Parse arguments
  const url = args.find((arg) => !arg.startsWith("--"));
  const doSummarize = args.includes("--summarize");
  const verbose = args.includes("--verbose");
  const followLinks = !args.includes("--no-follow");

  const lengthArg = args.find((arg) => arg.startsWith("--length="));
  const length = (lengthArg?.split("=")[1] as SummaryLength) || "medium";

  const modelArg = args.find((arg) => arg.startsWith("--model="));
  const model = modelArg?.split("=")[1];

  if (!url) {
    console.error("Error: No URL provided");
    process.exit(1);
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`Error: Invalid URL: ${url}`);
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${url}`);
  console.log(`${"=".repeat(60)}\n`);

  // Extract content
  console.log("[1/2] Extracting content...\n");
  const extractor = new ContentExtractor();

  try {
    const extracted = await extractor.extractFromUrl(url, followLinks);

    console.log(`Title: ${extracted.title}`);
    console.log(`Word count: ${extracted.wordCount}`);
    console.log(`URL: ${extracted.url}`);

    if (verbose) {
      console.log(`\n--- Extracted Content Preview (first 1000 chars) ---`);
      console.log(extracted.content.slice(0, 1000));
      console.log(`--- End Preview ---\n`);
    } else {
      console.log(`\n--- Content Preview (first 500 chars) ---`);
      console.log(extracted.content.slice(0, 500));
      if (extracted.content.length > 500) console.log("...");
      console.log(`--- End Preview ---\n`);
    }

    // Summarize if requested
    if (doSummarize) {
      const apiKey = getApiKey();

      if (!apiKey) {
        console.error("Error: No API key found.");
        console.error("Options:");
        console.error("  1. Set OPENROUTER_API_KEY environment variable");
        console.error("  2. Configure the Summarize plugin in Obsidian");
        process.exit(1);
      }

      console.log(`[2/2] Summarizing (length: ${length}, ~${LENGTH_WORD_COUNTS[length]} words)...\n`);

      const llm = new LLMService(apiKey);
      const result = await llm.summarize(extracted.content, { length, model });

      console.log(`Model used: ${result.model}`);
      console.log(`\n--- Summary ---`);
      console.log(result.content);
      console.log(`--- End Summary ---\n`);
    } else {
      console.log("[2/2] Skipping summarization (add --summarize to enable)\n");
    }

    console.log("Done!");

  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();

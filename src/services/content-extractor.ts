import { requestUrl, RequestUrlResponse } from "obsidian";
import TurndownService from "turndown";
import { ExtractedContent } from "../types";

/**
 * Service for extracting content from URLs and converting to clean markdown.
 * Uses Turndown for HTML→Markdown conversion and basic readability heuristics.
 */
export class ContentExtractor {
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
      replacement: (content, node) => {
        const href = (node as HTMLAnchorElement).getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
          return content;
        }
        return content;
      },
    });
  }

  /**
   * Extract content from a URL
   */
  async extractFromUrl(url: string): Promise<ExtractedContent> {
    const response = await this.fetchUrl(url);
    const html = response.text;

    // Parse HTML using DOMParser (available in Obsidian's Electron environment)
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

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
   * Fetch URL with appropriate headers
   */
  private async fetchUrl(url: string): Promise<RequestUrlResponse> {
    return requestUrl({
      url,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Obsidian Summarize Plugin)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
  }

  /**
   * Extract page title
   */
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

  /**
   * Extract main content using readability heuristics
   */
  private extractMainContent(doc: Document): string {
    // Try common article containers first
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

    // Fall back to body, but try to remove common non-content elements
    const body = doc.body.cloneNode(true) as HTMLElement;

    // Remove elements that are typically not content
    const removeSelectors = [
      "nav",
      "header",
      "footer",
      "aside",
      ".sidebar",
      ".navigation",
      ".menu",
      ".comments",
      ".related",
      ".share",
      ".social",
      "#sidebar",
      "#navigation",
      "#menu",
      "#comments",
    ];

    for (const selector of removeSelectors) {
      body.querySelectorAll(selector).forEach((el) => el.remove());
    }

    return body.innerHTML;
  }

  /**
   * Check if an element has substantial text content
   */
  private hasSubstantialContent(element: Element): boolean {
    const text = element.textContent || "";
    const words = text.trim().split(/\s+/).length;
    return words > 100;
  }

  /**
   * Clean up markdown output
   */
  private cleanMarkdown(markdown: string): string {
    return (
      markdown
        // Remove excessive newlines
        .replace(/\n{3,}/g, "\n\n")
        // Remove lines that are just whitespace
        .replace(/^\s+$/gm, "")
        // Remove leading/trailing whitespace
        .trim()
    );
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }
}

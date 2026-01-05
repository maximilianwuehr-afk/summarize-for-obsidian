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
    // Resolve URL shorteners (t.co, bit.ly, etc.) first
    let resolvedUrl = url;
    if (this.isUrlShortener(url)) {
      resolvedUrl = await this.resolveShortUrl(url);
      console.log(`[Summarize] Resolved ${url} → ${resolvedUrl}`);
    }

    // Convert GitHub blob URLs to raw URLs
    const processedUrl = this.convertGitHubUrl(resolvedUrl);

    // Handle raw GitHub/text content
    if (this.isRawTextUrl(processedUrl)) {
      return this.extractRawText(processedUrl);
    }

    // Use Jina Reader for JS-heavy sites (Twitter/X, etc.)
    if (this.needsJsRendering(processedUrl)) {
      return this.extractViaJina(url);
    }

    const response = await this.fetchUrl(processedUrl);
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
   * Check if URL needs JavaScript rendering (Twitter, X, etc.)
   */
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

  /**
   * Extract content via Jina Reader (handles JS-rendered pages)
   */
  private async extractViaJina(url: string): Promise<ExtractedContent> {
    const jinaUrl = `https://r.jina.ai/${url}`;

    const response = await requestUrl({
      url: jinaUrl,
      headers: {
        Accept: "text/markdown",
      },
    });

    const markdown = response.text;

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
   * Uses fetch() to get the final URL after redirects
   */
  private async resolveShortUrl(url: string): Promise<string> {
    try {
      // Use fetch() which exposes response.url after redirects
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
    const response = await requestUrl({
      url,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Obsidian Summarize Plugin)",
      },
    });

    const content = response.text;

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
}

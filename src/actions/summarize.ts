import { App, Editor, MarkdownView, Notice, Modal, Setting } from "obsidian";
import { ContentExtractor } from "../services/content-extractor";
import { LLMService } from "../services/llm-service";
import { SummarizeSettings, SummarizeOptions, SummaryLength } from "../types";

/**
 * Handles all summarization actions
 */
export class SummarizeAction {
  private app: App;
  private settings: SummarizeSettings;
  private contentExtractor: ContentExtractor;
  private llmService: LLMService;

  constructor(
    app: App,
    settings: SummarizeSettings,
    contentExtractor: ContentExtractor,
    llmService: LLMService
  ) {
    this.app = app;
    this.settings = settings;
    this.contentExtractor = contentExtractor;
    this.llmService = llmService;
  }

  updateSettings(settings: SummarizeSettings): void {
    this.settings = settings;
  }

  /**
   * Summarize a URL - prompts user for URL input
   */
  async summarizeUrlCommand(): Promise<void> {
    if (!this.llmService.isConfigured()) {
      new Notice("Please configure your OpenRouter API key in settings.");
      return;
    }

    // Show URL input modal
    const url = await this.promptForUrl();
    if (!url) return;

    await this.summarizeUrl(url);
  }

  /**
   * Summarize the current selection
   * If selection contains URLs, fetches their content and includes it
   */
  async summarizeSelectionCommand(): Promise<void> {
    if (!this.llmService.isConfigured()) {
      new Notice("Please configure your OpenRouter API key in settings.");
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("No active markdown view.");
      return;
    }

    const editor = view.editor;
    const selection = editor.getSelection().trim();

    if (!selection) {
      new Notice("No text selected.");
      return;
    }

    // Check if selection is just a single URL
    const singleUrl = this.extractSingleUrl(selection);
    if (singleUrl) {
      await this.summarizeUrl(singleUrl);
      return;
    }

    // Check if selection contains a URL - fetch and append its content
    const urls = this.extractUrls(selection);
    if (urls.length > 0) {
      await this.summarizeTextWithUrls(selection, [urls[0]], editor);
      return;
    }

    await this.summarizeText(selection, editor);
  }

  /**
   * Extract a single URL if the text is just a URL
   */
  private extractSingleUrl(text: string): string | null {
    const trimmed = text.trim();

    // Check if it's a bare URL
    if (/^https?:\/\/[^\s]+$/.test(trimmed)) {
      try {
        new URL(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }

    // Check if it's a markdown link [text](url)
    const mdMatch = trimmed.match(/^\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/);
    if (mdMatch) {
      try {
        new URL(mdMatch[2]);
        return mdMatch[2];
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Extract all URLs from text (bare URLs and markdown links)
   */
  private extractUrls(text: string): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();

    // Match bare URLs
    const bareUrlRegex = /https?:\/\/[^\s<>")\]]+/g;
    let match;
    while ((match = bareUrlRegex.exec(text)) !== null) {
      const url = match[0].replace(/[.,;:!?)]+$/, ""); // Clean trailing punctuation
      if (!seen.has(url)) {
        try {
          new URL(url);
          seen.add(url);
          urls.push(url);
        } catch {
          // Invalid URL, skip
        }
      }
    }

    // Match markdown links [text](url)
    const mdLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    while ((match = mdLinkRegex.exec(text)) !== null) {
      const url = match[2];
      if (!seen.has(url)) {
        try {
          new URL(url);
          seen.add(url);
          urls.push(url);
        } catch {
          // Invalid URL, skip
        }
      }
    }

    return urls;
  }

  /**
   * Summarize text that contains URLs by fetching their content
   */
  private async summarizeTextWithUrls(
    text: string,
    urls: string[],
    editor: Editor
  ): Promise<void> {
    const notice = new Notice("Fetching linked content...", 0);

    try {
      let combinedContent = text;

      for (const url of urls) {
        try {
          notice.setMessage(`Fetching ${new URL(url).hostname}...`);
          const extracted = await this.contentExtractor.extractFromUrl(url);
          combinedContent += `\n\n---\n\n## Content from: ${extracted.title}\nSource: ${url}\n\n${extracted.content}`;
        } catch (error) {
          console.warn(`[Summarize] Failed to fetch ${url}:`, error);
          // Continue with other URLs
        }
      }

      notice.setMessage("Summarizing...");

      const response = await this.llmService.summarize(combinedContent, {
        length: this.settings.defaultLength,
        language: this.settings.outputLanguage,
      });

      notice.hide();
      new Notice("Summary complete!");

      this.insertSummary(editor, response.content);
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Failed to summarize: ${message}`);
      throw error;
    }
  }

  /**
   * Summarize the current note
   */
  async summarizeNoteCommand(): Promise<void> {
    if (!this.llmService.isConfigured()) {
      new Notice("Please configure your OpenRouter API key in settings.");
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("No active markdown view.");
      return;
    }

    const editor = view.editor;
    const content = editor.getValue();

    if (!content.trim()) {
      new Notice("Note is empty.");
      return;
    }

    await this.summarizeText(content, editor);
  }

  /**
   * Summarize a URL (internal implementation)
   */
  async summarizeUrl(
    url: string,
    options?: SummarizeOptions
  ): Promise<string> {
    const notice = new Notice("Extracting content...", 0);

    try {
      // Extract content from URL
      const extracted = await this.contentExtractor.extractFromUrl(url);
      notice.setMessage(`Summarizing ${extracted.wordCount} words...`);

      // Summarize the content
      const response = await this.llmService.summarize(extracted.content, {
        length: options?.length,
        language: options?.language,
        model: options?.model,
        onStream: options?.onStream,
      });

      notice.hide();
      new Notice("Summary complete!");

      // Insert the summary if we have an active editor
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view && !options?.onStream) {
        this.insertSummary(view.editor, response.content, extracted.title, url);
      }

      return response.content;
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Failed to summarize: ${message}`);
      throw error;
    }
  }

  /**
   * Summarize text content (internal implementation)
   */
  async summarizeText(
    content: string,
    editor?: Editor,
    options?: SummarizeOptions
  ): Promise<string> {
    const notice = new Notice("Summarizing...", 0);

    try {
      const response = await this.llmService.summarize(content, {
        length: options?.length,
        language: options?.language,
        model: options?.model,
        onStream: options?.onStream,
      });

      notice.hide();
      new Notice("Summary complete!");

      // Insert the summary if we have an editor
      if (editor && !options?.onStream) {
        this.insertSummary(editor, response.content);
      }

      return response.content;
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Failed to summarize: ${message}`);
      throw error;
    }
  }

  /**
   * Insert summary into the editor based on settings
   */
  private insertSummary(
    editor: Editor,
    summary: string,
    title?: string,
    url?: string
  ): void {
    const formattedSummary = this.formatSummary(summary, title, url);

    switch (this.settings.insertBehavior) {
      case "replace":
        editor.replaceSelection(formattedSummary);
        break;

      case "clipboard":
        navigator.clipboard.writeText(formattedSummary);
        new Notice("Summary copied to clipboard!");
        break;

      case "below":
      default: {
        // Get the end of the selection (or cursor if no selection)
        const selection = editor.getSelection();
        const cursor = selection ? editor.getCursor("to") : editor.getCursor();
        const line = editor.getLine(cursor.line);
        const insertPos = { line: cursor.line, ch: line.length };

        // Detect indentation of current line
        const indentMatch = line.match(/^(\s*)/);
        const baseIndent = indentMatch ? indentMatch[1] : "";

        // Check if we're in a list item - if so, indent the summary as a sub-item
        const isListItem = /^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line);
        const summaryIndent = isListItem ? baseIndent + "\t" : baseIndent;

        // Indent each non-empty line of the summary
        const indentedSummary = formattedSummary
          .split("\n")
          .map((l) => (l.trim() ? summaryIndent + l : ""))
          .filter((l, i, arr) => {
            // Remove consecutive empty lines
            if (!l && i > 0 && !arr[i - 1]) return false;
            return true;
          })
          .join("\n");

        // Single newline before summary
        editor.replaceRange("\n" + indentedSummary, insertPos);
        break;
      }
    }
  }

  /**
   * Format the summary for insertion
   */
  private formatSummary(summary: string, title?: string, url?: string): string {
    // Just return the summary - no metadata as per spec
    return summary.trim();
  }

  /**
   * Prompt user for URL input
   */
  private promptForUrl(): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new UrlInputModal(this.app, (url) => {
        resolve(url);
      });
      modal.open();
    });
  }
}

/**
 * Modal for URL input
 */
class UrlInputModal extends Modal {
  private onSubmit: (url: string | null) => void;
  private url: string = "";

  constructor(app: App, onSubmit: (url: string | null) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Summarize URL" });

    new Setting(contentEl)
      .setName("URL")
      .setDesc("Enter the URL to summarize")
      .addText((text) => {
        text
          .setPlaceholder("https://example.com/article")
          .onChange((value) => {
            this.url = value;
          });

        // Focus the input
        setTimeout(() => text.inputEl.focus(), 10);

        // Submit on Enter
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            this.submit();
          }
        });
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Summarize")
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
          this.onSubmit(null);
        })
      );
  }

  private submit(): void {
    const url = this.url.trim();
    if (!url) {
      new Notice("Please enter a URL");
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      new Notice("Please enter a valid URL");
      return;
    }

    this.close();
    this.onSubmit(url);
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

import { App, Editor, MarkdownView, Notice, Modal, Setting, EditorPosition } from "obsidian";
import { ContentExtractor } from "../services/content-extractor";
import { LLMService } from "../services/llm-service";
import { SummarizeSettings, SummarizeOptions, SummaryLength } from "../types";

interface StreamingInsertContext {
  editor: Editor;
  insertPos: EditorPosition;
  indent: string;
  abortController: AbortController;
  cleanup: () => void;
  currentContent: string;
}

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
   * Setup streaming insertion context
   * Calculates insertion position below the current line, with proper indentation
   */
  private setupStreamingInsert(editor: Editor): StreamingInsertContext {
    const selection = editor.getSelection();
    const cursor = selection ? editor.getCursor("to") : editor.getCursor();
    const line = editor.getLine(cursor.line);
    const insertPos = { line: cursor.line, ch: line.length };

    // Detect indentation of current line
    const indentMatch = line.match(/^(\s*)/);
    const baseIndent = indentMatch ? indentMatch[1] : "";

    // Check if we're in a list item - if so, indent the summary as a sub-item
    const isListItem = /^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line);
    const indent = isListItem ? baseIndent + "\t" : baseIndent;

    const abortController = new AbortController();

    // Setup Escape key handler
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        abortController.abort();
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", escapeHandler, true);

    const cleanup = () => {
      document.removeEventListener("keydown", escapeHandler, true);
    };

    // Insert initial newline
    editor.replaceRange("\n", insertPos);

    return {
      editor,
      insertPos: { line: insertPos.line + 1, ch: 0 },
      indent,
      abortController,
      cleanup,
      currentContent: "",
    };
  }

  /**
   * Handle a streaming chunk - append to document
   */
  private handleStreamChunk(ctx: StreamingInsertContext, chunk: string): void {
    // Apply indentation to new lines in the chunk
    const processedChunk = chunk.replace(/\n/g, "\n" + ctx.indent);

    // Calculate current end position
    const lines = ctx.currentContent.split("\n");
    const lastLineIndex = lines.length - 1;
    const endPos: EditorPosition = {
      line: ctx.insertPos.line + lastLineIndex,
      ch: lastLineIndex === 0
        ? ctx.indent.length + lines[lastLineIndex].length
        : lines[lastLineIndex].length,
    };

    // For the first chunk, add indent prefix
    const textToInsert = ctx.currentContent === ""
      ? ctx.indent + processedChunk
      : processedChunk;

    ctx.editor.replaceRange(textToInsert, endPos);
    ctx.currentContent += chunk;
  }

  /**
   * Execute summarization with streaming insertion
   */
  private async executeStreamingSummarize(
    content: string,
    editor: Editor,
    options?: { length?: SummaryLength; model?: string }
  ): Promise<{ content: string; cancelled: boolean }> {
    const ctx = this.setupStreamingInsert(editor);
    let cancelled = false;

    try {
      const response = await this.llmService.summarize(content, {
        length: options?.length || this.settings.defaultLength,
        model: options?.model,
        onStream: (chunk) => this.handleStreamChunk(ctx, chunk),
        abortSignal: ctx.abortController.signal,
      });

      return { content: response.content, cancelled: false };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        cancelled = true;
        new Notice("Summarization cancelled");
        return { content: ctx.currentContent, cancelled: true };
      }
      throw error;
    } finally {
      ctx.cleanup();
    }
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
    editor: Editor,
    stream: boolean = true
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

      notice.hide();

      if (stream) {
        const result = await this.executeStreamingSummarize(combinedContent, editor);
        if (!result.cancelled) {
          new Notice("Summary complete!");
        }
      } else {
        const notice2 = new Notice("Summarizing...", 0);
        const response = await this.llmService.summarize(combinedContent, {
          length: this.settings.defaultLength,
        });
        notice2.hide();
        new Notice("Summary complete!");
        this.insertSummary(editor, response.content);
      }
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
   * @param url - URL to summarize
   * @param options - Summarization options
   * @param stream - Whether to stream directly into document (default: true)
   */
  async summarizeUrl(
    url: string,
    options?: SummarizeOptions,
    stream: boolean = true
  ): Promise<string> {
    const notice = new Notice("Extracting content...", 0);

    try {
      // Extract content from URL
      const extracted = await this.contentExtractor.extractFromUrl(url);

      // Get active editor for streaming
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const editor = view?.editor;

      // Use streaming if enabled and we have an editor (and no custom onStream callback)
      if (stream && editor && !options?.onStream) {
        notice.setMessage(`Streaming ${extracted.wordCount} words...`);
        notice.hide();

        const result = await this.executeStreamingSummarize(extracted.content, editor, {
          length: options?.length,
          model: options?.model,
        });

        if (!result.cancelled) {
          new Notice("Summary complete!");
        }
        return result.content;
      }

      // Non-streaming path
      notice.setMessage(`Summarizing ${extracted.wordCount} words...`);

      const response = await this.llmService.summarize(extracted.content, {
        length: options?.length,
        model: options?.model,
        onStream: options?.onStream,
      });

      notice.hide();
      new Notice("Summary complete!");

      // Insert the summary if we have an active editor and no custom stream handler
      if (editor && !options?.onStream) {
        this.insertSummary(editor, response.content, extracted.title, url);
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
   * @param content - Text content to summarize
   * @param editor - Editor instance for insertion
   * @param options - Summarization options
   * @param stream - Whether to stream directly into document (default: true)
   */
  async summarizeText(
    content: string,
    editor?: Editor,
    options?: SummarizeOptions,
    stream: boolean = true
  ): Promise<string> {
    // Use streaming if enabled and we have an editor (and no custom onStream callback)
    if (stream && editor && !options?.onStream) {
      const result = await this.executeStreamingSummarize(content, editor, {
        length: options?.length,
        model: options?.model,
      });

      if (!result.cancelled) {
        new Notice("Summary complete!");
      }
      return result.content;
    }

    // Non-streaming path
    const notice = new Notice("Summarizing...", 0);

    try {
      const response = await this.llmService.summarize(content, {
        length: options?.length,
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

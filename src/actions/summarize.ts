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
    const selection = editor.getSelection();

    if (!selection.trim()) {
      new Notice("No text selected.");
      return;
    }

    await this.summarizeText(selection, editor);
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
      default:
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const insertPos = { line: cursor.line, ch: line.length };

        editor.replaceRange("\n\n" + formattedSummary, insertPos);
        break;
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

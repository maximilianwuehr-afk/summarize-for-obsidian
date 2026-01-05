import { Plugin, Editor, MarkdownView, Menu, Notice } from "obsidian";
import {
  SummarizeSettings,
  SummarizeAPI,
  SummarizeOptions,
  DEFAULT_SETTINGS,
} from "./types";
import { ContentExtractor } from "./services/content-extractor";
import { LLMService } from "./services/llm-service";
import { SummarizeAction } from "./actions/summarize";
import { SummarizeSettingTab } from "./settings";

export default class SummarizePlugin extends Plugin {
  settings!: SummarizeSettings;
  llmService!: LLMService;

  private contentExtractor!: ContentExtractor;
  private summarizeAction!: SummarizeAction;

  /**
   * Public API for other plugins to use
   */
  api!: SummarizeAPI;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize services
    this.contentExtractor = new ContentExtractor();
    this.llmService = new LLMService(this.settings);
    this.summarizeAction = new SummarizeAction(
      this.app,
      this.settings,
      this.contentExtractor,
      this.llmService
    );

    // Initialize public API
    this.api = this.createAPI();

    // Register commands
    this.addCommand({
      id: "summarize-url",
      name: "Summarize URL",
      callback: () => this.summarizeAction.summarizeUrlCommand(),
    });

    this.addCommand({
      id: "summarize-selection",
      name: "Summarize selection",
      editorCallback: () => this.summarizeAction.summarizeSelectionCommand(),
    });

    this.addCommand({
      id: "summarize-note",
      name: "Summarize current note",
      editorCallback: () => this.summarizeAction.summarizeNoteCommand(),
    });

    // Add settings tab
    this.addSettingTab(new SummarizeSettingTab(this.app, this));

    // Register right-click context menu for links
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const url = this.getUrlAtCursor(editor);
        if (url) {
          menu.addItem((item) => {
            item
              .setTitle("Summarize this link")
              .setIcon("file-text")
              .onClick(async () => {
                await this.summarizeLinkAtCursor(editor, url);
              });
          });
        }
      })
    );

    console.log("[Summarize] Plugin loaded");
  }

  onunload(): void {
    console.log("[Summarize] Plugin unloaded");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    // Update services with new settings
    this.llmService.updateSettings(this.settings);
    this.summarizeAction.updateSettings(this.settings);
  }

  /**
   * Create the public API for other plugins
   */
  private createAPI(): SummarizeAPI {
    return {
      summarize: async (
        content: string,
        options?: SummarizeOptions
      ): Promise<string> => {
        if (!this.llmService.isConfigured()) {
          throw new Error("Summarize plugin is not configured. Please add an OpenRouter API key.");
        }

        const response = await this.llmService.summarize(content, {
          length: options?.length,
          language: options?.language,
          model: options?.model,
          prompt: options?.prompt,
          onStream: options?.onStream,
        });

        return response.content;
      },

      summarizeUrl: async (
        url: string,
        options?: SummarizeOptions
      ): Promise<string> => {
        if (!this.llmService.isConfigured()) {
          throw new Error("Summarize plugin is not configured. Please add an OpenRouter API key.");
        }

        const extracted = await this.contentExtractor.extractFromUrl(url);

        const response = await this.llmService.summarize(extracted.content, {
          length: options?.length,
          language: options?.language,
          model: options?.model,
          prompt: options?.prompt,
          onStream: options?.onStream,
        });

        return response.content;
      },

      isConfigured: (): boolean => {
        return this.llmService.isConfigured();
      },
    };
  }

  /**
   * Extract URL at the current cursor position
   * Supports: markdown links [text](url), bare URLs, and wikilinks to external URLs
   */
  private getUrlAtCursor(editor: Editor): string | null {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    // Pattern for markdown links: [text](url)
    const mdLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = mdLinkRegex.exec(line)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (cursor.ch >= start && cursor.ch <= end) {
        const url = match[2];
        if (this.isValidUrl(url)) {
          return url;
        }
      }
    }

    // Pattern for bare URLs
    const urlRegex = /https?:\/\/[^\s<>"\]]+/g;
    while ((match = urlRegex.exec(line)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (cursor.ch >= start && cursor.ch <= end) {
        return match[0];
      }
    }

    return null;
  }

  /**
   * Check if a string is a valid HTTP(S) URL
   */
  private isValidUrl(str: string): boolean {
    try {
      const url = new URL(str);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  /**
   * Summarize a link and insert the summary below
   */
  private async summarizeLinkAtCursor(editor: Editor, url: string): Promise<void> {
    if (!this.llmService.isConfigured()) {
      new Notice("Please configure your OpenRouter API key in settings.");
      return;
    }

    const notice = new Notice("Extracting content...", 0);

    try {
      const extracted = await this.contentExtractor.extractFromUrl(url);
      notice.setMessage(`Summarizing ${extracted.wordCount} words...`);

      const response = await this.llmService.summarize(extracted.content, {
        length: this.settings.defaultLength,
        language: this.settings.outputLanguage,
      });

      notice.hide();

      // Insert summary below the current line
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      const insertPos = { line: cursor.line, ch: line.length };
      editor.replaceRange("\n\n" + response.content.trim(), insertPos);

      new Notice("Summary inserted!");
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Failed to summarize: ${message}`);
    }
  }
}

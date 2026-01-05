import { Plugin } from "obsidian";
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
          onStream: options?.onStream,
        });

        return response.content;
      },

      isConfigured: (): boolean => {
        return this.llmService.isConfigured();
      },
    };
  }
}

import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type SummarizePlugin from "./main";
import { SummarizeSettings, OpenRouterModel, SummaryLength, InsertBehavior } from "./types";

type SettingsTabId = "general" | "models";

export class SummarizeSettingTab extends PluginSettingTab {
  plugin: SummarizePlugin;
  private activeTab: SettingsTabId = "general";
  private searchFilter: string = "";
  private freeOnly: boolean = false;

  constructor(app: App, plugin: SummarizePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Add custom styles
    this.addStyles();

    // Tab navigation
    const tabs: { id: SettingsTabId; label: string }[] = [
      { id: "general", label: "General" },
      { id: "models", label: "Models" },
    ];

    const nav = containerEl.createDiv({ cls: "summarize-nav" });
    for (const tab of tabs) {
      const btn = nav.createEl("button", {
        text: tab.label,
        cls: `summarize-nav-btn ${this.activeTab === tab.id ? "is-active" : ""}`,
      });
      btn.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.display();
      });
    }

    const content = containerEl.createDiv({ cls: "summarize-content" });

    switch (this.activeTab) {
      case "general":
        this.renderGeneralTab(content);
        break;
      case "models":
        this.renderModelsTab(content);
        break;
    }
  }

  private addStyles(): void {
    const styleId = "summarize-settings-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .summarize-nav {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--background-modifier-border);
        padding-bottom: 8px;
      }
      .summarize-nav-btn {
        background: none;
        border: none;
        padding: 8px 16px;
        cursor: pointer;
        border-radius: 4px;
      }
      .summarize-nav-btn:hover {
        background: var(--background-modifier-hover);
      }
      .summarize-nav-btn.is-active {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
      }
      .summarize-toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        align-items: center;
      }
      .summarize-toolbar input[type="text"] {
        flex: 1;
      }
      .summarize-meta {
        font-size: 0.85em;
        color: var(--text-muted);
      }
      .summarize-models {
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
      }
      .summarize-model-row {
        padding: 12px;
        border-bottom: 1px solid var(--background-modifier-border);
      }
      .summarize-model-row:last-child {
        border-bottom: none;
      }
      .summarize-model-row.is-selected {
        background: var(--background-secondary);
      }
      .summarize-model-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .summarize-model-title {
        font-weight: 500;
      }
      .summarize-model-id {
        font-size: 0.85em;
        color: var(--text-muted);
        font-family: monospace;
      }
      .summarize-model-details {
        display: flex;
        gap: 16px;
        margin-top: 4px;
        font-size: 0.85em;
        color: var(--text-muted);
      }
    `;
    document.head.appendChild(style);
  }

  private renderGeneralTab(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "API Configuration" });

    new Setting(containerEl)
      .setName("OpenRouter API Key")
      .setDesc("Get your API key from openrouter.ai")
      .addText((text) =>
        text
          .setPlaceholder("sk-or-...")
          .setValue(this.plugin.settings.openRouterApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openRouterApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Default Settings" });

    new Setting(containerEl)
      .setName("Default Model")
      .setDesc("Model to use for summarization (use model ID from Models tab)")
      .addText((text) =>
        text
          .setPlaceholder("google/gemini-2.0-flash-exp:free")
          .setValue(this.plugin.settings.defaultModel)
          .onChange(async (value) => {
            this.plugin.settings.defaultModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default Summary Length")
      .setDesc("How long summaries should be by default")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("short", "Short (~100 words)")
          .addOption("medium", "Medium (~250 words)")
          .addOption("long", "Long (~500 words)")
          .setValue(this.plugin.settings.defaultLength)
          .onChange(async (value) => {
            this.plugin.settings.defaultLength = value as SummaryLength;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Output Language")
      .setDesc("Leave empty to auto-detect from source content")
      .addText((text) =>
        text
          .setPlaceholder("en, de, fr, etc.")
          .setValue(this.plugin.settings.outputLanguage)
          .onChange(async (value) => {
            this.plugin.settings.outputLanguage = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Insert Behavior")
      .setDesc("How to insert the summary into your note")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("below", "Insert below cursor")
          .addOption("replace", "Replace selection")
          .addOption("clipboard", "Copy to clipboard")
          .setValue(this.plugin.settings.insertBehavior)
          .onChange(async (value) => {
            this.plugin.settings.insertBehavior = value as InsertBehavior;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderModelsTab(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Browse OpenRouter models. Click a model ID to copy it for use in settings.",
      cls: "setting-item-description",
    });

    if (!this.plugin.settings.openRouterApiKey) {
      containerEl.createEl("p", {
        text: "Add an OpenRouter API key in the General tab to browse models.",
        cls: "summarize-meta",
      });
      return;
    }

    // Toolbar
    const toolbar = containerEl.createDiv({ cls: "summarize-toolbar" });

    const refreshBtn = toolbar.createEl("button", { text: "Refresh Models" });
    refreshBtn.addEventListener("click", async () => {
      await this.fetchModels(true);
      this.display();
    });

    const lastFetched = this.plugin.settings.openRouter.lastFetched;
    const lastFetchedText = lastFetched
      ? `Last updated: ${new Date(lastFetched).toLocaleDateString()}`
      : "Never fetched";
    toolbar.createEl("span", { text: lastFetchedText, cls: "summarize-meta" });

    // Filters
    const filters = containerEl.createDiv({ cls: "summarize-toolbar" });

    const searchInput = filters.createEl("input", {
      type: "text",
      placeholder: "Search models...",
    });
    searchInput.value = this.searchFilter;
    searchInput.addEventListener("input", (e) => {
      this.searchFilter = (e.target as HTMLInputElement).value;
      this.renderModelList(containerEl);
    });

    const freeCheckbox = filters.createEl("label");
    const checkbox = freeCheckbox.createEl("input", { type: "checkbox" });
    checkbox.checked = this.freeOnly;
    checkbox.addEventListener("change", () => {
      this.freeOnly = checkbox.checked;
      this.renderModelList(containerEl);
    });
    freeCheckbox.appendText(" Free only");

    // Model list container
    containerEl.createDiv({ cls: "summarize-models", attr: { id: "model-list" } });
    this.renderModelList(containerEl);
  }

  private renderModelList(containerEl: HTMLElement): void {
    const listEl = containerEl.querySelector("#model-list") as HTMLElement;
    if (!listEl) return;

    listEl.empty();

    let models = this.plugin.settings.openRouter.models;

    // Apply filters
    if (this.searchFilter) {
      const search = this.searchFilter.toLowerCase();
      models = models.filter(
        (m) =>
          m.id.toLowerCase().includes(search) ||
          m.name.toLowerCase().includes(search)
      );
    }

    if (this.freeOnly) {
      models = models.filter((m) => this.isModelFree(m));
    }

    // Sort: free first, then by name
    models.sort((a, b) => {
      const aFree = this.isModelFree(a);
      const bFree = this.isModelFree(b);
      if (aFree && !bFree) return -1;
      if (!aFree && bFree) return 1;
      return a.name.localeCompare(b.name);
    });

    if (models.length === 0) {
      listEl.createEl("p", {
        text: this.plugin.settings.openRouter.models.length === 0
          ? "Click 'Refresh Models' to load available models."
          : "No models match your filters.",
        cls: "summarize-meta",
      });
      return;
    }

    for (const model of models) {
      const isDefault = model.id === this.plugin.settings.defaultModel;
      const row = listEl.createDiv({
        cls: `summarize-model-row ${isDefault ? "is-selected" : ""}`,
      });

      const header = row.createDiv({ cls: "summarize-model-header" });

      const titleWrap = header.createDiv();
      titleWrap.createDiv({ text: model.name, cls: "summarize-model-title" });

      const idEl = titleWrap.createDiv({ text: model.id, cls: "summarize-model-id" });
      idEl.style.cursor = "pointer";
      idEl.addEventListener("click", () => {
        navigator.clipboard.writeText(model.id);
        new Notice(`Copied: ${model.id}`);
      });

      const useBtn = header.createEl("button", {
        text: isDefault ? "Current" : "Use",
      });
      if (isDefault) {
        useBtn.disabled = true;
      } else {
        useBtn.addEventListener("click", async () => {
          this.plugin.settings.defaultModel = model.id;
          await this.plugin.saveSettings();
          this.renderModelList(containerEl);
          new Notice(`Default model set to: ${model.id}`);
        });
      }

      const details = row.createDiv({ cls: "summarize-model-details" });
      details.createSpan({ text: `Context: ${model.context_length.toLocaleString()}` });
      details.createSpan({ text: `Cost: ${this.formatPricing(model)}` });
    }
  }

  private async fetchModels(force: boolean): Promise<void> {
    if (!force && this.plugin.settings.openRouter.models.length > 0) {
      return;
    }

    const notice = new Notice("Fetching models...", 0);

    try {
      const models = await this.plugin.llmService.fetchModels();
      this.plugin.settings.openRouter.models = models;
      this.plugin.settings.openRouter.lastFetched = new Date().toISOString();
      await this.plugin.saveSettings();
      notice.hide();
      new Notice(`Loaded ${models.length} models`);
    } catch (error) {
      notice.hide();
      new Notice("Failed to fetch models");
      console.error("[Summarize] Failed to fetch models:", error);
    }
  }

  private isModelFree(model: OpenRouterModel): boolean {
    return model.pricing?.prompt === 0 && model.pricing?.completion === 0;
  }

  private formatPricing(model: OpenRouterModel): string {
    if (this.isModelFree(model)) {
      return "Free";
    }
    const prompt = (model.pricing?.prompt || 0) * 1000000;
    const completion = (model.pricing?.completion || 0) * 1000000;
    return `$${prompt.toFixed(2)}/$${completion.toFixed(2)} per 1M`;
  }
}

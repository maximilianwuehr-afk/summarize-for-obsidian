import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type SummarizePlugin from "./main";
import { SummarizeSettings, OpenRouterModel, SummaryLength, InsertBehavior } from "./types";

type SettingsTabId = "general" | "models" | "freerank";

export class SummarizeSettingTab extends PluginSettingTab {
  plugin: SummarizePlugin;
  private activeTab: SettingsTabId = "general";

  // Filter state
  private searchFilter: string = "";
  private providerFilter: string = "all";
  private freeOnly: boolean = false;
  private selectedOnly: boolean = false;

  constructor(app: App, plugin: SummarizePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.addStyles();

    // Tab navigation
    const tabs: { id: SettingsTabId; label: string }[] = [
      { id: "general", label: "General" },
      { id: "models", label: "Models" },
      { id: "freerank", label: "Free Rank" },
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
      case "freerank":
        this.renderFreeRankTab(content);
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
        flex-wrap: wrap;
      }
      .summarize-toolbar input[type="text"] {
        flex: 1;
        min-width: 150px;
      }
      .summarize-toolbar select {
        min-width: 120px;
      }
      .summarize-toolbar label {
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
      }
      .summarize-meta {
        font-size: 0.85em;
        color: var(--text-muted);
      }
      .summarize-models {
        max-height: 500px;
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
        align-items: flex-start;
        gap: 8px;
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
        flex-wrap: wrap;
      }
      .summarize-model-actions {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .summarize-model-actions button {
        font-size: 0.85em;
        padding: 4px 8px;
      }
      .summarize-rank-list {
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        min-height: 100px;
      }
      .summarize-rank-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        cursor: grab;
      }
      .summarize-rank-item:last-child {
        border-bottom: none;
      }
      .summarize-rank-item.is-dragging {
        opacity: 0.5;
      }
      .summarize-rank-item.is-drop-target {
        background: var(--background-secondary);
        border-top: 2px solid var(--interactive-accent);
      }
      .summarize-rank-handle {
        margin-right: 8px;
        color: var(--text-muted);
        cursor: grab;
      }
      .summarize-rank-number {
        font-weight: bold;
        margin-right: 8px;
        color: var(--text-muted);
        min-width: 20px;
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
      .setDesc(
        'Model to use for summarization. Use "auto-free" to automatically use the highest-ranked free model.'
      )
      .addText((text) =>
        text
          .setPlaceholder("auto-free or google/gemini-2.0-flash-exp:free")
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
      text: "Browse and select OpenRouter models. Use the 'Use' button to set as default, or select free models to add to the Free Rank.",
      cls: "setting-item-description",
    });

    if (!this.plugin.settings.openRouterApiKey) {
      containerEl.createEl("p", {
        text: "Add an OpenRouter API key in the General tab to browse models.",
        cls: "summarize-meta",
      });
      return;
    }

    // Toolbar with refresh button
    const toolbar = containerEl.createDiv({ cls: "summarize-toolbar" });

    const refreshBtn = toolbar.createEl("button", { text: "Refresh models" });
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      await this.fetchModels(true);
      this.display();
    });

    const lastFetched = this.plugin.settings.openRouter.lastFetched;
    const lastFetchedText = lastFetched
      ? `Last sync: ${new Date(lastFetched).toLocaleString()}`
      : "No model cache yet";
    toolbar.createEl("span", { text: lastFetchedText, cls: "summarize-meta" });

    const models = this.plugin.settings.openRouter.models;
    if (!models.length) {
      containerEl.createEl("p", {
        text: "No models cached yet. Click 'Refresh models' to load the latest list.",
        cls: "summarize-meta",
      });
      return;
    }

    // Get unique providers
    const providers = Array.from(
      new Set(models.map((m) => this.getProvider(m)))
    ).sort((a, b) => a.localeCompare(b));

    // Validate provider filter
    if (this.providerFilter !== "all" && !providers.includes(this.providerFilter)) {
      this.providerFilter = "all";
    }

    // Filters row
    const filters = containerEl.createDiv({ cls: "summarize-toolbar" });

    // Search input
    const searchInput = filters.createEl("input", {
      type: "text",
      placeholder: "Search models...",
    });
    searchInput.value = this.searchFilter;
    searchInput.addEventListener("input", () => {
      this.searchFilter = searchInput.value;
      this.display();
    });

    // Provider dropdown
    const providerSelect = filters.createEl("select");
    providerSelect.createEl("option", { text: "All providers", value: "all" });
    providers.forEach((provider) => {
      providerSelect.createEl("option", { text: provider, value: provider });
    });
    providerSelect.value = this.providerFilter;
    providerSelect.addEventListener("change", () => {
      this.providerFilter = providerSelect.value;
      this.display();
    });

    // Free only toggle
    const freeLabel = filters.createEl("label");
    const freeCheckbox = freeLabel.createEl("input", { type: "checkbox" });
    freeCheckbox.checked = this.freeOnly;
    freeCheckbox.addEventListener("change", () => {
      this.freeOnly = freeCheckbox.checked;
      this.display();
    });
    freeLabel.appendText(" Free only");

    // Selected only toggle
    const selectedLabel = filters.createEl("label");
    const selectedCheckbox = selectedLabel.createEl("input", { type: "checkbox" });
    selectedCheckbox.checked = this.selectedOnly;
    selectedCheckbox.addEventListener("change", () => {
      this.selectedOnly = selectedCheckbox.checked;
      this.display();
    });
    selectedLabel.appendText(" Selected only");

    // Filter models
    const selectedSet = new Set(
      this.plugin.settings.openRouter.selectedModels.map((id) => id.toLowerCase())
    );

    let filtered = models;

    // Apply search filter
    if (this.searchFilter) {
      const search = this.searchFilter.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.id.toLowerCase().includes(search) ||
          m.name.toLowerCase().includes(search)
      );
    }

    // Apply provider filter
    if (this.providerFilter !== "all") {
      filtered = filtered.filter((m) => this.getProvider(m) === this.providerFilter);
    }

    // Apply free only filter
    if (this.freeOnly) {
      filtered = filtered.filter((m) => this.isModelFree(m));
    }

    // Apply selected only filter
    if (this.selectedOnly) {
      filtered = filtered.filter((m) => selectedSet.has(m.id.toLowerCase()));
    }

    // Sort: free first, then by name
    filtered.sort((a, b) => {
      const aFree = this.isModelFree(a);
      const bFree = this.isModelFree(b);
      if (aFree && !bFree) return -1;
      if (!aFree && bFree) return 1;
      return a.name.localeCompare(b.name);
    });

    // Show count
    containerEl.createEl("p", {
      text: `Showing ${filtered.length} of ${models.length} models.`,
      cls: "summarize-meta",
    });

    // Model list
    const list = containerEl.createDiv({ cls: "summarize-models" });

    if (filtered.length === 0) {
      list.createEl("p", {
        text: "No models match your filters.",
        cls: "summarize-meta",
      });
      list.style.padding = "12px";
      return;
    }

    const rankSet = new Set(this.plugin.settings.openRouter.freeModelRank);

    for (const model of filtered) {
      const isSelected = selectedSet.has(model.id.toLowerCase());
      const isDefault = model.id === this.plugin.settings.defaultModel;
      const isFree = this.isModelFree(model);
      const isRanked = rankSet.has(model.id);

      const row = list.createDiv({
        cls: `summarize-model-row${isSelected ? " is-selected" : ""}`,
      });

      const header = row.createDiv({ cls: "summarize-model-header" });

      // Title and ID
      const titleWrap = header.createDiv();
      titleWrap.createDiv({ text: model.name || model.id, cls: "summarize-model-title" });
      titleWrap.createDiv({ text: model.id, cls: "summarize-model-id" });

      // Actions
      const actions = header.createDiv({ cls: "summarize-model-actions" });

      // Select checkbox
      const selectBox = actions.createEl("input", { type: "checkbox" });
      selectBox.checked = isSelected;
      selectBox.addEventListener("change", async () => {
        this.toggleSelection(model.id, selectBox.checked);
        await this.plugin.saveSettings();
        this.display();
      });

      // Copy ID button
      const copyBtn = actions.createEl("button", { text: "Copy ID" });
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(model.id);
        new Notice(`Copied: ${model.id}`);
      });

      // Add to rank button (only for free models)
      if (isFree && !isRanked) {
        const rankBtn = actions.createEl("button", { text: "Add to Rank" });
        rankBtn.addEventListener("click", async () => {
          this.addToFreeRank(model.id);
          await this.plugin.saveSettings();
          this.display();
          new Notice(`Added to free rank: ${model.name}`);
        });
      }

      // Use as default button
      const useBtn = actions.createEl("button", {
        text: isDefault ? "Current" : "Use",
      });
      if (isDefault) {
        useBtn.disabled = true;
      } else {
        useBtn.addEventListener("click", async () => {
          this.plugin.settings.defaultModel = model.id;
          await this.plugin.saveSettings();
          this.display();
          new Notice(`Default model set to: ${model.id}`);
        });
      }

      // Details row
      const details = row.createDiv({ cls: "summarize-model-details" });
      details.createSpan({ text: `Provider: ${this.getProvider(model)}` });
      details.createSpan({ text: `Context: ${model.context_length.toLocaleString()} tokens` });
      details.createSpan({ text: `Cost: ${this.formatPricing(model)}` });
      if (isRanked) {
        const rankPos = this.plugin.settings.openRouter.freeModelRank.indexOf(model.id) + 1;
        details.createSpan({ text: `Rank: #${rankPos}` });
      }
    }
  }

  private renderFreeRankTab(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Free Model Fallback" });

    containerEl.createEl("p", {
      text: 'Set the priority order for free models. Use "auto-free" as your default model to automatically use the highest-ranked model that is not rate limited.',
      cls: "setting-item-description",
    });

    containerEl.createEl("p", {
      text: 'Tip: Set your default model to "auto-free" in the General tab.',
      cls: "summarize-meta",
    });

    const models = this.plugin.settings.openRouter.models;
    const modelsById = new Map(models.map((m) => [m.id, m]));

    // Toolbar
    const toolbar = containerEl.createDiv({ cls: "summarize-toolbar" });

    const seedBtn = toolbar.createEl("button", { text: "Seed from selected free models" });
    seedBtn.addEventListener("click", async () => {
      const selectedFree = this.plugin.settings.openRouter.selectedModels.filter((id) => {
        const model = modelsById.get(id);
        return model ? this.isModelFree(model) : false;
      });
      this.plugin.settings.openRouter.freeModelRank = Array.from(new Set(selectedFree));
      await this.plugin.saveSettings();
      this.display();
      new Notice(`Seeded ${selectedFree.length} free models`);
    });

    const clearBtn = toolbar.createEl("button", { text: "Clear ranking" });
    clearBtn.addEventListener("click", async () => {
      this.plugin.settings.openRouter.freeModelRank = [];
      await this.plugin.saveSettings();
      this.display();
      new Notice("Ranking cleared");
    });

    const useAutoFreeBtn = toolbar.createEl("button", { text: 'Set default to "auto-free"' });
    useAutoFreeBtn.addEventListener("click", async () => {
      this.plugin.settings.defaultModel = "auto-free";
      await this.plugin.saveSettings();
      new Notice('Default model set to "auto-free"');
    });

    // Rank list
    const rankList = containerEl.createDiv({ cls: "summarize-rank-list" });
    let dragId: string | null = null;

    const renderList = () => {
      rankList.empty();
      const ranked = this.plugin.settings.openRouter.freeModelRank;

      if (ranked.length === 0) {
        const emptyMsg = rankList.createEl("p", {
          text: "No ranked models yet. Add free models from the Models tab, or click 'Seed from selected free models'.",
          cls: "summarize-meta",
        });
        emptyMsg.style.padding = "16px";
        return;
      }

      ranked.forEach((modelId, index) => {
        const model = modelsById.get(modelId);
        const row = rankList.createDiv({ cls: "summarize-rank-item" });
        row.setAttribute("draggable", "true");

        const labelWrap = row.createDiv({ cls: "summarize-model-header" });
        const left = labelWrap.createDiv();

        // Rank number and handle
        const rankNum = left.createSpan({ text: `${index + 1}.`, cls: "summarize-rank-number" });
        left.createSpan({ text: "⋮⋮", cls: "summarize-rank-handle" });

        // Model name and ID
        left.createSpan({ text: model?.name || modelId });
        left.createEl("div", { text: modelId, cls: "summarize-model-id" });

        // Remove button
        const removeBtn = row.createEl("button", { text: "Remove" });
        removeBtn.addEventListener("click", async () => {
          this.plugin.settings.openRouter.freeModelRank =
            this.plugin.settings.openRouter.freeModelRank.filter((id) => id !== modelId);
          await this.plugin.saveSettings();
          renderList();
        });

        // Drag events
        row.addEventListener("dragstart", () => {
          dragId = modelId;
          row.addClass("is-dragging");
        });

        row.addEventListener("dragend", () => {
          dragId = null;
          row.removeClass("is-dragging");
        });

        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          row.addClass("is-drop-target");
        });

        row.addEventListener("dragleave", () => {
          row.removeClass("is-drop-target");
        });

        row.addEventListener("drop", async (e) => {
          e.preventDefault();
          row.removeClass("is-drop-target");
          if (!dragId || dragId === modelId) return;

          const current = [...this.plugin.settings.openRouter.freeModelRank];
          const fromIndex = current.indexOf(dragId);
          const toIndex = current.indexOf(modelId);
          if (fromIndex === -1 || toIndex === -1) return;

          current.splice(fromIndex, 1);
          current.splice(toIndex, 0, dragId);
          this.plugin.settings.openRouter.freeModelRank = current;
          await this.plugin.saveSettings();
          renderList();
        });
      });
    };

    renderList();
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

  private getProvider(model: OpenRouterModel): string {
    const parts = model.id.split("/");
    return parts.length > 1 ? parts[0] : "unknown";
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

  private toggleSelection(modelId: string, selected: boolean): void {
    const existing = this.plugin.settings.openRouter.selectedModels;
    if (selected) {
      if (!existing.includes(modelId)) {
        this.plugin.settings.openRouter.selectedModels = [...existing, modelId];
      }
    } else {
      this.plugin.settings.openRouter.selectedModels = existing.filter(
        (id) => id.toLowerCase() !== modelId.toLowerCase()
      );
    }
  }

  private addToFreeRank(modelId: string): void {
    const rank = this.plugin.settings.openRouter.freeModelRank;
    if (!rank.includes(modelId)) {
      this.plugin.settings.openRouter.freeModelRank = [...rank, modelId];
    }
    // Also select it
    this.toggleSelection(modelId, true);
  }
}

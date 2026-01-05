import { App, PluginSettingTab, Setting, Notice, requestUrl, RequestUrlResponse } from "obsidian";
import type SummarizePlugin from "./main";
import { SummarizeSettings, OpenRouterModel, SummaryLength, InsertBehavior, OpenRouterBenchmarks, DEFAULT_PROMPT } from "./types";

type SettingsTabId = "general" | "models" | "freerank";
type SortKey = "name" | "provider" | "context" | "cost" | "arena" | "openllm" | "value";
type SortDirection = "asc" | "desc";

export class SummarizeSettingTab extends PluginSettingTab {
  plugin: SummarizePlugin;
  private activeTab: SettingsTabId = "general";

  // Filter state
  private searchFilter: string = "";
  private searchFocus: { start: number; end: number } | null = null;
  private providerFilter: string = "all";
  private freeOnly: boolean = false;
  private selectedOnly: boolean = false;
  private sortKey: SortKey = "name";
  private sortDirection: SortDirection = "asc";

  // Benchmark rate limiting
  private openLlmLastRequestAt = 0;
  private openLlmBackoffUntil = 0;
  private openLlmOrgIndex = new Map<string, Map<string, string>>();

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
        min-width: 100px;
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
      .summarize-table-wrap {
        max-height: 500px;
        overflow: auto;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
      }
      .summarize-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9em;
      }
      .summarize-table th {
        text-align: left;
        padding: 8px 12px;
        background: var(--background-secondary);
        border-bottom: 1px solid var(--background-modifier-border);
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .summarize-table td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--background-modifier-border);
        vertical-align: top;
      }
      .summarize-table tr:last-child td {
        border-bottom: none;
      }
      .summarize-table tr.is-selected {
        background: var(--background-secondary);
      }
      .summarize-table-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .summarize-table-title {
        font-weight: 500;
      }
      .summarize-table-id {
        font-size: 0.85em;
        color: var(--text-muted);
        font-family: monospace;
      }
      .summarize-table-actions {
        display: flex;
        gap: 4px;
      }
      .summarize-table-actions button {
        font-size: 0.8em;
        padding: 2px 6px;
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
          .addOption("brief", "Brief (~50 words)")
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

    containerEl.createEl("h3", { text: "Custom Prompt" });

    const promptDesc = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    promptDesc.innerHTML = `
      Customize the summarization prompt. Use placeholders:<br>
      <code>{{content}}</code> - The content to summarize<br>
      <code>{{wordCount}}</code> - Target word count (based on length setting)<br>
      <code>{{language}}</code> - Language instruction<br>
      Leave empty to use the default prompt.
    `;

    const promptSetting = new Setting(containerEl)
      .setName("Prompt Template")
      .setClass("summarize-prompt-setting");

    promptSetting.addTextArea((text) => {
      text
        .setPlaceholder(DEFAULT_PROMPT)
        .setValue(this.plugin.settings.customPrompt)
        .onChange(async (value) => {
          this.plugin.settings.customPrompt = value;
          await this.plugin.saveSettings();
        });
      text.inputEl.rows = 12;
      text.inputEl.style.width = "100%";
      text.inputEl.style.fontFamily = "monospace";
      text.inputEl.style.fontSize = "0.85em";
    });

    const resetBtn = containerEl.createEl("button", { text: "Reset to default" });
    resetBtn.style.marginTop = "8px";
    resetBtn.addEventListener("click", async () => {
      this.plugin.settings.customPrompt = "";
      await this.plugin.saveSettings();
      this.display();
      new Notice("Prompt reset to default");
    });
  }

  private renderModelsTab(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Browse and select OpenRouter models. Use the table to compare and select models.",
      cls: "setting-item-description",
    });

    if (!this.plugin.settings.openRouterApiKey) {
      containerEl.createEl("p", {
        text: "Add an OpenRouter API key in the General tab to browse models.",
        cls: "summarize-meta",
      });
      return;
    }

    // Header toolbar
    const header = containerEl.createDiv({ cls: "summarize-toolbar" });

    const refreshBtn = header.createEl("button", { text: "Refresh models" });
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      await this.fetchModels(true);
      this.display();
    });

    const benchBtn = header.createEl("button", { text: "Fetch benchmarks (visible)" });
    benchBtn.addEventListener("click", async () => {
      benchBtn.disabled = true;
      const visibleModels = this.getVisibleModels();
      await this.fetchBenchmarks(visibleModels);
      this.display();
    });

    const benchSelectedBtn = header.createEl("button", { text: "Fetch benchmarks (selected)" });
    benchSelectedBtn.addEventListener("click", async () => {
      benchSelectedBtn.disabled = true;
      const selectedModels = this.getSelectedModels();
      if (!selectedModels.length) {
        new Notice("No models selected.");
        benchSelectedBtn.disabled = false;
        return;
      }
      await this.fetchBenchmarks(selectedModels);
      this.display();
    });

    const lastFetched = this.plugin.settings.openRouter.lastFetched;
    const lastFetchedText = lastFetched
      ? `Last sync: ${new Date(lastFetched).toLocaleString()}`
      : "No model cache yet";
    header.createEl("span", { text: lastFetchedText, cls: "summarize-meta" });

    const benchFetched = this.plugin.settings.openRouter.benchmarks?.lastFetched ?? null;
    const benchFetchedText = benchFetched
      ? `Benchmarks: ${new Date(benchFetched).toLocaleString()}`
      : "Benchmarks: not fetched";
    header.createEl("span", { text: benchFetchedText, cls: "summarize-meta" });

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

    if (this.providerFilter !== "all" && !providers.includes(this.providerFilter)) {
      this.providerFilter = "all";
    }

    // Filters toolbar
    const filters = containerEl.createDiv({ cls: "summarize-toolbar" });

    // Search
    const searchInput = filters.createEl("input", {
      type: "text",
      placeholder: "Search models...",
    });
    searchInput.value = this.searchFilter;
    searchInput.addEventListener("input", () => {
      this.searchFilter = searchInput.value;
      this.searchFocus = {
        start: searchInput.selectionStart ?? this.searchFilter.length,
        end: searchInput.selectionEnd ?? this.searchFilter.length,
      };
      this.display();
    });
    if (this.searchFocus) {
      const { start, end } = this.searchFocus;
      this.searchFocus = null;
      searchInput.focus();
      try {
        searchInput.setSelectionRange(start, end);
      } catch {
        // Ignore selection errors for unsupported inputs
      }
    }

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

    // Free only
    const freeLabel = filters.createEl("label");
    const freeCheckbox = freeLabel.createEl("input", { type: "checkbox" });
    freeCheckbox.checked = this.freeOnly;
    freeCheckbox.addEventListener("change", () => {
      this.freeOnly = freeCheckbox.checked;
      this.display();
    });
    freeLabel.appendText(" Free only");

    // Selected only
    const selectedLabel = filters.createEl("label");
    const selectedCheckbox = selectedLabel.createEl("input", { type: "checkbox" });
    selectedCheckbox.checked = this.selectedOnly;
    selectedCheckbox.addEventListener("change", () => {
      this.selectedOnly = selectedCheckbox.checked;
      this.display();
    });
    selectedLabel.appendText(" Selected only");

    // Sort dropdown
    const sortSelect = filters.createEl("select");
    sortSelect.createEl("option", { text: "Sort: Name", value: "name" });
    sortSelect.createEl("option", { text: "Sort: Provider", value: "provider" });
    sortSelect.createEl("option", { text: "Sort: Context", value: "context" });
    sortSelect.createEl("option", { text: "Sort: Cost", value: "cost" });
    sortSelect.createEl("option", { text: "Sort: Arena", value: "arena" });
    sortSelect.createEl("option", { text: "Sort: OpenLLM", value: "openllm" });
    sortSelect.createEl("option", { text: "Sort: Value", value: "value" });
    sortSelect.value = this.sortKey;
    sortSelect.addEventListener("change", () => {
      this.sortKey = sortSelect.value as SortKey;
      this.display();
    });

    // Sort direction
    const sortDirBtn = filters.createEl("button", {
      text: this.sortDirection === "asc" ? "↑ Asc" : "↓ Desc",
    });
    sortDirBtn.addEventListener("click", () => {
      this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
      this.display();
    });

    // Get filtered models
    const filtered = this.getVisibleModels();

    // Show count
    containerEl.createEl("p", {
      text: `Showing ${filtered.length} of ${models.length} models.`,
      cls: "summarize-meta",
    });

    // Table
    const tableWrap = containerEl.createDiv({ cls: "summarize-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "summarize-table" });

    // Header
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    ["", "Model", "Provider", "Context", "Cost", "Benchmarks", "Value", "Actions"].forEach((label) => {
      headRow.createEl("th", { text: label });
    });

    // Body
    const tbody = table.createEl("tbody");
    const selectedSet = new Set(
      this.plugin.settings.openRouter.selectedModels.map((id) => id.toLowerCase())
    );
    const rankSet = new Set(this.plugin.settings.openRouter.freeModelRank);

    if (filtered.length === 0) {
      const emptyRow = tbody.createEl("tr");
      const emptyCell = emptyRow.createEl("td", {
        attr: { colspan: "8" },
        text: "No models match your filters.",
      });
      emptyCell.style.textAlign = "center";
      emptyCell.style.color = "var(--text-muted)";
      return;
    }

    for (const model of filtered) {
      const isSelected = selectedSet.has(model.id.toLowerCase());
      const isDefault = model.id === this.plugin.settings.defaultModel;
      const isFree = this.isModelFree(model);
      const isRanked = rankSet.has(model.id);

      const row = tbody.createEl("tr", {
        cls: isSelected ? "is-selected" : undefined,
      });

      // Checkbox
      const selectCell = row.createEl("td");
      const selectBox = selectCell.createEl("input", { type: "checkbox" });
      selectBox.checked = isSelected;
      selectBox.addEventListener("change", async () => {
        this.toggleSelection(model.id, selectBox.checked);
        await this.plugin.saveSettings();
        this.display();
      });

      // Model name and ID
      const modelCell = row.createEl("td");
      const meta = modelCell.createDiv({ cls: "summarize-table-meta" });
      meta.createDiv({ text: model.name || model.id, cls: "summarize-table-title" });
      meta.createDiv({ text: model.id, cls: "summarize-table-id" });

      // Provider
      row.createEl("td", { text: this.getProvider(model) });

      // Context
      row.createEl("td", { text: `${model.context_length.toLocaleString()}` });

      // Cost
      row.createEl("td", { text: this.formatPricing(model) });

      // Benchmarks
      row.createEl("td", { text: this.formatBenchmark(model) });

      // Value
      row.createEl("td", { text: this.formatValue(model) });

      // Actions
      const actionsCell = row.createEl("td");
      const actions = actionsCell.createDiv({ cls: "summarize-table-actions" });

      const copyBtn = actions.createEl("button", { text: "Copy" });
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(model.id);
        new Notice(`Copied: ${model.id}`);
      });

      if (isFree && !isRanked) {
        const rankBtn = actions.createEl("button", { text: "Rank" });
        rankBtn.addEventListener("click", async () => {
          this.addToFreeRank(model.id);
          await this.plugin.saveSettings();
          this.display();
          new Notice(`Added to rank: ${model.name}`);
        });
      }

      if (isRanked) {
        const rankPos = this.plugin.settings.openRouter.freeModelRank.indexOf(model.id) + 1;
        actions.createEl("span", { text: `#${rankPos}`, cls: "summarize-meta" });
      }

      const useBtn = actions.createEl("button", {
        text: isDefault ? "✓" : "Use",
      });
      if (isDefault) {
        useBtn.disabled = true;
      } else {
        useBtn.addEventListener("click", async () => {
          this.plugin.settings.defaultModel = model.id;
          await this.plugin.saveSettings();
          this.display();
          new Notice(`Default: ${model.name}`);
        });
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

        left.createSpan({ text: `${index + 1}.`, cls: "summarize-rank-number" });
        left.createSpan({ text: "⋮⋮", cls: "summarize-rank-handle" });
        left.createSpan({ text: model?.name || modelId });
        left.createEl("div", { text: modelId, cls: "summarize-table-id" });

        const removeBtn = row.createEl("button", { text: "Remove" });
        removeBtn.addEventListener("click", async () => {
          this.plugin.settings.openRouter.freeModelRank =
            this.plugin.settings.openRouter.freeModelRank.filter((id) => id !== modelId);
          await this.plugin.saveSettings();
          renderList();
        });

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

  // ============================================================================
  // Model Helpers
  // ============================================================================

  private getVisibleModels(): OpenRouterModel[] {
    const models = this.plugin.settings.openRouter.models;
    const selectedSet = new Set(
      this.plugin.settings.openRouter.selectedModels.map((id) => id.toLowerCase())
    );
    const bench = this.getBenchmarks();

    let filtered = models.slice();

    if (this.searchFilter) {
      const search = this.searchFilter.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.id.toLowerCase().includes(search) ||
          m.name.toLowerCase().includes(search)
      );
    }

    if (this.providerFilter !== "all") {
      filtered = filtered.filter((m) => this.getProvider(m) === this.providerFilter);
    }

    if (this.freeOnly) {
      filtered = filtered.filter((m) => this.isModelFree(m));
    }

    if (this.selectedOnly) {
      filtered = filtered.filter((m) => selectedSet.has(m.id.toLowerCase()));
    }

    // Sort
    const dir = this.sortDirection === "asc" ? 1 : -1;
    const compareNumber = (a: number | null | undefined, b: number | null | undefined): number => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    };

    filtered.sort((a, b) => {
      let result = 0;
      switch (this.sortKey) {
        case "provider":
          result = this.getProvider(a).localeCompare(this.getProvider(b));
          break;
        case "context":
          result = compareNumber(a.context_length, b.context_length);
          break;
        case "cost": {
          const aCost = a.pricing.prompt + a.pricing.completion;
          const bCost = b.pricing.prompt + b.pricing.completion;
          result = compareNumber(aCost, bCost);
          break;
        }
        case "arena":
          result = compareNumber(bench.arenaScores[a.id], bench.arenaScores[b.id]);
          break;
        case "openllm":
          result = compareNumber(bench.openLlmScores[a.id], bench.openLlmScores[b.id]);
          break;
        case "value":
          result = compareNumber(this.getValueScore(a, bench), this.getValueScore(b, bench));
          break;
        case "name":
        default:
          result = a.name.localeCompare(b.name);
      }
      return result * dir;
    });

    return filtered;
  }

  private getSelectedModels(): OpenRouterModel[] {
    const models = this.plugin.settings.openRouter.models;
    const selectedSet = new Set(
      this.plugin.settings.openRouter.selectedModels.map((id) => id.toLowerCase())
    );
    return models.filter((m) => selectedSet.has(m.id.toLowerCase()));
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
    return model.id.endsWith(":free") || (model.pricing.prompt === 0 && model.pricing.completion === 0);
  }

  private formatPricing(model: OpenRouterModel): string {
    if (this.isModelFree(model)) {
      return "Free";
    }
    const prompt = model.pricing.prompt * 1000000;
    const completion = model.pricing.completion * 1000000;
    return `$${prompt.toFixed(2)}/$${completion.toFixed(2)}`;
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
    this.toggleSelection(modelId, true);
  }

  // ============================================================================
  // Benchmark Helpers
  // ============================================================================

  private getBenchmarks(): OpenRouterBenchmarks {
    return this.plugin.settings.openRouter.benchmarks ?? {
      arenaScores: {},
      openLlmScores: {},
      openLlmFetched: {},
      lastFetched: null,
    };
  }

  private formatBenchmark(model: OpenRouterModel): string {
    const bench = this.getBenchmarks();
    const arenaScore = bench.arenaScores[model.id];
    const openLlmScore = bench.openLlmScores[model.id];
    const parts: string[] = [];
    if (arenaScore != null) {
      parts.push(`Arena ${Math.round(arenaScore)}`);
    }
    if (openLlmScore != null) {
      parts.push(`OpenLLM ${openLlmScore.toFixed(1)}%`);
    }
    if (parts.length === 0) {
      return "—";
    }
    return parts.join(" · ");
  }

  private getValueScore(model: OpenRouterModel, bench = this.getBenchmarks()): number | null {
    const openLlmScore = bench.openLlmScores[model.id];
    const arenaScore = bench.arenaScores[model.id];
    const score = openLlmScore ?? arenaScore;
    if (score == null) return null;

    const costPerToken = model.pricing.prompt + model.pricing.completion;
    if (costPerToken <= 0) return Number.POSITIVE_INFINITY;
    const costPer1M = costPerToken * 1_000_000;

    return score / costPer1M;
  }

  private formatValue(model: OpenRouterModel): string {
    const value = this.getValueScore(model);
    if (value == null) return "—";
    if (value === Number.POSITIVE_INFINITY) return "∞";
    const formatted = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
    return `${formatted} score/$1M`;
  }

  private async fetchBenchmarks(models: OpenRouterModel[]): Promise<void> {
    if (!models.length) {
      new Notice("No models to benchmark.");
      return;
    }

    const notice = new Notice("Fetching benchmarks...", 0);

    const arenaMap = await this.fetchArenaScores();
    const arenaScores = { ...this.getBenchmarks().arenaScores };
    const openLlmScores = { ...this.getBenchmarks().openLlmScores };
    const openLlmFetched: Record<string, string> = {
      ...this.getBenchmarks().openLlmFetched,
    };

    // Backfill openLlmFetched for existing scores
    const fallbackFetched = this.plugin.settings.openRouter.benchmarks.lastFetched;
    Object.keys(openLlmScores).forEach((id) => {
      if (!openLlmFetched[id]) {
        openLlmFetched[id] = fallbackFetched ?? new Date().toISOString();
      }
    });

    models.forEach((model) => {
      const arenaScore = this.matchArenaScore(model, arenaMap);
      if (arenaScore != null) {
        arenaScores[model.id] = arenaScore;
      }
    });

    for (const model of models) {
      if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
        new Notice("Open LLM benchmark rate limited; try again later.");
        break;
      }
      // Skip if already fetched (even if no score found)
      if (openLlmFetched[model.id]) {
        continue;
      }
      // Skip if we have a score
      if (openLlmScores[model.id] != null) {
        openLlmFetched[model.id] = new Date().toISOString();
        continue;
      }
      const { score: openLlmScore, fetched } = await this.fetchOpenLlmScore(model);
      if (fetched) {
        openLlmFetched[model.id] = new Date().toISOString();
      }
      if (openLlmScore != null) {
        openLlmScores[model.id] = openLlmScore;
      }
    }

    this.plugin.settings.openRouter.benchmarks = {
      arenaScores,
      openLlmScores,
      openLlmFetched,
      lastFetched: new Date().toISOString(),
    };
    await this.plugin.saveSettings();
    notice.hide();
    new Notice("Benchmarks updated.");
  }

  private normalizeBenchmarkKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  private stripHtmlTags(value: string): string {
    return value.replace(/<[^>]*>/g, "");
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private async rateLimitOpenLlm(): Promise<void> {
    const now = Date.now();
    const minDelayMs = 700;
    const waitFor = Math.max(0, this.openLlmLastRequestAt + minDelayMs - now);
    if (waitFor > 0) {
      await this.sleep(waitFor);
    }
    this.openLlmLastRequestAt = Date.now();
  }

  private async requestOpenLlm(
    options: { url: string; method: "GET" },
    label: string
  ): Promise<RequestUrlResponse | null> {
    if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
      return null;
    }

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        await this.rateLimitOpenLlm();
        const response = await requestUrl(options) as RequestUrlResponse;
        if (response.status === 429) {
          this.openLlmBackoffUntil = Date.now() + 60_000;
          await this.sleep(2000 * (attempt + 1));
          continue;
        }
        return response;
      } catch (error) {
        const status = (error as { status?: number }).status;
        const message = error instanceof Error ? error.message : String(error);
        if (status === 429 || message.includes("status 429")) {
          this.openLlmBackoffUntil = Date.now() + 60_000;
          await this.sleep(2000 * (attempt + 1));
          continue;
        }
        console.warn(`[Summarize] Failed to fetch Open LLM benchmark (${label})`, error);
        return null;
      }
    }

    return null;
  }

  private getArenaKeyVariants(value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) return [];

    const variants = new Set<string>();
    const base = this.normalizeBenchmarkKey(trimmed);
    if (base) {
      variants.add(base);
    }

    let next = base.replace(/\d{8}$/g, "").replace(/\d{6}$/g, "");
    if (next && next !== base) {
      variants.add(next);
    }

    const withoutSuffix = next.replace(/(latest|preview|alpha|beta|rc)$/g, "");
    if (withoutSuffix && withoutSuffix !== next) {
      variants.add(withoutSuffix);
    }

    const withoutChatGpt = withoutSuffix.replace(/^chatgpt/, "");
    if (withoutChatGpt && withoutChatGpt !== withoutSuffix) {
      variants.add(withoutChatGpt);
    }

    return Array.from(variants);
  }

  private matchArenaScore(model: OpenRouterModel, arenaMap: Map<string, number>): number | null {
    const candidates = [
      model.name,
      model.id,
      model.id.split("/").pop() ?? model.id,
      model.canonical_slug ?? "",
      model.hugging_face_id ?? "",
    ].filter(Boolean);

    for (const candidate of candidates) {
      const keys = this.getArenaKeyVariants(candidate);
      for (const key of keys) {
        const score = arenaMap.get(key);
        if (score != null) {
          return score;
        }
      }
    }
    return null;
  }

  private async fetchArenaScores(): Promise<Map<string, number>> {
    const arenaMap = new Map<string, number>();
    const pageSize = 100;
    let offset = 0;

    while (true) {
      try {
        const response = await requestUrl({
          url: `https://datasets-server.huggingface.co/rows?dataset=mathewhe/chatbot-arena-elo&config=default&split=train&offset=${offset}&length=${pageSize}`,
          method: "GET",
        }) as RequestUrlResponse;

        if (response.status !== 200) {
          console.warn(`[Summarize] Arena benchmark fetch failed: HTTP ${response.status}`);
          break;
        }

        const payload = response.json as { rows?: Array<{ row?: Record<string, unknown> }> };
        const rows = payload.rows ?? [];
        if (!rows.length) break;

        rows.forEach((entry) => {
          const row = entry.row ?? {};
          const model = typeof row["Model"] === "string" ? row["Model"] : null;
          const score = typeof row["Arena Score"] === "number" ? row["Arena Score"] : null;
          if (model && score != null) {
            const markup = typeof row["Model Markup"] === "string" ? row["Model Markup"] : null;
            const candidates = [model, markup ? this.stripHtmlTags(markup) : null]
              .filter((value): value is string => Boolean(value));
            candidates.forEach((candidate) => {
              this.getArenaKeyVariants(candidate).forEach((key) => {
                if (!arenaMap.has(key)) {
                  arenaMap.set(key, score);
                }
              });
            });
          }
        });

        if (rows.length < pageSize) break;
        offset += rows.length;
      } catch (error) {
        console.warn("[Summarize] Failed to fetch Arena benchmarks", error);
        break;
      }
    }

    return arenaMap;
  }

  private encodePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  private async fetchOpenLlmResultFiles(path: string): Promise<string[] | null> {
    const treeResponse = await this.requestOpenLlm(
      {
        url: `https://huggingface.co/api/datasets/open-llm-leaderboard/results/tree/main/${this.encodePath(path)}`,
        method: "GET",
      },
      "tree"
    );

    if (!treeResponse || treeResponse.status !== 200) {
      return null;
    }

    const files = treeResponse.json as Array<{ path?: string }>;
    return files
      .map((file) => file.path)
      .filter((entry): entry is string => Boolean(entry) && entry.includes("results_") && entry.endsWith(".json"));
  }

  private async getOpenLlmOrgIndex(org: string): Promise<Map<string, string> | null> {
    if (this.openLlmOrgIndex.has(org)) {
      return this.openLlmOrgIndex.get(org) ?? null;
    }

    const response = await this.requestOpenLlm(
      {
        url: `https://huggingface.co/api/datasets/open-llm-leaderboard/results/tree/main/${this.encodePath(org)}`,
        method: "GET",
      },
      "org-index"
    );

    if (!response || response.status !== 200) {
      return null;
    }

    const entries = response.json as Array<{ path?: string; type?: string }>;
    const index = new Map<string, string>();
    entries.forEach((entry) => {
      if (entry.type !== "directory") return;
      const path = entry.path;
      if (!path) return;
      const leaf = path.split("/").pop() ?? path;
      index.set(this.normalizeBenchmarkKey(leaf), path);
    });

    this.openLlmOrgIndex.set(org, index);
    return index;
  }

  private async resolveOpenLlmPath(candidateId: string): Promise<string | null> {
    if (!candidateId.includes("/")) return null;

    const [org, ...rest] = candidateId.split("/");
    const repo = rest.join("/");
    const index = await this.getOpenLlmOrgIndex(org);
    if (!index) return null;

    const directKey = this.normalizeBenchmarkKey(repo);
    if (index.has(directKey)) {
      return index.get(directKey) ?? null;
    }

    const withoutMeta = repo.replace(/^meta[-_]/i, "");
    if (withoutMeta !== repo) {
      const altKey = this.normalizeBenchmarkKey(withoutMeta);
      if (index.has(altKey)) {
        return index.get(altKey) ?? null;
      }
    }

    return null;
  }

  private async fetchOpenLlmScore(
    model: OpenRouterModel
  ): Promise<{ score: number | null; fetched: boolean }> {
    if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
      return { score: null, fetched: false };
    }

    const candidates = Array.from(new Set(
      [model.hugging_face_id, model.canonical_slug, model.id]
        .filter((value): value is string => Boolean(value) && value.includes("/"))
    ));

    if (candidates.length === 0) {
      return { score: null, fetched: true };
    }

    for (const candidate of candidates) {
      if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
        return { score: null, fetched: false };
      }
      const directFiles = await this.fetchOpenLlmResultFiles(candidate);
      if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
        return { score: null, fetched: false };
      }
      const files = directFiles?.length ? directFiles : null;
      const resolved = files ? null : await this.resolveOpenLlmPath(candidate);
      if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
        return { score: null, fetched: false };
      }
      const resolvedFiles = !files && resolved ? await this.fetchOpenLlmResultFiles(resolved) : null;
      if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
        return { score: null, fetched: false };
      }
      const resultFiles = files ?? resolvedFiles ?? [];

      if (!resultFiles.length) continue;

      const latestPath = resultFiles.sort().at(-1);
      if (!latestPath) continue;

      const resultResponse = await this.requestOpenLlm(
        {
          url: `https://huggingface.co/datasets/open-llm-leaderboard/results/resolve/main/${this.encodePath(latestPath)}`,
          method: "GET",
        },
        "results"
      );

      if (!resultResponse || resultResponse.status !== 200) {
        if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
          return { score: null, fetched: false };
        }
        continue;
      }

      const data = resultResponse.json as { results?: Record<string, Record<string, unknown>> };
      const leaderboard = data?.results?.leaderboard ?? {};
      const accNorm = leaderboard["acc_norm,none"];
      const acc = leaderboard["acc,none"];
      const value = typeof accNorm === "number" ? accNorm : typeof acc === "number" ? acc : null;
      if (value == null) continue;

      return { score: Math.round(value * 1000) / 10, fetched: true };
    }

    return { score: null, fetched: true };
  }
}

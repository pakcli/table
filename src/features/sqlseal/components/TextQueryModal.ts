import { App, Modal, Setting } from "obsidian";
import type TablitePlugin from "../../../main";
import {
  type TextQueryMode,
  executeTextQuery,
  parseTextQuery,
} from "../utils/calcEngine";

export class TextQueryModal extends Modal {
  private plugin?: TablitePlugin;
  private columnValues: string[];
  private colName: string;
  private onApply: (queryStr: string, isPreset?: boolean, presetName?: string) => void;

  private mode: TextQueryMode = "word";
  private term: string = "laptop";
  private saveAsPreset: boolean = false;
  private presetName: string = "*preset_laptop";

  private previewEl: HTMLElement | null = null;
  private queryInputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    columnValues: string[],
    colName: string,
    initialQuery: string = "",
    plugin?: TablitePlugin,
    onApply?: (queryStr: string, isPreset?: boolean, presetName?: string) => void
  ) {
    super(app);
    this.columnValues = columnValues;
    this.colName = colName;
    this.plugin = plugin;
    this.onApply = onApply || (() => {});

    if (initialQuery) {
      const parsed = parseTextQuery(initialQuery);
      if (parsed) {
        this.mode = parsed.mode;
        this.term = parsed.term;
        this.presetName = `*count_${parsed.term.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      }
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tablite-text-query-modal");

    contentEl.createEl("h2", {
      text: `Text Query & Count: ${this.colName || "Column"}`,
      cls: "tablite-modal-title",
    });

    contentEl.createEl("p", {
      text: "Count occurrences of words, regular expressions, or phrase matches across all cells in this column using Obsidian's search engine.",
      cls: "tablite-modal-desc",
    });

    // 1. Query Mode
    new Setting(contentEl)
      .setName("Matching Type")
      .setDesc("Word (whole word), Regex (regular expression pattern), or Match (Obsidian simple search)")
      .addDropdown((d) => {
        d.addOption("word", "Word (Whole word, case-insensitive)")
          .addOption("match", "Match / Contains (Obsidian Base Search)")
          .addOption("regex", "Regex (Pattern matching)")
          .setValue(this.mode)
          .onChange((val) => {
            this.mode = val as TextQueryMode;
            this.updatePreview();
          });
      });

    // 2. Search Term / Pattern
    new Setting(contentEl)
      .setName("Search Word / Pattern")
      .setDesc("E.g. laptop, error, \\d+, or active")
      .addText((text) => {
        this.queryInputEl = text.inputEl;
        text
          .setPlaceholder("laptop")
          .setValue(this.term)
          .onChange((val) => {
            this.term = val;
            this.presetName = `*count_${val.trim().replace(/[^a-zA-Z0-9_]/g, "_") || "match"}`;
            this.updatePreview();
          });
      });

    // Quick suggestions chips
    const chipsContainer = contentEl.createEl("div", { cls: "tablite-query-chips" });
    const examples = ["laptop", "phone", "error", "pending", "success"];
    examples.forEach((ex) => {
      const chip = chipsContainer.createEl("button", {
        text: `"${ex}"`,
        cls: "tablite-token-btn",
      });
      chip.type = "button";
      chip.addEventListener("click", () => {
        this.term = ex;
        if (this.queryInputEl) this.queryInputEl.value = ex;
        this.presetName = `*count_${ex}`;
        this.updatePreview();
      });
    });

    // 3. Live Feedback Preview Box
    const previewBox = contentEl.createEl("div", { cls: "tablite-calc-preview-box" });

    previewBox.createEl("div", {
      text: "Search Feedback Outcome (evaluated on current column data):",
      cls: "tablite-preview-header",
    });

    this.previewEl = previewBox.createEl("div", { cls: "tablite-preview-result" });

    this.updatePreview();

    // 4. Save as preset toggle
    if (this.plugin) {
      new Setting(contentEl)
        .setName("Save as Calculation Preset")
        .setDesc("Save this query so it is available in the column calculation dropdown across all files.")
        .addToggle((t) => {
          t.setValue(this.saveAsPreset).onChange((v) => {
            this.saveAsPreset = v;
          });
        });
    }

    // 5. Actions
    const actions = contentEl.createEl("div", { cls: "tablite-calc-modal-actions" });

    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", () => this.close());

    const applyBtn = actions.createEl("button", {
      text: "Apply Calculation",
      cls: "mod-cta",
    });
    applyBtn.type = "button";
    applyBtn.addEventListener("click", () => this.handleApply());
  }

  private updatePreview() {
    if (!this.previewEl) return;
    this.previewEl.empty();

    const terms = this.term
      .split(/[\r\n,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (terms.length === 0) {
      this.previewEl.createSpan({ text: "Enter search word(s) or pattern(s) above...", cls: "tablite-calc-preview-empty" });
      return;
    }

    const group = this.previewEl.createEl("div", { cls: "tablite-calc-badge-group" });

    for (const singleTerm of terms) {
      try {
        const result = executeTextQuery({ mode: this.mode, term: singleTerm }, this.columnValues);
        const badge = group.createEl("div", { cls: "tablite-calc-badge" });
        badge.createSpan({ text: result.display, cls: "tablite-calc-badge-val" });
      } catch (err) {
        const badge = group.createEl("div", { cls: "tablite-calc-badge tablite-calc-badge-error" });
        badge.createSpan({ text: `${singleTerm}: ${(err as Error).message}`, cls: "tablite-calc-badge-val" });
      }
    }
  }

  private async handleApply() {
    const terms = this.term
      .split(/[\r\n,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (terms.length === 0) {
      new Notice("Please provide at least one search word or pattern.");
      return;
    }

    // Build multi-line query string if multiple terms, or single query string if one term
    const queryLines = terms.map((t) => `count - ${this.mode} - ${t}`);
    const queryStr = queryLines.join("\n");

    if (this.saveAsPreset && this.plugin) {
      let pName = this.presetName.trim();
      if (!pName.startsWith("*")) pName = `*${pName}`;

      if (!this.plugin.settings.calcPresets) {
        this.plugin.settings.calcPresets = [];
      }

      this.plugin.settings.calcPresets.push({
        id: `preset_text_${Date.now()}`,
        name: pName,
        formula: queryStr,
        description: terms.length > 1 ? `Multi-count: ${terms.join(", ")}` : `Count ${this.mode}: ${terms[0]}`,
      });
      await this.plugin.saveSettings();
      new Notice(`Saved preset "${pName}" with ${terms.length} count(s)!`);
      this.onApply(queryStr, true, pName);
    } else {
      this.onApply(queryStr, false);
    }

    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

import { App, Modal, Setting } from "obsidian";
import type TablitePlugin from "../../../main";
import type { CalcPreset } from "../types";
import {
  evaluateCalculationPresetOrFormula,
} from "../utils/calcEngine";

export class CustomCalcModal extends Modal {
  private plugin: TablitePlugin;
  private onSave?: (preset: CalcPreset) => void;
  private existingPreset?: CalcPreset;

  private name: string = "";
  private formula: string = "";
  private description: string = "";

  private formulaInputEl: HTMLTextAreaElement | HTMLInputElement | null = null;
  private previewEl: HTMLElement | null = null;

  constructor(
    app: App,
    plugin: TablitePlugin,
    existingPreset?: CalcPreset,
    onSave?: (preset: CalcPreset) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.existingPreset = existingPreset;
    this.onSave = onSave;

    if (existingPreset) {
      this.name = existingPreset.name;
      this.formula = existingPreset.formula;
      this.description = existingPreset.description || "";
    } else {
      // Generate default unique name
      const count = (this.plugin.settings.calcPresets || []).length + 1;
      this.name = `*preset_${count}`;
      this.formula = "count - word - laptop\ncount - word - phone";
      this.description = "";
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tablite-calc-modal");

    contentEl.createEl("h2", {
      text: this.existingPreset ? "Edit Calculation Preset" : "Add Custom Calculation Preset",
      cls: "tablite-calc-modal-title",
    });

    contentEl.createEl("p", {
      text: "Build custom math formulas or text search queries. Supports multiple counts or output rows in a single preset (one per line or separated by semicolon).",
      cls: "tablite-calc-modal-desc",
    });

    // 1. Preset Name Setting
    new Setting(contentEl)
      .setName("Preset Name")
      .setDesc("The display label in the column calculation dropdown (must start with * or text).")
      .addText((text) => {
        text
          .setPlaceholder("*preset_nama")
          .setValue(this.name)
          .onChange((val) => {
            this.name = val.trim();
          });
      });

    // 2. Math Formula / Multi-line Setting
    new Setting(contentEl)
      .setName("Formula / Query Lines")
      .setDesc("Formulas (SUM * 1.1) or text queries (count - word - laptop). Put each on a new line for multiple output rows.")
      .addTextArea((textarea) => {
        this.formulaInputEl = textarea.inputEl;
        textarea.inputEl.rows = 4;
        textarea.inputEl.addClass("tablite-calc-modal-textarea");
        textarea
          .setPlaceholder("count - word - laptop\ncount - word - phone\nSUM * 1.1")
          .setValue(this.formula)
          .onChange((val) => {
            this.formula = val;
            this.updatePreview();
          });
      });

    // Token Insertion Buttons / Chips
    const tokensContainer = contentEl.createEl("div", { cls: "tablite-calc-tokens" });

    const insertToken = (token: string) => {
      if (!this.formulaInputEl) return;
      const start = this.formulaInputEl.selectionStart ?? this.formula.length;
      const end = this.formulaInputEl.selectionEnd ?? this.formula.length;
      const current = this.formulaInputEl.value;
      const next = current.substring(0, start) + token + current.substring(end);
      this.formula = next;
      this.formulaInputEl.value = next;
      this.formulaInputEl.focus();
      this.formulaInputEl.setSelectionRange(start + token.length, start + token.length);
      this.updatePreview();
    };

    const chips = [
      { label: "SUM", val: "SUM" },
      { label: "MID", val: "MID" },
      { label: "AVG", val: "AVG" },
      { label: "MAX", val: "MAX" },
      { label: "MIN", val: "MIN" },
      { label: "COUNT", val: "COUNT" },
      { label: "+", val: " + " },
      { label: "-", val: " - " },
      { label: "*", val: " * " },
      { label: "/", val: " / " },
      { label: "↵ New Line", val: "\n" },
      { label: "count - word - ...", val: "count - word - laptop" },
      { label: "count - match - ...", val: "count - match - keyword" },
      { label: "count - regex - ...", val: "count - regex - \\d+" },
      {
        label: "➕ Multi-Count Preset",
        val: (this.formula ? "\n" : "") + "count - word - laptop\ncount - word - phone",
      },
      {
        label: "➕ Multi-Metric Preset",
        val: (this.formula ? "\n" : "") + "SUM\nAVG\nCOUNT",
      },
    ];

    chips.forEach((c) => {
      const btn = tokensContainer.createEl("button", {
        text: c.label,
        cls: "tablite-token-btn",
      });
      btn.type = "button";
      btn.addEventListener("click", () => insertToken(c.val));
    });

    // 3. Formula Description
    new Setting(contentEl)
      .setName("Description (Optional)")
      .setDesc("Brief explanation of what this calculation represents.")
      .addText((text) => {
        text
          .setPlaceholder("e.g. Multiple item counts in a single preset")
          .setValue(this.description)
          .onChange((val) => {
            this.description = val.trim();
          });
      });

    // 4. Live Preview Box
    const previewBox = contentEl.createEl("div", { cls: "tablite-calc-preview-box" });

    previewBox.createEl("div", {
      text: "Live Output Rows Preview (evaluated with sample data):",
      cls: "tablite-preview-header",
    });

    this.previewEl = previewBox.createEl("div", { cls: "tablite-preview-result" });

    this.updatePreview();

    // 5. Actions: Save & Cancel
    const actionsEl = contentEl.createEl("div", { cls: "tablite-calc-modal-actions" });

    const cancelBtn = actionsEl.createEl("button", { text: "Cancel" });
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = actionsEl.createEl("button", {
      text: this.existingPreset ? "Save Changes" : "Add Preset",
      cls: "mod-cta",
    });
    saveBtn.type = "button";
    saveBtn.addEventListener("click", () => this.handleSave());
  }

  private updatePreview() {
    if (!this.previewEl) return;
    this.previewEl.empty();

    const sampleMetrics = {
      sum: 1000,
      mid: 200,
      avg: 250,
      max: 500,
      min: 50,
      count: 4,
      numCount: 4,
      rawValues: [
        "Dell Laptop XPS 15",
        "MacBook Laptop Pro",
        "Apple iPhone 15",
        "Android Phone Galaxy",
        "Mechanical keyboard",
      ],
    };

    if (!this.formula.trim()) {
      this.previewEl.createSpan({ text: "Enter a formula or queries above...", cls: "tablite-calc-preview-empty" });
      return;
    }

    const rows = evaluateCalculationPresetOrFormula(this.formula, sampleMetrics);
    if (rows.length === 0) {
      this.previewEl.createSpan({ text: "Enter a formula or queries above...", cls: "tablite-calc-preview-empty" });
      return;
    }

    const group = this.previewEl.createEl("div", { cls: "tablite-calc-badge-group" });

    for (const r of rows) {
      const badge = group.createEl("div", {
        cls: `tablite-calc-badge ${r.isError ? "tablite-calc-badge-error" : ""}`,
      });
      if (r.isTextQuery) {
        badge.createSpan({ text: r.display, cls: "tablite-calc-badge-val" });
      } else {
        if (r.label) {
          badge.createSpan({ text: `${r.label}: `, cls: "tablite-calc-badge-prefix" });
        }
        badge.createSpan({ text: r.display, cls: "tablite-calc-badge-val" });
      }
    }
  }

  private async handleSave() {
    let name = this.name.trim();
    if (!name) {
      new Notice("Please provide a preset name (e.g. *preset_satu).");
      return;
    }
    // Automatically prepend * if not present
    if (!name.startsWith("*")) {
      name = `*${name}`;
    }

    const formula = this.formula.trim();
    if (!formula) {
      new Notice("Please enter a valid math formula or text query.");
      return;
    }

    // Verify formula validity across all rows
    const sampleMetrics = {
      sum: 100,
      mid: 20,
      avg: 25,
      max: 50,
      min: 5,
      count: 4,
      numCount: 4,
      rawValues: ["laptop", "mouse", "phone"],
    };
    const evaluatedRows = evaluateCalculationPresetOrFormula(formula, sampleMetrics);
    const errorRows = evaluatedRows.filter((r) => r.isError);
    if (evaluatedRows.length > 0 && errorRows.length === evaluatedRows.length) {
      new Notice("Invalid formula or query syntax in preset.");
      return;
    }

    if (!this.plugin.settings.calcPresets) {
      this.plugin.settings.calcPresets = [];
    }

    const presetId = this.existingPreset?.id || `preset_${Date.now()}`;
    const preset: CalcPreset = {
      id: presetId,
      name,
      formula,
      description: this.description,
    };

    if (this.existingPreset) {
      const idx = this.plugin.settings.calcPresets.findIndex((p) => p.id === this.existingPreset.id);
      if (idx !== -1) {
        this.plugin.settings.calcPresets[idx] = preset;
      } else {
        this.plugin.settings.calcPresets.push(preset);
      }
    } else {
      this.plugin.settings.calcPresets.push(preset);
    }

    await this.plugin.saveSettings();
    new Notice(`Calculation preset "${name}" saved!`);

    if (this.onSave) {
      this.onSave(preset);
    }

    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

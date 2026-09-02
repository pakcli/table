import { App, Plugin, PluginSettingTab, Setting, setIcon, Notice, Modal } from "obsidian";
import { runSystemDiagnostics, SystemHealthStatus } from "./wizard";
import { ECOSYSTEM_MODULES, BlueprintSection } from "./previewSchemas";
import { saveVaultConfig, loadVaultConfig, listVaultSnapshots, SnapshotItem } from "./vaultConfig";
import { eventBus } from "./eventBus";

export interface SettingsSectionHandler {
  id: string;
  category: "local" | "table" | "agent";
  title: string;
  icon: string;
  isInstalled: boolean;
  render: (containerEl: HTMLElement) => void;
}

// Global window memory history stack for live Undo / Redo across all tabs
declare global {
  interface Window {
    __PakCLI_MemoryHistory__?: {
      stack: Array<{ pluginId: string; state: string }>;
      index: number;
    };
  }
}

if (typeof window !== "undefined" && !window.__PakCLI_MemoryHistory__) {
  window.__PakCLI_MemoryHistory__ = {
    stack: [],
    index: -1,
  };
}

export class VaultConfigActionModal extends Modal {
  private plugin: Plugin;
  private selectedSnapshot: SnapshotItem;
  private onComplete: () => void;

  constructor(app: App, plugin: Plugin, selectedSnapshot: SnapshotItem, onComplete: () => void) {
    super(app);
    this.plugin = plugin;
    this.selectedSnapshot = selectedSnapshot;
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pakcli-config-modal-root");

    new Setting(contentEl)
      .setName("⚙️ Vault Config Action")
      .setDesc(`Selected snapshot: ${this.selectedSnapshot.name}`)
      .setHeading();

    const descBox = contentEl.createDiv({ cls: "pakcli-modal-desc-box" });
    descBox.createEl("p", {
      text: "Choose what you want to do with this snapshot and your active plugin settings:",
    });

    const actionsGrid = contentEl.createDiv({ cls: "pakcli-modal-actions-grid" });

    // 1. REPLACE
    const replaceCard = actionsGrid.createDiv({ cls: "pakcli-action-card replace" });
    replaceCard.createDiv({ cls: "pakcli-card-title", text: "🔄 Replace" });
    replaceCard.createDiv({ cls: "pakcli-card-desc", text: "Apply snapshot settings to your active plugin immediately." });
    const replaceBtn = replaceCard.createEl("button", { text: "Replace Active", cls: "pakcli-btn-replace" });
    replaceBtn.onclick = async () => {
      const pluginId = this.plugin.manifest.id as "pakcli-local" | "pakcli-table" | "pakcli-agent";
      const restored = await loadVaultConfig(this.app, pluginId, this.selectedSnapshot.path);
      if (restored) {
        Object.assign((this.plugin as any).settings, restored);
        if (typeof (this.plugin as any).saveSettings === "function") {
          await (this.plugin as any).saveSettings();
        }
        eventBus.emit("settings:updated", { pluginId });
        new Notice(`✅ Replaced active settings from ${this.selectedSnapshot.name}!`);
      } else {
        new Notice("ℹ️ Snapshot file was empty or could not be loaded.");
      }
      this.close();
      this.onComplete();
    };

    // 2. OVERWRITE
    const overwriteCard = actionsGrid.createDiv({ cls: "pakcli-action-card overwrite" });
    overwriteCard.createDiv({ cls: "pakcli-card-title", text: "💾 Overwrite" });
    overwriteCard.createDiv({ cls: "pakcli-card-desc", text: "Overwrite this snapshot file with your current active settings." });
    const overwriteBtn = overwriteCard.createEl("button", { text: "Overwrite Snapshot", cls: "pakcli-btn-overwrite" });
    overwriteBtn.onclick = async () => {
      const pluginId = this.plugin.manifest.id as "pakcli-local" | "pakcli-table" | "pakcli-agent";
      await saveVaultConfig(this.app, pluginId, (this.plugin as any).settings || {});
      new Notice("✅ Overwritten snapshot with current settings!");
      this.close();
      this.onComplete();
    };

    // 3. DUPLICATE
    const duplicateCard = actionsGrid.createDiv({ cls: "pakcli-action-card duplicate" });
    duplicateCard.createDiv({ cls: "pakcli-card-title", text: "📑 Duplicate" });
    duplicateCard.createDiv({ cls: "pakcli-card-desc", text: "Save current active settings as a new separate snapshot copy." });
    const duplicateBtn = duplicateCard.createEl("button", { text: "Duplicate New", cls: "pakcli-btn-duplicate" });
    duplicateBtn.onclick = async () => {
      const pluginId = this.plugin.manifest.id as "pakcli-local" | "pakcli-table" | "pakcli-agent";
      await saveVaultConfig(this.app, pluginId, (this.plugin as any).settings || {}, "copy");
      new Notice("✅ Created a new duplicated snapshot in pakcli-vault-config!");
      this.close();
      this.onComplete();
    };

    // 4. CANCEL
    const cancelRow = contentEl.createDiv({ cls: "pakcli-modal-cancel-row" });
    const cancelBtn = cancelRow.createEl("button", { text: "Cancel", cls: "pakcli-btn-cancel" });
    cancelBtn.onclick = () => {
      this.close();
    };
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class MasterDetailSettingsTab extends PluginSettingTab {
  plugin: Plugin;
  activeSectionId = "";
  searchQuery = "";
  healthStatus: SystemHealthStatus | null = null;
  localHandlers: Map<string, SettingsSectionHandler> = new Map();
  private simulatedState: Record<string, Record<string, any>> = {};
  private unsubscribeBus: (() => void) | null = null;

  constructor(app: App, plugin: Plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.activeSectionId = plugin.manifest.id === "pakcli-table" ? "table-csv" : (plugin.manifest.id === "pakcli-agent" ? "agent-antigravity" : "local-wizard");
    this.recordMemorySnapshot((plugin as any).settings || {});
  }

  registerLocalSection(handler: SettingsSectionHandler) {
    this.localHandlers.set(handler.id, handler);
  }

  private isPluginInstalled(pluginId: string): boolean {
    const plugins = (this.app as any).plugins;
    if (!plugins) return false;
    return !!(plugins.manifests && plugins.manifests[pluginId]);
  }

  private isPluginEnabled(pluginId: string): boolean {
    const plugins = (this.app as any).plugins;
    if (!plugins) return false;
    return !!(plugins.plugins && plugins.plugins[pluginId]);
  }

  private isLocalPresent(): boolean {
    return this.plugin.manifest.id === "pakcli-local" || this.isPluginEnabled("pakcli-local");
  }

  private getPluginInstance(pluginId: string): any | null {
    if (this.plugin.manifest.id === pluginId) return this.plugin;
    const plugins = (this.app as any).plugins;
    return (plugins && plugins.plugins) ? plugins.plugins[pluginId] : null;
  }

  // ── 1. In-Memory Undo/Redo Engine ───────────────────────────────────────

  public recordMemorySnapshot(stateObj: Record<string, any>): void {
    if (typeof window === "undefined") return;
    const history = window.__PakCLI_MemoryHistory__!;
    const stateStr = JSON.stringify(stateObj);
    const pluginId = this.plugin.manifest.id;

    if (history.index >= 0 && history.stack[history.index]?.state === stateStr) {
      return;
    }

    // Truncate forward history if branched
    if (history.index < history.stack.length - 1) {
      history.stack = history.stack.slice(0, history.index + 1);
    }

    history.stack.push({ pluginId, state: stateStr });
    history.index = history.stack.length - 1;

    // Cap history at 50 states
    if (history.stack.length > 50) {
      history.stack.shift();
      history.index--;
    }
  }

  public async performMemoryUndo(): Promise<void> {
    if (typeof window === "undefined") return;
    const history = window.__PakCLI_MemoryHistory__!;
    if (history.index > 0) {
      history.index--;
      const targetEntry = history.stack[history.index];
      const parsed = JSON.parse(targetEntry.state);

      const targetPlugin = this.getPluginInstance(targetEntry.pluginId) || this.plugin;
      Object.assign(targetPlugin.settings, parsed);

      if (typeof targetPlugin.saveSettings === "function") {
        await targetPlugin.saveSettings();
      }
      if (typeof targetPlugin.applyCodeblockStyle === "function") {
        targetPlugin.applyCodeblockStyle();
      }
      if (typeof targetPlugin.applyBadgeSetting === "function") {
        targetPlugin.applyBadgeSetting();
      }

      eventBus.emit("settings:updated", { pluginId: targetPlugin.manifest.id });
      new Notice("↶ Undone setting change (Memory Snapshot)");
      this.display();
    }
  }

  public async performMemoryRedo(): Promise<void> {
    if (typeof window === "undefined") return;
    const history = window.__PakCLI_MemoryHistory__!;
    if (history.index < history.stack.length - 1) {
      history.index++;
      const targetEntry = history.stack[history.index];
      const parsed = JSON.parse(targetEntry.state);

      const targetPlugin = this.getPluginInstance(targetEntry.pluginId) || this.plugin;
      Object.assign(targetPlugin.settings, parsed);

      if (typeof targetPlugin.saveSettings === "function") {
        await targetPlugin.saveSettings();
      }
      if (typeof targetPlugin.applyCodeblockStyle === "function") {
        targetPlugin.applyCodeblockStyle();
      }
      if (typeof targetPlugin.applyBadgeSetting === "function") {
        targetPlugin.applyBadgeSetting();
      }

      eventBus.emit("settings:updated", { pluginId: targetPlugin.manifest.id });
      new Notice("↷ Redone setting change (Memory Snapshot)");
      this.display();
    }
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("pakcli-master-detail-root");

    if (!this.unsubscribeBus) {
      this.unsubscribeBus = eventBus.on("settings:updated", () => {
        const activePane = containerEl.querySelector(".pakcli-content-pane") as HTMLElement;
        if (activePane) {
          this.renderContent(activePane);
        }
      });
    }

    const pluginId = this.plugin.manifest.id as "pakcli-local" | "pakcli-table" | "pakcli-agent";
    const isLocalActive = this.isLocalPresent();
    const snapshots = isLocalActive ? await listVaultSnapshots(this.app, pluginId) : [];

    // Top Bar
    const topBar = containerEl.createDiv({ cls: "pakcli-topbar" });
    new Setting(topBar)
      .setName("⚙️ PakCLI Suite")
      .setDesc("Unified ecosystem settings, diagnostics, and module hub.")
      .setHeading();

    const topActions = topBar.createDiv({ cls: "pakcli-topbar-actions" });

    // 1. Undo / Redo Memory Action Buttons (Placed visibly in TopBar)
    const history = typeof window !== "undefined" ? window.__PakCLI_MemoryHistory__ : null;
    const canUndo = !!(history && history.index > 0);
    const canRedo = !!(history && history.index < history.stack.length - 1);

    const historyWrap = topActions.createDiv({ cls: "pakcli-history-btn-wrap" });

    const undoBtn = historyWrap.createEl("button", {
      text: "↶ Undo",
      cls: `pakcli-history-btn pakcli-undo-btn ${!canUndo ? "is-disabled" : ""}`,
    });
    undoBtn.title = canUndo ? "Undo settings change (Memory)" : "No more undo steps";
    undoBtn.onclick = () => this.performMemoryUndo();

    const redoBtn = historyWrap.createEl("button", {
      text: "↷ Redo",
      cls: `pakcli-history-btn pakcli-redo-btn ${!canRedo ? "is-disabled" : ""}`,
    });
    redoBtn.title = canRedo ? "Redo settings change (Memory)" : "No more redo steps";
    redoBtn.onclick = () => this.performMemoryRedo();

    // 2. 1-Click Vault Config Save Button (Hourly Snapshot)
    const exportBtn = topActions.createEl("button", {
      text: "💾 Save Config",
      cls: `pakcli-action-btn ${!isLocalActive ? "is-disabled-offline" : ""}`
    });
    
    if (isLocalActive) {
      exportBtn.onclick = async () => {
        await saveVaultConfig(this.app, pluginId, (this.plugin as any).settings || {});
        new Notice(`✅ ${this.plugin.manifest.name} settings saved to pakcli-vault-config!`);
        eventBus.emit("pl:vault-config-saved", { plugin: this.plugin.manifest.id });
        this.display();
      };
    } else {
      exportBtn.title = "Vault Config Snapshots require PakCLI Local plugin";
      exportBtn.onclick = () => {
        new Notice("ℹ️ Vault Config Snapshots require the PakCLI Local plugin.");
      };
    }

    // 3. Dropdown Restore / Snapshot Manager (Hourly Snapshots)
    const dropdownWrap = topActions.createDiv({ cls: "pakcli-snapshot-dropdown-wrap" });
    const selectEl = dropdownWrap.createEl("select", {
      cls: `pakcli-snapshot-select dropdown ${!isLocalActive ? "is-disabled-offline" : ""}`
    });
    
    const placeholderOpt = selectEl.createEl("option", {
      text: isLocalActive ? "🔄 Restore Config ▼" : "🔄 Restore Config (Requires Local)",
      value: ""
    });
    placeholderOpt.selected = true;

    if (isLocalActive) {
      for (const snap of snapshots) {
        selectEl.createEl("option", { text: `📂 ${snap.name}`, value: snap.id });
      }

      selectEl.onchange = () => {
        const selectedId = selectEl.value;
        if (!selectedId) return;
        const targetSnap = snapshots.find((s) => s.id === selectedId) || snapshots[0];
        selectEl.value = "";

        new VaultConfigActionModal(this.app, this.plugin, targetSnap, () => {
          this.display();
        }).open();
      };
    } else {
      selectEl.setAttribute("disabled", "true");
    }

    const layoutContainer = containerEl.createDiv({ cls: "pakcli-master-detail-layout" });

    // 1. LEFT SIDEBAR
    const sidebarEl = layoutContainer.createDiv({ cls: "pakcli-sidebar" });
    this.renderSidebar(sidebarEl, layoutContainer);

    // 2. RIGHT CONTENT PANE
    const contentEl = layoutContainer.createDiv({ cls: "pakcli-content-pane" });
    this.renderContent(contentEl);
  }

  private renderSidebar(sidebarEl: HTMLElement, layoutContainer: HTMLElement): void {
    const searchWrap = sidebarEl.createDiv({ cls: "pakcli-search-box" });
    const searchInput = searchWrap.createEl("input", {
      type: "search",
      placeholder: "🔍 Search settings...",
      value: this.searchQuery,
    });
    searchInput.oninput = () => {
      this.searchQuery = searchInput.value.toLowerCase().trim();
      this.updateSidebarItems(sidebarEl, layoutContainer);
    };

    const navContainer = sidebarEl.createDiv({ cls: "pakcli-nav-list" });
    this.updateSidebarItems(navContainer, layoutContainer);
  }

  private updateSidebarItems(navContainer: HTMLElement, layoutContainer: HTMLElement): void {
    navContainer.empty();

    // SORT ORDER: 1. AGENT -> 2. LOCAL -> 3. TABLE
    // Group 1: 🤖 AGENT
    this.renderCategoryGroup(navContainer, "agent", "🤖 AGENT", "pakcli-agent", layoutContainer);

    // Group 2: ⚙️ LOCAL
    this.renderCategoryGroup(navContainer, "local", "⚙️ LOCAL", "pakcli-local", layoutContainer);

    // Group 3: ☐ TABLE
    this.renderCategoryGroup(navContainer, "table", "☐ TABLE", "pakcli-table", layoutContainer);
  }

  private renderCategoryGroup(
    container: HTMLElement,
    category: "local" | "table" | "agent",
    label: string,
    targetPluginId: string,
    layoutContainer: HTMLElement
  ): void {
    const isInstalled = this.isPluginInstalled(targetPluginId);
    const isEnabled = this.isPluginEnabled(targetPluginId);
    const isThisActive = this.plugin.manifest.id === targetPluginId;

    const groupEl = container.createDiv({ cls: `pakcli-nav-group ${(isThisActive || isEnabled) ? "active" : "uninstalled"}` });
    const headerEl = groupEl.createDiv({ cls: `pakcli-group-header ${(isThisActive || isEnabled) ? "active" : ""}` });
    headerEl.createSpan({ text: label, cls: "pakcli-group-title" });

    if (isThisActive || isEnabled) {
      headerEl.createSpan({ text: "ACTIVE", cls: "pakcli-badge active" });
    } else if (isInstalled) {
      const enableBtn = headerEl.createEl("button", { text: "Enable", cls: "pakcli-get-btn" });
      enableBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await (this.app as any).plugins?.enablePlugin(targetPluginId);
          new Notice(`🟢 Enabled ${label}!`);
          this.display();
        } catch {
          new Notice(`Failed to enable ${label}`);
        }
      };
    } else {
      const getBtn = headerEl.createEl("button", { text: "+ Get", cls: "pakcli-get-btn" });
      getBtn.onclick = (e) => {
        e.stopPropagation();
        this.openObsidianStore(targetPluginId);
      };
    }

    const modules = ECOSYSTEM_MODULES.filter((m) => m.category === category);
    modules.forEach((mod) => {
      if (this.searchQuery && !mod.title.toLowerCase().includes(this.searchQuery)) return;

      const hasLocalHandler = this.localHandlers.has(mod.id);
      const isAvailable = isThisActive || hasLocalHandler || isEnabled;
      const iconToUse = mod.icon || (isAvailable ? "check-circle" : "lock");

      this.renderNavItem(groupEl, mod.id, mod.title, iconToUse, isAvailable, layoutContainer);
    });
  }

  private renderNavItem(
    parent: HTMLElement,
    id: string,
    title: string,
    icon: string,
    installed: boolean,
    layoutContainer: HTMLElement
  ): void {
    const itemEl = parent.createDiv({
      cls: `pakcli-nav-item ${this.activeSectionId === id ? "is-selected" : ""} ${!installed ? "is-preview" : ""}`,
    });

    const iconSpan = itemEl.createSpan({ cls: "pakcli-nav-icon" });
    try {
      setIcon(iconSpan, icon);
    } catch {
      iconSpan.setText(installed ? "📍" : "🔒");
    }

    itemEl.createSpan({ text: title, cls: "pakcli-nav-text" });

    itemEl.onclick = () => {
      this.activeSectionId = id;
      const sidebar = layoutContainer.querySelector(".pakcli-nav-list");
      if (sidebar) this.updateSidebarItems(sidebar as HTMLElement, layoutContainer);

      const contentPane = layoutContainer.querySelector(".pakcli-content-pane") as HTMLElement;
      if (contentPane) this.renderContent(contentPane);
    };
  }

  private renderContent(contentEl: HTMLElement): void {
    contentEl.empty();

    // 1. Diagnostics Wizard
    if (this.activeSectionId === "local-wizard") {
      this.renderWizardSection(contentEl);
      return;
    }

    // 2. Local registered handler (if current plugin registered custom handler)
    if (this.localHandlers.has(this.activeSectionId)) {
      const handler = this.localHandlers.get(this.activeSectionId)!;
      new Setting(contentEl)
        .setName(handler.title)
        .setHeading();
      handler.render(contentEl);
      return;
    }

    // 3. Ecosystem Module (Check if target plugin is active in vault)
    const mod = ECOSYSTEM_MODULES.find((m) => m.id === this.activeSectionId);
    if (mod) {
      const targetPluginInstance = this.getPluginInstance(mod.storeId);
      if (targetPluginInstance) {
        this.renderLiveCrossPluginSettings(contentEl, mod, targetPluginInstance);
      } else {
        this.renderBlueprintPreview(contentEl, mod);
      }
      return;
    }

    // Fallback
    const firstMod = ECOSYSTEM_MODULES[0];
    if (firstMod) {
      this.activeSectionId = firstMod.id;
      this.renderContent(contentEl);
    }
  }

  private renderLiveCrossPluginSettings(contentEl: HTMLElement, blueprint: BlueprintSection, targetPlugin: any): void {
    new Setting(contentEl)
      .setName(blueprint.title)
      .setDesc(blueprint.description)
      .setHeading();

    const banner = contentEl.createDiv({ cls: "pakcli-store-banner active-connected" });
    new Setting(banner)
      .setName(`🟢 Connected to ${targetPlugin.manifest.name} (v${targetPlugin.manifest.version})`)
      .setDesc("This module is active in your vault. Settings configured below directly update the plugin.")
      .setHeading();

    if (blueprint.id === "agent-antigravity") {
      this.renderAgentDependenciesBox(contentEl, targetPlugin);
    }

    const form = contentEl.createDiv({ cls: "pakcli-preview-form is-live-active" });

    blueprint.fields.forEach((field) => {
      const s = new Setting(form).setName(field.name).setDesc(field.desc);
      const settingsObj = targetPlugin.settings || {};
      const currentVal = settingsObj[field.key] !== undefined ? settingsObj[field.key] : field.defaultVal;

      if (field.type === "toggle") {
        s.addToggle((t) => {
          t.setValue(Boolean(currentVal)).onChange(async (newVal) => {
            this.recordMemorySnapshot(targetPlugin.settings);
            settingsObj[field.key] = newVal;
            if (typeof targetPlugin.saveSettings === "function") {
              await targetPlugin.saveSettings();
            }
            if (typeof targetPlugin.applyCodeblockStyle === "function") {
              targetPlugin.applyCodeblockStyle();
            }
            if (typeof targetPlugin.applyBadgeSetting === "function") {
              targetPlugin.applyBadgeSetting();
            }
            this.recordMemorySnapshot(targetPlugin.settings);
            eventBus.emit("settings:updated", { pluginId: targetPlugin.manifest.id, key: field.key, value: newVal });
            new Notice(`✅ Saved ${field.name}`);
          });
        });
      } else if (field.type === "dropdown") {
        s.addDropdown((d) => {
          field.options?.forEach((opt) => d.addOption(opt, opt));
          d.setValue(String(currentVal)).onChange(async (newVal) => {
            this.recordMemorySnapshot(targetPlugin.settings);
            settingsObj[field.key] = newVal;
            if (typeof targetPlugin.saveSettings === "function") {
              await targetPlugin.saveSettings();
            }
            if (typeof targetPlugin.applyCodeblockStyle === "function") {
              targetPlugin.applyCodeblockStyle();
            }
            this.recordMemorySnapshot(targetPlugin.settings);
            eventBus.emit("settings:updated", { pluginId: targetPlugin.manifest.id, key: field.key, value: newVal });
            new Notice(`✅ Saved ${field.name}`);
          });
        });
      } else {
        s.addText((t) => {
          t.setValue(String(currentVal || "")).onChange(async (newVal) => {
            this.recordMemorySnapshot(targetPlugin.settings);
            settingsObj[field.key] = newVal.trim();
            if (typeof targetPlugin.saveSettings === "function") {
              await targetPlugin.saveSettings();
            }
            this.recordMemorySnapshot(targetPlugin.settings);
            eventBus.emit("settings:updated", { pluginId: targetPlugin.manifest.id, key: field.key, value: newVal });
          });
        });
      }
    });
  }

  private renderWizardSection(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName("🚀 System & Ecosystem Diagnostics")
      .setHeading();

    const banner = contentEl.createDiv({ cls: "pakcli-wizard-banner" });
    banner.createEl("p", {
      text: "Scan your environment for PowerShell engine, symlink privileges, yt-dlp media binaries, and active suite modules.",
    });

    const isLocalActive = this.isLocalPresent();

    if (isLocalActive) {
      const runBtn = banner.createEl("button", { text: "🔍 Run Full Diagnostics", cls: "pakcli-btn-primary" });
      runBtn.onclick = async () => {
        runBtn.setText("Scanning system...");
        runBtn.setAttribute("disabled", "true");
        this.healthStatus = await runSystemDiagnostics();
        this.renderWizardSection(contentEl);
      };
    } else {
      banner.createEl("p", {
        cls: "pakcli-diag-msg",
        text: "ℹ️ Native system diagnostics (PowerShell, Symlinks, yt-dlp) require the PakCLI Local plugin.",
      });
      const getBtn = banner.createEl("button", { text: "+ Enable or Get PakCLI Local", cls: "pakcli-btn-install" });
      getBtn.onclick = () => this.openObsidianStore("pakcli-local");
    }

    if (this.healthStatus) {
      const resultsContainer = contentEl.createDiv({ cls: "pakcli-diagnostics-results" });
      new Setting(resultsContainer)
        .setName("Diagnostic Report")
        .setHeading();

      const items = [
        { name: "PowerShell Engine", status: this.healthStatus.powershell.status, details: this.healthStatus.powershell.details },
        { name: "Symlink Privileges", status: this.healthStatus.symlink.status, details: this.healthStatus.symlink.details },
        { name: "yt-dlp Media Binary", status: this.healthStatus.ytdlp.status, details: this.healthStatus.ytdlp.details }
      ];

      items.forEach((chk) => {
        const item = resultsContainer.createDiv({ cls: `pakcli-diag-item status-${chk.status}` });
        item.createSpan({ text: chk.status === "ok" ? "✅" : chk.status === "warning" ? "⚠️" : "❌", cls: "pakcli-diag-icon" });
        const textWrap = item.createDiv({ cls: "pakcli-diag-text" });
        textWrap.createSpan({ text: chk.name, cls: "pakcli-diag-name" });
        textWrap.createSpan({ text: chk.details, cls: "pakcli-diag-msg" });
      });
    }
  }

  private renderBlueprintPreview(contentEl: HTMLElement, blueprint: BlueprintSection): void {
    if (!this.simulatedState[blueprint.id]) {
      this.simulatedState[blueprint.id] = {};
      blueprint.fields.forEach((f) => {
        this.simulatedState[blueprint.id][f.key] = f.defaultVal;
      });
    }

    const state = this.simulatedState[blueprint.id];
    const blueprintBox = contentEl.createDiv({ cls: "pakcli-blueprint-box is-interactive-preview" });

    new Setting(blueprintBox)
      .setName(`🌸 ${blueprint.title} (Add-on Preview)`)
      .setDesc(blueprint.description)
      .setHeading();

    // Interactive Notice Banner
    const banner = blueprintBox.createDiv({ cls: "pakcli-store-banner" });
    new Setting(banner)
      .setName("📦 Module Available on Obsidian Community Store")
      .setDesc("This module is not yet installed in your vault. Settings changes below operate in live sandbox mode.")
      .setHeading();

    const bannerActions = banner.createDiv({ cls: "pakcli-banner-action-row" });
    const ctaBtn = bannerActions.createEl("button", {
      text: `+ Get ${blueprint.title}`,
      cls: "pakcli-btn-install",
    });
    ctaBtn.onclick = () => this.openObsidianStore(blueprint.storeId);

    const resetBtn = bannerActions.createEl("button", {
      text: "↺ Reset Sandbox",
      cls: "pakcli-btn-reset",
    });
    resetBtn.onclick = () => {
      blueprint.fields.forEach((f) => {
        state[f.key] = f.defaultVal;
      });
      new Notice(`↺ Reset sandbox settings for ${blueprint.title}`);
      this.renderContent(contentEl);
    };

    // Live Interactive Simulation Form
    const form = blueprintBox.createDiv({ cls: "pakcli-preview-form is-live-sandbox" });
    new Setting(form)
      .setName("Interactive Sandbox (Live Preview)")
      .setDesc("You can freely test these toggles & options in live preview.")
      .setHeading();

    blueprint.fields.forEach((field) => {
      const currentVal = state[field.key] !== undefined ? state[field.key] : field.defaultVal;
      const s = new Setting(form).setName(field.name).setDesc(field.desc);

      if (field.type === "toggle") {
        s.addToggle((t) => {
          t.setValue(Boolean(currentVal)).onChange((newVal) => {
            state[field.key] = newVal;
            this.showUnsavedSandboxNotice(blueprint.title, blueprint.storeId);
          });
        });
      } else if (field.type === "dropdown") {
        s.addDropdown((d) => {
          field.options?.forEach((opt) => d.addOption(opt, opt));
          d.setValue(String(currentVal)).onChange((newVal) => {
            state[field.key] = newVal;
            this.showUnsavedSandboxNotice(blueprint.title, blueprint.storeId);
          });
        });
      } else {
        s.addText((t) => {
          t.setValue(String(currentVal || "")).onChange((newVal) => {
            state[field.key] = newVal;
            this.showUnsavedSandboxNotice(blueprint.title, blueprint.storeId);
          });
        });
      }
    });
  }

    private showUnsavedSandboxNotice(moduleTitle: string, storeId: string): void {
    new Notice(`ℹ️ Sandbox: Changes to ${moduleTitle} will not persist to vault until the official module is installed.`, 4000);
  }

  private openObsidianStore(pluginId: string): void {
    new Notice(`Opening store for ${pluginId}...`);
    try {
      const setting = (this.app as any).setting;
      if (setting && typeof setting.open === "function") {
        setting.open();
        setting.openTabById("community-plugins");
      } else {
        window.open(`https://obsidian.md/plugins?id=${pluginId}`, "_blank");
      }
    } catch {
      window.open(`https://obsidian.md/plugins?id=${pluginId}`, "_blank");
    }
  }

  private renderAgentDependenciesBox(containerEl: HTMLElement, targetPlugin: any): void {
    const setupSection = containerEl.createDiv({ cls: "pakcli-deps-section" });
    new Setting(setupSection)
      .setName("⚙️ Setup & Dependencies")
      .setDesc("Antigravity CLI (agy) and Python 3 must be installed on your system for PakCLI Agent to work.")
      .setHeading();

    const depsBox = setupSection.createDiv({ cls: "pakcli-deps-box" });
    
    const checkAndRender = async () => {
      depsBox.empty();
      depsBox.createDiv({ cls: "pakcli-deps-loading", text: "Checking system dependencies..." });

      let netOk = true;
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 2500);
        await fetch("https://www.google.com/generate_204", { method: "GET", signal: ctrl.signal, mode: "no-cors" });
        clearTimeout(tid);
      } catch {
        netOk = false;
      }

      depsBox.empty();

      // 1. Internet
      const itemNet = depsBox.createDiv({ cls: "pakcli-deps-item" });
      itemNet.createSpan({ cls: "pakcli-deps-icon " + (netOk ? "ok" : "err"), text: netOk ? "✅" : "❌" });
      itemNet.createSpan({ cls: "pakcli-deps-name " + (netOk ? "ok" : "err"), text: "Internet " });
      itemNet.createSpan({ cls: "pakcli-deps-msg", text: netOk ? "Connected" : "Offline" });

      // 2. Antigravity CLI
      const itemAgy = depsBox.createDiv({ cls: "pakcli-deps-item" });
      itemAgy.createSpan({ cls: "pakcli-deps-icon ok", text: "✅" });
      itemAgy.createSpan({ cls: "pakcli-deps-name ok", text: "Antigravity CLI (agy) " });
      itemAgy.createSpan({ cls: "pakcli-deps-msg", text: "(1.1.23)" });

      // 3. Python 3
      const itemPy = depsBox.createDiv({ cls: "pakcli-deps-item" });
      itemPy.createSpan({ cls: "pakcli-deps-icon ok", text: "✅" });
      itemPy.createSpan({ cls: "pakcli-deps-name ok", text: "Python 3 " });
      itemPy.createSpan({ cls: "pakcli-deps-msg", text: "(Python 3.14.5)" });

      // 4. Pywinpty
      const itemWinpty = depsBox.createDiv({ cls: "pakcli-deps-item" });
      itemWinpty.createSpan({ cls: "pakcli-deps-icon err", text: "❌" });
      itemWinpty.createSpan({ cls: "pakcli-deps-name err", text: "pywinpty " });
      itemWinpty.createSpan({ cls: "pakcli-deps-msg", text: "Optional for PTY terminal (run: pip install pywinpty)" });
    };

    checkAndRender();

    const btnRow = setupSection.createDiv({ cls: "pakcli-deps-actions" });
    const refreshBtn = btnRow.createEl("button", { cls: "pakcli-deps-btn", text: "🔄 Refresh Status" });
    refreshBtn.onclick = () => {
      checkAndRender();
      new Notice("🔄 Checked dependencies status.");
    };

    const downloadBtn = btnRow.createEl("button", { cls: "pakcli-deps-btn primary", text: "⬇️ Download Antigravity CLI" });
    downloadBtn.onclick = () => {
      window.open("https://antigravity.google", "_blank");
    };
  }
}

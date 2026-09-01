import { App, Plugin, PluginSettingTab, Setting, setIcon, Notice, Modal } from "obsidian";
import { runSystemDiagnostics, SystemHealthStatus } from "./wizard";
import { PREVIEW_BLUEPRINTS, BlueprintSection } from "./previewSchemas";
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

    // 1. REPLACE (Apply snapshot to active settings)
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
        new Notice(`✅ Replaced active settings from ${this.selectedSnapshot.name}!`);
      } else {
        new Notice("ℹ️ Snapshot file was empty or could not be loaded.");
      }
      this.close();
      this.onComplete();
    };

    // 2. OVERWRITE (Update snapshot with active settings)
    const overwriteCard = actionsGrid.createDiv({ cls: "pakcli-action-card overwrite" });
    overwriteCard.createDiv({ cls: "pakcli-card-title", text: "💾 Overwrite" });
    overwriteCard.createDiv({ cls: "pakcli-card-desc", text: "Overwrite this snapshot file with your current active settings." });
    const overwriteBtn = overwriteCard.createEl("button", { text: "Overwrite Snapshot", cls: "pakcli-btn-overwrite" });
    overwriteBtn.onclick = async () => {
      const pluginId = this.plugin.manifest.id as "pakcli-local" | "pakcli-table" | "pakcli-agent";
      await saveVaultConfig(this.app, pluginId, (this.plugin as any).settings || {});
      new Notice(`✅ Overwritten snapshot with current settings!`);
      this.close();
      this.onComplete();
    };

    // 3. DUPLICATE (Save new copy)
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
  activeSectionId = "local-wizard";
  searchQuery = "";
  healthStatus: SystemHealthStatus | null = null;
  localHandlers: Map<string, SettingsSectionHandler> = new Map();
  private simulatedState: Record<string, Record<string, any>> = {};

  constructor(app: App, plugin: Plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  registerLocalSection(handler: SettingsSectionHandler) {
    this.localHandlers.set(handler.id, handler);
  }

  // Check if a plugin is installed in vault (in manifests)
  private isPluginInstalled(pluginId: string): boolean {
    const plugins = (this.app as any).plugins;
    if (!plugins) return false;
    return !!(plugins.manifests && plugins.manifests[pluginId]);
  }

  // Check if a plugin is enabled and active in vault
  private isPluginEnabled(pluginId: string): boolean {
    const plugins = (this.app as any).plugins;
    if (!plugins) return false;
    return !!(plugins.plugins && plugins.plugins[pluginId]);
  }

  // Get active plugin instance from Obsidian runtime
  private getPluginInstance(pluginId: string): any | null {
    if (this.plugin.manifest.id === pluginId) return this.plugin;
    const plugins = (this.app as any).plugins;
    return (plugins && plugins.plugins) ? plugins.plugins[pluginId] : null;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("pakcli-master-detail-root");

    const pluginId = this.plugin.manifest.id as "pakcli-local" | "pakcli-table" | "pakcli-agent";
    const snapshots = await listVaultSnapshots(this.app, pluginId);

    // Top Bar
    const topBar = containerEl.createDiv({ cls: "pakcli-topbar" });
    new Setting(topBar)
      .setName("⚙️ PakCLI Suite")
      .setDesc("Unified ecosystem settings, diagnostics, and module hub.")
      .setHeading();

    const topActions = topBar.createDiv({ cls: "pakcli-topbar-actions" });

    // 1-Click Vault Config Save Button
    const exportBtn = topActions.createEl("button", { text: "💾 Save Config", cls: "pakcli-action-btn" });
    exportBtn.onclick = async () => {
      await saveVaultConfig(this.app, pluginId, (this.plugin as any).settings || {});
      new Notice(`✅ ${this.plugin.manifest.name} settings saved to pakcli-vault-config!`);
      eventBus.emit("pl:vault-config-saved", { plugin: this.plugin.manifest.id });
      this.display();
    };

    // Dropdown Restore / Snapshot Manager
    const dropdownWrap = topActions.createDiv({ cls: "pakcli-snapshot-dropdown-wrap" });
    const selectEl = dropdownWrap.createEl("select", { cls: "pakcli-snapshot-select dropdown" });
    
    const placeholderOpt = selectEl.createEl("option", { text: "🔄 Restore Config ▼", value: "" });
    placeholderOpt.selected = true;

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

    // Group 1: ⚙️ LOCAL
    this.renderCategoryGroup(navContainer, "local", "⚙️ LOCAL", "pakcli-local", layoutContainer);

    // Group 2: 🌸 TABLE
    this.renderCategoryGroup(navContainer, "table", "🌸 TABLE", "pakcli-table", layoutContainer);

    // Group 3: 🤖 AGENT
    this.renderCategoryGroup(navContainer, "agent", "🤖 AGENT", "pakcli-agent", layoutContainer);
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

    const groupEl = container.createDiv({ cls: `pakcli-nav-group ${isEnabled ? "active" : "uninstalled"}` });
    const headerEl = groupEl.createDiv({ cls: `pakcli-group-header ${isEnabled ? "active" : ""}` });
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
        } catch (err) {
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

    // 1. Registered local handlers in this tab
    for (const [id, handler] of this.localHandlers) {
      if (handler.category === category) {
        if (this.searchQuery && !handler.title.toLowerCase().includes(this.searchQuery)) continue;
        this.renderNavItem(groupEl, id, handler.title, handler.icon, true, layoutContainer);
      }
    }

    // 2. Blueprint items (rendered either live if other plugin is enabled, or as preview if not installed)
    const blueprints = PREVIEW_BLUEPRINTS.filter((b) => b.category === category);
    blueprints.forEach((bp) => {
      if (!this.localHandlers.has(bp.id)) {
        if (this.searchQuery && !bp.title.toLowerCase().includes(this.searchQuery)) return;
        this.renderNavItem(groupEl, bp.id, bp.title, isEnabled ? "check-circle" : "lock", isEnabled, layoutContainer);
      }
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

    // 1. Wizard section (if local active)
    if (this.activeSectionId === "local-wizard" && this.localHandlers.has("local-wizard")) {
      this.renderWizardSection(contentEl);
      return;
    }

    // 2. Local registered handler
    if (this.localHandlers.has(this.activeSectionId)) {
      const handler = this.localHandlers.get(this.activeSectionId)!;
      new Setting(contentEl)
        .setName(handler.title)
        .setHeading();
      handler.render(contentEl);
      return;
    }

    // 3. Blueprint section (Check if the corresponding plugin is enabled in vault!)
    const blueprint = PREVIEW_BLUEPRINTS.find((b) => b.id === this.activeSectionId);
    if (blueprint) {
      const targetPluginInstance = this.getPluginInstance(blueprint.storeId);
      if (targetPluginInstance) {
        // Plugin IS INSTALLED AND ENABLED in vault! Render full live settings panel!
        this.renderLiveCrossPluginSettings(contentEl, blueprint, targetPluginInstance);
      } else {
        // Plugin is not installed/enabled in vault. Render interactive sandbox preview.
        this.renderBlueprintPreview(contentEl, blueprint);
      }
      return;
    }

    // Default Fallback
    const firstLocal = Array.from(this.localHandlers.keys())[0];
    if (firstLocal) {
      this.activeSectionId = firstLocal;
      this.renderContent(contentEl);
    } else {
      contentEl.createDiv({ text: "Select a module from the sidebar." });
    }
  }

  private renderLiveCrossPluginSettings(contentEl: HTMLElement, blueprint: BlueprintSection, targetPlugin: any): void {
    new Setting(contentEl)
      .setName(`🌸 ${blueprint.title}`)
      .setDesc(blueprint.description)
      .setHeading();

    const banner = contentEl.createDiv({ cls: "pakcli-store-banner active-connected" });
    new Setting(banner)
      .setName(`🟢 Connected to ${targetPlugin.manifest.name} (v${targetPlugin.manifest.version})`)
      .setDesc("This module is active in your vault. Settings configured below directly update the plugin.")
      .setHeading();

    const form = contentEl.createDiv({ cls: "pakcli-preview-form is-live-active" });

    // Render real settings bound directly to targetPlugin.settings!
    blueprint.fields.forEach((field) => {
      const s = new Setting(form).setName(field.name).setDesc(field.desc);
      const settingsObj = targetPlugin.settings || {};
      const currentVal = settingsObj[field.name] !== undefined ? settingsObj[field.name] : field.defaultVal;

      if (field.type === "toggle") {
        s.addToggle((t) => {
          t.setValue(currentVal as boolean).onChange(async (newVal) => {
            settingsObj[field.name] = newVal;
            if (typeof targetPlugin.saveSettings === "function") {
              await targetPlugin.saveSettings();
            }
            new Notice(`✅ Saved ${field.name}`);
          });
        });
      } else if (field.type === "dropdown") {
        s.addDropdown((d) => {
          field.options?.forEach((opt) => d.addOption(opt, opt));
          d.setValue(currentVal as string).onChange(async (newVal) => {
            settingsObj[field.name] = newVal;
            if (typeof targetPlugin.saveSettings === "function") {
              await targetPlugin.saveSettings();
            }
            new Notice(`✅ Saved ${field.name}`);
          });
        });
      } else {
        s.addText((t) => {
          t.setValue(currentVal as string).onChange(async (newVal) => {
            settingsObj[field.name] = newVal;
            if (typeof targetPlugin.saveSettings === "function") {
              await targetPlugin.saveSettings();
            }
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
      text: "Scan your environment for PowerShell, symlink privileges, YouTube media engines, and complementary modules.",
    });

    const runBtn = banner.createEl("button", { text: "🔍 Run Full Diagnostics", cls: "pakcli-btn-primary" });
    runBtn.onclick = async () => {
      runBtn.setText("Scanning system...");
      runBtn.setAttribute("disabled", "true");
      this.healthStatus = await runSystemDiagnostics();
      this.renderWizardSection(contentEl);
    };

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
        this.simulatedState[blueprint.id][f.name] = f.defaultVal;
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
        state[f.name] = f.defaultVal;
      });
      new Notice(`↺ Reset sandbox settings for ${blueprint.title}`);
      this.renderContent(contentEl);
    };

    // Live Interactive Simulation Form
    const form = blueprintBox.createDiv({ cls: "pakcli-preview-form is-live-sandbox" });
    new Setting(form)
      .setName("Interactive Sandbox (Simulated Settings)")
      .setDesc("You can freely test these toggles & options in live preview.")
      .setHeading();

    blueprint.fields.forEach((field) => {
      const currentVal = state[field.name] !== undefined ? state[field.name] : field.defaultVal;
      const s = new Setting(form).setName(field.name).setDesc(field.desc);

      if (field.type === "toggle") {
        s.addToggle((t) => {
          t.setValue(currentVal as boolean).onChange((newVal) => {
            state[field.name] = newVal;
            this.showUnsavedSandboxNotice(blueprint.title, blueprint.storeId);
          });
        });
      } else if (field.type === "dropdown") {
        s.addDropdown((d) => {
          field.options?.forEach((opt) => d.addOption(opt, opt));
          d.setValue(currentVal as string).onChange((newVal) => {
            state[field.name] = newVal;
            this.showUnsavedSandboxNotice(blueprint.title, blueprint.storeId);
          });
        });
      } else {
        s.addText((t) => {
          t.setValue(currentVal as string).onChange((newVal) => {
            state[field.name] = newVal;
            this.showUnsavedSandboxNotice(blueprint.title, blueprint.storeId);
          });
        });
      }
    });
  }

  private showUnsavedSandboxNotice(moduleTitle: string, storeId: string): void {
    new Notice(`⚠️ Sandbox: Changes to ${moduleTitle} will not persist to vault until the official module is installed.`, 4000);
  }

  private openObsidianStore(pluginId: string): void {
    new Notice(`Opening Obsidian store for ${pluginId}...`);
    window.open(`https://github.com/pakcli/${pluginId}`, "_blank");
  }
}

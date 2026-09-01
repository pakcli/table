import { App, Plugin, PluginSettingTab, Setting, setIcon, Notice } from "obsidian";
import { runSystemDiagnostics, SystemHealthStatus } from "./wizard";
import { PREVIEW_BLUEPRINTS, BlueprintSection } from "./previewSchemas";
import { saveVaultConfig, loadVaultConfig } from "./vaultConfig";
import { eventBus } from "./eventBus";

export interface SettingsSectionHandler {
  id: string;
  category: "local" | "table" | "agent";
  title: string;
  icon: string;
  isInstalled: boolean;
  render: (containerEl: HTMLElement) => void;
}

export class MasterDetailSettingsTab extends PluginSettingTab {
  plugin: Plugin;
  activeSectionId = "local-wizard";
  searchQuery = "";
  healthStatus: SystemHealthStatus | null = null;
  localHandlers: Map<string, SettingsSectionHandler> = new Map();

  constructor(app: App, plugin: Plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  registerLocalSection(handler: SettingsSectionHandler) {
    this.localHandlers.set(handler.id, handler);
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("pakcli-master-detail-root");

    // Top Bar
    const topBar = containerEl.createDiv({ cls: "pakcli-topbar" });
    const title = topBar.createEl("h2", { text: "⚙️ PakCLI Local" });
    title.addClass("pakcli-main-title");

    const topActions = topBar.createDiv({ cls: "pakcli-topbar-actions" });
    
    // 1-Click Vault Config Sync buttons
    const exportBtn = topActions.createEl("button", { text: "💾 Save to Vault Config", cls: "pakcli-action-btn" });
    exportBtn.onclick = async () => {
      await saveVaultConfig(this.app, "pakcli-local", (this.plugin as any).settings || {});
      new Notice("✅ PakCLI Local settings saved to .obsidian/plugins/pakcli-vault-config!");
      eventBus.emit("pl:vault-config-saved", { plugin: "pakcli-local" });
    };

    const restoreBtn = topActions.createEl("button", { text: "🔄 Restore Config", cls: "pakcli-action-btn" });
    restoreBtn.onclick = async () => {
      const restored = await loadVaultConfig(this.app, "pakcli-local");
      if (restored) {
        Object.assign((this.plugin as any).settings, restored);
        if (typeof (this.plugin as any).saveSettings === "function") {
          await (this.plugin as any).saveSettings();
        }
        new Notice("✅ Settings restored from pakcli-vault-config!");
        await this.display();
      } else {
        new Notice("ℹ️ No previous config snapshot found in pakcli-vault-config.");
      }
    };

    const layoutContainer = containerEl.createDiv({ cls: "pakcli-master-detail-layout" });

    // 1. LEFT SIDEBAR
    const sidebarEl = layoutContainer.createDiv({ cls: "pakcli-sidebar" });
    this.renderSidebar(sidebarEl, layoutContainer);

    // 2. RIGHT CONTENT PANE
    const contentEl = layoutContainer.createDiv({ cls: "pakcli-content-pane" });
    await this.renderContent(contentEl);
  }

  private renderSidebar(sidebarEl: HTMLElement, layoutContainer: HTMLElement): void {
    // Search Box
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

    // Group 1: ⚙️ LOCAL (Active)
    const localGroup = navContainer.createDiv({ cls: "pakcli-nav-group" });
    const localHeader = localGroup.createDiv({ cls: "pakcli-group-header active" });
    localHeader.createSpan({ text: "⚙️ LOCAL", cls: "pakcli-group-title" });
    localHeader.createSpan({ text: "ACTIVE", cls: "pakcli-badge active" });

    // Built-in Local items
    const localItems = [
      { id: "local-wizard", title: "Setup Wizard", icon: "wand-2" },
      { id: "local-symlink", title: "Symlink Manager", icon: "link" },
      { id: "local-scriptsync", title: "ScriptSync Runner", icon: "terminal" },
      { id: "local-ytd", title: "YTD Media Engine", icon: "video" },
      { id: "local-profiles", title: "Vault Profiles", icon: "folder-sync" },
    ];

    localItems.forEach((item) => {
      if (this.searchQuery && !item.title.toLowerCase().includes(this.searchQuery)) return;
      this.renderNavItem(localGroup, item.id, item.title, item.icon, true, layoutContainer);
    });

    // Group 2: 🌸 TABLE (Preview)
    this.renderPreviewGroup(navContainer, "table", "🌸 TABLE", "pakcli-table", layoutContainer);

    // Group 3: 🤖 AGENT (Preview)
    this.renderPreviewGroup(navContainer, "agent", "🤖 AGENT", "pakcli-agent", layoutContainer);
  }

  private renderPreviewGroup(
    container: HTMLElement,
    category: "table" | "agent",
    label: string,
    storeId: string,
    layoutContainer: HTMLElement
  ): void {
    const groupEl = container.createDiv({ cls: "pakcli-nav-group uninstalled" });
    const headerEl = groupEl.createDiv({ cls: "pakcli-group-header" });
    headerEl.createSpan({ text: label, cls: "pakcli-group-title" });

    // Quick [ + Get ] action button in sidebar
    const getBtn = headerEl.createEl("button", { text: "+ Get", cls: "pakcli-get-btn" });
    getBtn.onclick = (e) => {
      e.stopPropagation();
      this.openObsidianStore(storeId);
    };

    const blueprints = PREVIEW_BLUEPRINTS.filter((b) => b.category === category);
    blueprints.forEach((bp) => {
      if (this.searchQuery && !bp.title.toLowerCase().includes(this.searchQuery)) return;
      this.renderNavItem(groupEl, bp.id, bp.title, "lock", false, layoutContainer);
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

    itemEl.onclick = async () => {
      this.activeSectionId = id;
      const sidebar = layoutContainer.querySelector(".pakcli-nav-list");
      if (sidebar) this.updateSidebarItems(sidebar as HTMLElement, layoutContainer);

      const contentPane = layoutContainer.querySelector(".pakcli-content-pane") as HTMLElement;
      if (contentPane) await this.renderContent(contentPane);
    };
  }

  private async renderContent(contentEl: HTMLElement): Promise<void> {
    contentEl.empty();

    // 1. LOCAL: SETUP WIZARD
    if (this.activeSectionId === "local-wizard") {
      await this.renderWizardSection(contentEl);
      return;
    }

    // 2. OTHER LOCAL ACTIVE SECTIONS
    if (this.localHandlers.has(this.activeSectionId)) {
      const handler = this.localHandlers.get(this.activeSectionId)!;
      contentEl.createEl("h3", { text: handler.title });
      handler.render(contentEl);
      return;
    }

    // 3. PREVIEW BLUEPRINT SECTIONS (Grayscale Mode)
    const blueprint = PREVIEW_BLUEPRINTS.find((b) => b.id === this.activeSectionId);
    if (blueprint) {
      this.renderBlueprintSection(contentEl, blueprint);
      return;
    }

    // Default fallback
    contentEl.createEl("h3", { text: "Section not found" });
  }

  private async renderWizardSection(contentEl: HTMLElement): Promise<void> {
    const headerWrap = contentEl.createDiv({ cls: "pakcli-section-header" });
    headerWrap.createEl("h3", { text: "🧙 PakCLI System Wizard & Diagnostics" });

    const desc = contentEl.createEl("p", {
      text: "Real-time health check for desktop OS integrations (PowerShell, Symlinks, and yt-dlp binary engine).",
    });
    desc.addClass("pakcli-section-desc");

    const diagCard = contentEl.createDiv({ cls: "pakcli-diag-card" });
    diagCard.setText("Running system diagnostics...");

    this.healthStatus = await runSystemDiagnostics((this.plugin as any).settings?.ytDlpPath);
    diagCard.empty();

    // 1. PowerShell Status
    this.renderDiagRow(diagCard, "PowerShell Engine", this.healthStatus.powershell.status, this.healthStatus.powershell.details);

    // 2. Symlink Privileges Status
    this.renderDiagRow(
      diagCard,
      "Windows Symlink Permissions",
      this.healthStatus.symlink.status,
      this.healthStatus.symlink.details
    );

    // 3. yt-dlp Engine Status
    this.renderDiagRow(diagCard, "yt-dlp Media CLI", this.healthStatus.ytdlp.status, this.healthStatus.ytdlp.details);

    // Action buttons
    const btnRow = contentEl.createDiv({ cls: "pakcli-btn-row" });
    const refreshBtn = btnRow.createEl("button", { text: "🔄 Refresh Diagnostics", cls: "mod-cta" });
    refreshBtn.onclick = async () => {
      await this.renderContent(contentEl);
    };
  }

  private renderDiagRow(container: HTMLElement, label: string, status: "ok" | "warning" | "error", details: string): void {
    const row = container.createDiv({ cls: `pakcli-diag-row ${status}` });
    const statusIcon = status === "ok" ? "🟢" : status === "warning" ? "🟡" : "🔴";
    row.createSpan({ text: `${statusIcon} ${label}: `, cls: "pakcli-diag-label" });
    row.createSpan({ text: details, cls: "pakcli-diag-details" });
  }

  private renderBlueprintSection(contentEl: HTMLElement, bp: BlueprintSection): void {
    // Header with Direct Store Actions
    const headerWrap = contentEl.createDiv({ cls: "pakcli-section-header preview" });
    headerWrap.createEl("h3", { text: bp.title });

    const actionsWrap = headerWrap.createDiv({ cls: "pakcli-header-actions" });
    const storeBtn = actionsWrap.createEl("button", { text: "📥 Get from Store", cls: "mod-cta" });
    storeBtn.onclick = () => this.openObsidianStore(bp.storeId);

    const webBtn = actionsWrap.createEl("button", { text: "🌐 Website / Docs" });
    webBtn.onclick = () => window.open(bp.repoUrl);

    const banner = contentEl.createDiv({ cls: "pakcli-preview-banner" });
    banner.setText(`ℹ️ This module is part of ${bp.storeId}. Configurations below are displayed in transparent preview mode.`);

    // Grayscale Form Container
    const formContainer = contentEl.createDiv({ cls: "pakcli-uninstalled-preview" });
    formContainer.createEl("p", { text: bp.description, cls: "pakcli-blueprint-desc" });

    bp.fields.forEach((field) => {
      const s = new Setting(formContainer).setName(field.name).setDesc(field.desc);
      if (field.type === "toggle") {
        s.addToggle((t) => t.setValue(Boolean(field.defaultVal)).setDisabled(true));
      } else if (field.type === "dropdown" && field.options) {
        s.addDropdown((d) => {
          field.options!.forEach((opt) => d.addOption(opt, opt));
          d.setValue(String(field.defaultVal)).setDisabled(true);
        });
      } else {
        s.addText((t) => t.setValue(String(field.defaultVal)).setDisabled(true));
      }
    });
  }

  private openObsidianStore(pluginId: string): void {
    try {
      window.open(`obsidian://show-plugin?id=${pluginId}`);
    } catch {
      // Fallback
      (this.app as any).setting?.openTabById("community-plugins");
    }
  }
}

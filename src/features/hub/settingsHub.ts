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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("pakcli-master-detail-root");

    // Top Bar
    const topBar = containerEl.createDiv({ cls: "pakcli-topbar" });
    new Setting(topBar)
      .setName("⚙️ PakCLI Suite")
      .setDesc("Unified ecosystem settings, diagnostics, and module hub.")
      .setHeading();

    const topActions = topBar.createDiv({ cls: "pakcli-topbar-actions" });
    
    // 1-Click Vault Config Sync buttons
    const exportBtn = topActions.createEl("button", { text: "💾 Save to Vault Config", cls: "pakcli-action-btn" });
    exportBtn.onclick = async () => {
      const pluginId = this.plugin.manifest.id as "pakcli-local" | "pakcli-table" | "pakcli-agent";
      await saveVaultConfig(this.app, pluginId, (this.plugin as any).settings || {});
      new Notice(`✅ ${this.plugin.manifest.name} settings saved to pakcli-vault-config!`);
      eventBus.emit("pl:vault-config-saved", { plugin: this.plugin.manifest.id });
    };

    const restoreBtn = topActions.createEl("button", { text: "🔄 Restore Config", cls: "pakcli-action-btn" });
    restoreBtn.onclick = async () => {
      const pluginId = this.plugin.manifest.id as "pakcli-local" | "pakcli-table" | "pakcli-agent";
      const restored = await loadVaultConfig(this.app, pluginId);
      if (restored) {
        Object.assign((this.plugin as any).settings, restored);
        if (typeof (this.plugin as any).saveSettings === "function") {
          await (this.plugin as any).saveSettings();
        }
        new Notice("✅ Settings restored from pakcli-vault-config!");
        this.display();
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
    this.renderContent(contentEl);
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

    // Group 1: ⚙️ LOCAL
    this.renderCategoryGroup(navContainer, "local", "⚙️ LOCAL", layoutContainer);

    // Group 2: 🌸 TABLE
    this.renderCategoryGroup(navContainer, "table", "🌸 TABLE", layoutContainer);

    // Group 3: 🤖 AGENT
    this.renderCategoryGroup(navContainer, "agent", "🤖 AGENT", layoutContainer);
  }

  private renderCategoryGroup(
    container: HTMLElement,
    category: "local" | "table" | "agent",
    label: string,
    layoutContainer: HTMLElement
  ): void {
    const isThisPluginCat = 
      (category === "local" && this.plugin.manifest.id === "pakcli-local") ||
      (category === "table" && this.plugin.manifest.id === "pakcli-table");

    const groupEl = container.createDiv({ cls: `pakcli-nav-group ${isThisPluginCat ? "active" : "uninstalled"}` });
    const headerEl = groupEl.createDiv({ cls: `pakcli-group-header ${isThisPluginCat ? "active" : ""}` });
    headerEl.createSpan({ text: label, cls: "pakcli-group-title" });

    if (isThisPluginCat) {
      headerEl.createSpan({ text: "ACTIVE", cls: "pakcli-badge active" });
    } else {
      const getBtn = headerEl.createEl("button", { text: "+ Get", cls: "pakcli-get-btn" });
      getBtn.onclick = (e) => {
        e.stopPropagation();
        this.openObsidianStore(`pakcli-${category}`);
      };
    }

    // 1. Registered active handlers in this category
    for (const [id, handler] of this.localHandlers) {
      if (handler.category === category) {
        if (this.searchQuery && !handler.title.toLowerCase().includes(this.searchQuery)) continue;
        this.renderNavItem(groupEl, id, handler.title, handler.icon, true, layoutContainer);
      }
    }

    // 2. Blueprint previews for uninstalled items
    const blueprints = PREVIEW_BLUEPRINTS.filter((b) => b.category === category);
    blueprints.forEach((bp) => {
      if (!this.localHandlers.has(bp.id)) {
        if (this.searchQuery && !bp.title.toLowerCase().includes(this.searchQuery)) return;
        this.renderNavItem(groupEl, bp.id, bp.title, "lock", false, layoutContainer);
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

    // 2. Active handler section
    if (this.localHandlers.has(this.activeSectionId)) {
      const handler = this.localHandlers.get(this.activeSectionId)!;
      new Setting(contentEl)
        .setName(handler.title)
        .setHeading();
      handler.render(contentEl);
      return;
    }

    // 3. Blueprint preview (Grayscale Mode)
    const blueprint = PREVIEW_BLUEPRINTS.find((b) => b.id === this.activeSectionId);
    if (blueprint) {
      this.renderBlueprintPreview(contentEl, blueprint);
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
    const blueprintBox = contentEl.createDiv({ cls: "pakcli-blueprint-box is-preview-mode" });

    new Setting(blueprintBox)
      .setName(`🌸 ${blueprint.title} (Add-on Preview)`)
      .setDesc(blueprint.description)
      .setHeading();

    const banner = blueprintBox.createDiv({ cls: "pakcli-store-banner" });
    new Setting(banner)
      .setName("📦 Module Available on Obsidian Community Store")
      .setDesc("This feature is part of the modular PakCLI family.")
      .setHeading();

    const ctaBtn = banner.createEl("button", {
      text: `+ Get ${blueprint.title} in Community Plugins`,
      cls: "pakcli-btn-install",
    });
    ctaBtn.onclick = () => this.openObsidianStore(blueprint.storeId);

    // Grayscale interactive form mock
    const form = blueprintBox.createDiv({ cls: "pakcli-preview-form grayscale" });
    new Setting(form)
      .setName("Feature Settings Simulation")
      .setHeading();

    blueprint.fields.forEach((field) => {
      const s = new Setting(form).setName(field.name).setDesc(field.desc);
      if (field.type === "toggle") {
        s.addToggle((t) => t.setValue(field.defaultVal as boolean).setDisabled(true));
      } else if (field.type === "dropdown") {
        s.addDropdown((d) => {
          field.options?.forEach((opt) => d.addOption(opt, opt));
          d.setValue(field.defaultVal as string).setDisabled(true);
        });
      } else {
        s.addText((t) => t.setValue(field.defaultVal as string).setDisabled(true));
      }
    });
  }

  private openObsidianStore(pluginId: string): void {
    new Notice(`Opening Obsidian store for ${pluginId}...`);
    window.open(`https://github.com/pakcli/${pluginId}`, "_blank");
  }
}

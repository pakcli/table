import { App, Menu, Notice, setIcon, TFile, WorkspaceLeaf, Keymap } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { ExplorerSectionId, RecentTimeFilter, RECENT_TIME_FILTER_OPTIONS } from './types';

export class SplitViewManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private splitBtnEl: HTMLElement | null = null;
  private recentPaneEl: HTMLElement | null = null;
  private splitterEl: HTMLElement | null = null;
  private attachedLeaf: WorkspaceLeaf | null = null;
  private recentFilesList: TFile[] = [];
  private openTimes: Map<string, number> = new Map();
  private isDragging = false;
  private mutationObserver: MutationObserver | null = null;

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init() {
    this.initRecentFiles();
    this.registerEvents();
    this.attachToFileExplorer();
  }

  public destroy() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    this.detach();
  }

  private registerEvents() {
    // 1. Listen to active file changes
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file instanceof TFile) {
          this.openTimes.set(file.path, Date.now());
          this.addRecentFile(file);
        }
      })
    );

    // 2. Listen to workspace layout changes to reattach if leaf moves or recreates
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.attachToFileExplorer();
      })
    );

    // 3. Listen to file renames and deletes
    this.plugin.registerEvent(
      this.app.vault.on('rename', () => {
        this.refreshRecentFiles();
      })
    );

    this.plugin.registerEvent(
      this.app.vault.on('delete', () => {
        this.refreshRecentFiles();
      })
    );
  }

  private initRecentFiles() {
    const rawPaths = this.app.workspace.getLastOpenFiles?.() || [];
    const files: TFile[] = [];
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile) {
      files.push(activeFile);
      this.openTimes.set(activeFile.path, Date.now());
    }
    for (const path of rawPaths) {
      const abstract = this.app.vault.getAbstractFileByPath(path);
      if (abstract instanceof TFile && !files.some((f) => f.path === abstract.path)) {
        files.push(abstract);
        this.openTimes.set(abstract.path, abstract.stat.mtime || Date.now());
      }
    }
    const max = this.plugin.settings.explorerMaxRecentFiles || 20;
    this.recentFilesList = files.slice(0, max);
  }

  private addRecentFile(file: TFile) {
    if (!file || !(file instanceof TFile)) return;
    this.recentFilesList = [
      file,
      ...this.recentFilesList.filter((f) => f.path !== file.path),
    ].slice(0, this.plugin.settings.explorerMaxRecentFiles || 20);
    this.renderRecentList();
  }

  private refreshRecentFiles() {
    this.recentFilesList = this.recentFilesList.filter((f) => {
      return this.app.vault.getAbstractFileByPath(f.path) instanceof TFile;
    });
    this.renderRecentList();
  }

  public attachToFileExplorer() {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const leaf = leaves[0];
    this.attachedLeaf = leaf;

    const view = leaf.view as any;
    if (!view || !view.containerEl) return;

    const containerEl = view.containerEl as HTMLElement;
    this.injectHeaderButton(containerEl);
    this.applyLayout(containerEl);
  }

  private injectHeaderButton(containerEl: HTMLElement) {
    const navButtons = containerEl.querySelector('.nav-buttons-container') as HTMLElement;
    if (!navButtons) return;

    if (this.splitBtnEl && navButtons.contains(this.splitBtnEl)) {
      this.updateButtonState();
      return;
    }

    if (this.splitBtnEl) {
      this.splitBtnEl.remove();
      this.splitBtnEl = null;
    }

    const btn = document.createElement('div');
    btn.className = 'clickable-icon nav-action-button pakcli-explorer-split-btn';
    btn.setAttribute('aria-label', 'Toggle Explorer Split View (Recent Files)');
    setIcon(btn, 'rows-2');

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const current = this.plugin.settings.explorerSplitEnabled;
      this.plugin.settings.explorerSplitEnabled = !current;
      await this.plugin.saveSettings();
      this.updateButtonState();
      this.applyLayout();
      new Notice(`Explorer Split View: ${!current ? 'Enabled' : 'Disabled'}`);
    });

    navButtons.appendChild(btn);
    this.splitBtnEl = btn;
    this.updateButtonState();
  }

  private updateButtonState() {
    if (!this.splitBtnEl) return;
    const isEnabled = this.plugin.settings.explorerSplitEnabled;
    if (isEnabled) {
      this.splitBtnEl.addClass('is-active');
      this.splitBtnEl.setAttribute('aria-label', 'Explorer Split View: Enabled (Click to Disable)');
    } else {
      this.splitBtnEl.removeClass('is-active');
      this.splitBtnEl.setAttribute('aria-label', 'Explorer Split View: Disabled (Click to Enable)');
    }
  }

  public applyLayout(customContainer?: HTMLElement) {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const containerEl = customContainer || ((leaves[0].view as any)?.containerEl as HTMLElement);
    if (!containerEl) return;

    const isEnabled = this.plugin.settings.explorerSplitEnabled;
    const navHeader = containerEl.querySelector('.nav-header') as HTMLElement;
    const navFiles = containerEl.querySelector('.nav-files-container') as HTMLElement;

    if (!isEnabled) {
      // Revert to original explorer layout
      containerEl.removeClass('pakcli-explorer-split-active');
      if (this.recentPaneEl) {
        this.recentPaneEl.style.display = 'none';
      }
      if (navHeader) {
        navHeader.style.removeProperty('order');
      }
      if (navFiles) {
        navFiles.style.removeProperty('order');
        navFiles.style.removeProperty('flex');
        navFiles.style.removeProperty('overflow');
      }
      this.updateButtonState();
      return;
    }

    // Split mode is enabled
    containerEl.addClass('pakcli-explorer-split-active');
    this.updateButtonState();

    // Ensure recent pane element exists
    if (!this.recentPaneEl || !containerEl.contains(this.recentPaneEl)) {
      this.createRecentPane(containerEl);
    }

    if (this.recentPaneEl) {
      this.recentPaneEl.style.display = 'flex';
      const initialHeight = this.plugin.settings.explorerSplitHeight || 180;
      this.recentPaneEl.style.height = `${initialHeight}px`;
    }

    // Configure Section Ordering based on explorerSectionOrder
    const order = this.plugin.settings.explorerSectionOrder || [
      'header-control',
      'recent',
      'explorer-original',
    ];

    const headerOrder = order.indexOf('header-control');
    const recentOrder = order.indexOf('recent');
    const originalOrder = order.indexOf('explorer-original');

    if (navHeader) {
      navHeader.style.order = String(headerOrder !== -1 ? headerOrder : 0);
    }
    if (this.recentPaneEl) {
      this.recentPaneEl.style.order = String(recentOrder !== -1 ? recentOrder : 1);
    }
    if (navFiles) {
      navFiles.style.order = String(originalOrder !== -1 ? originalOrder : 2);
      navFiles.style.flex = '1 1 0';
      navFiles.style.overflowY = 'auto';
    }

    this.renderRecentList();
  }

  private createRecentPane(containerEl: HTMLElement) {
    if (this.recentPaneEl) {
      this.recentPaneEl.remove();
      this.recentPaneEl = null;
    }

    const pane = document.createElement('div');
    pane.className = 'pakcli-explorer-recent-pane';

    // Header bar
    const headerEl = document.createElement('div');
    headerEl.className = 'pakcli-recent-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'pakcli-recent-title-wrap';

    const iconEl = document.createElement('span');
    iconEl.className = 'pakcli-recent-icon';
    setIcon(iconEl, 'clock');

    const titleText = document.createElement('span');
    titleText.className = 'pakcli-recent-title-text';
    titleText.textContent = 'Recent';

    const countBadge = document.createElement('span');
    countBadge.className = 'pakcli-recent-count-badge';
    countBadge.textContent = '0';

    titleWrap.appendChild(iconEl);
    titleWrap.appendChild(titleText);
    titleWrap.appendChild(countBadge);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'pakcli-recent-actions';

    // Time filter dropdown: last 15 mnt, 1 hour, 12 hour, today, 1 month, 3 month, 6 month, 12 month, 36 month
    const filterSelect = document.createElement('select');
    filterSelect.className = 'dropdown pakcli-recent-time-select';
    filterSelect.setAttribute('aria-label', 'Filter recent files by timeframe');

    for (const opt of RECENT_TIME_FILTER_OPTIONS) {
      const optEl = document.createElement('option');
      optEl.value = opt.id;
      optEl.textContent = opt.label;
      if (opt.id === (this.plugin.settings.explorerRecentTimeFilter || 'all')) {
        optEl.selected = true;
      }
      filterSelect.appendChild(optEl);
    }

    filterSelect.addEventListener('change', async (e) => {
      e.stopPropagation();
      this.plugin.settings.explorerRecentTimeFilter = filterSelect.value as RecentTimeFilter;
      await this.plugin.saveSettings();
      this.renderRecentList();
    });

    const clearBtn = document.createElement('div');
    clearBtn.className = 'clickable-icon pakcli-recent-clear-btn';
    clearBtn.setAttribute('aria-label', 'Clear recent files list');
    setIcon(clearBtn, 'trash-2');
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.recentFilesList = [];
      this.openTimes.clear();
      this.renderRecentList();
      new Notice('Recent files list cleared.');
    });

    actionsEl.appendChild(filterSelect);
    actionsEl.appendChild(clearBtn);

    headerEl.appendChild(titleWrap);
    headerEl.appendChild(actionsEl);
    pane.appendChild(headerEl);

    // List container
    const listEl = document.createElement('div');
    listEl.className = 'pakcli-recent-list nav-files-container';
    pane.appendChild(listEl);

    // Splitter Bar (for drag-resizing height)
    const splitter = document.createElement('div');
    splitter.className = 'pakcli-explorer-splitter';
    const grip = document.createElement('div');
    grip.className = 'pakcli-splitter-grip';
    splitter.appendChild(grip);

    this.initSplitterDrag(splitter, pane);
    pane.appendChild(splitter);

    containerEl.appendChild(pane);
    this.recentPaneEl = pane;
    this.splitterEl = splitter;
  }

  private initSplitterDrag(splitter: HTMLElement, pane: HTMLElement) {
    splitter.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      this.isDragging = true;
      splitter.addClass('is-dragging');
      document.body.addClass('pakcli-resizing-y');

      const startY = e.clientY;
      const startHeight = pane.getBoundingClientRect().height;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!this.isDragging) return;
        const delta = moveEvent.clientY - startY;
        const newHeight = Math.max(70, Math.min(600, Math.round(startHeight + delta)));
        pane.style.height = `${newHeight}px`;
      };

      const onPointerUp = async () => {
        if (!this.isDragging) return;
        this.isDragging = false;
        splitter.removeClass('is-dragging');
        document.body.removeClass('pakcli-resizing-y');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);

        const finalHeight = Math.max(70, Math.min(600, Math.round(pane.getBoundingClientRect().height)));
        this.plugin.settings.explorerSplitHeight = finalHeight;
        await this.plugin.saveSettings();
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  }

  private getFilesForTimeFilter(filterId: RecentTimeFilter): TFile[] {
    const now = Date.now();
    const opt = RECENT_TIME_FILTER_OPTIONS.find((o) => o.id === filterId) || RECENT_TIME_FILTER_OPTIONS[0];
    const maxFiles = this.plugin.settings.explorerMaxRecentFiles || 20;

    let cutoff = 0;
    if (opt.id === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      cutoff = today.getTime();
    } else if (typeof opt.durationMs === 'number') {
      cutoff = now - opt.durationMs;
    }

    if (opt.id === 'all') {
      return this.recentFilesList.slice(0, maxFiles);
    }

    // Filter all vault files whose modified time or recent open time falls within the timeframe
    const allVaultFiles = this.app.vault.getFiles();
    const matching = allVaultFiles.filter((f) => {
      const fileTime = Math.max(f.stat.mtime || 0, this.openTimes.get(f.path) || 0);
      return fileTime >= cutoff;
    });

    matching.sort((a, b) => {
      const tA = Math.max(a.stat.mtime || 0, this.openTimes.get(a.path) || 0);
      const tB = Math.max(b.stat.mtime || 0, this.openTimes.get(b.path) || 0);
      return tB - tA;
    });

    return matching.slice(0, maxFiles);
  }

  public renderRecentList() {
    if (!this.recentPaneEl) return;
    const listEl = this.recentPaneEl.querySelector('.pakcli-recent-list') as HTMLElement;
    const countBadge = this.recentPaneEl.querySelector('.pakcli-recent-count-badge') as HTMLElement;
    if (!listEl) return;

    listEl.empty();

    const currentFilter = this.plugin.settings.explorerRecentTimeFilter || 'all';
    const filesToDisplay = this.getFilesForTimeFilter(currentFilter);

    if (countBadge) {
      countBadge.textContent = String(filesToDisplay.length);
    }

    if (filesToDisplay.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'pakcli-recent-empty-state';
      emptyEl.textContent = currentFilter === 'all' ? 'No recent files opened' : 'No files in this timeframe';
      listEl.appendChild(emptyEl);
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();

    for (const file of filesToDisplay) {
      const itemEl = document.createElement('div');
      itemEl.className = 'tree-item nav-file pakcli-recent-item';
      if (activeFile && activeFile.path === file.path) {
        itemEl.addClass('is-active');
      }

      const itemSelf = document.createElement('div');
      itemSelf.className = 'tree-item-self is-clickable nav-file-title';

      // NOTE: File icons removed as requested ("remove that")

      // Title container
      const titleContainer = document.createElement('div');
      titleContainer.className = 'tree-item-inner nav-file-title-content pakcli-recent-title-container';

      // User Rule: "if its a folder index.md dia munculnya namafolder/index.md"
      const formatted = this.formatFileTitle(file);

      if (formatted.isIndexFolder) {
        const folderSpan = document.createElement('span');
        folderSpan.className = 'pakcli-recent-folder-prefix';
        folderSpan.textContent = formatted.folderPrefix ? `${formatted.folderPrefix}/` : '';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'pakcli-recent-file-name is-index-file';
        nameSpan.textContent = formatted.fileName;

        titleContainer.appendChild(folderSpan);
        titleContainer.appendChild(nameSpan);
      } else {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'pakcli-recent-file-name';
        nameSpan.textContent = formatted.fileName;
        titleContainer.appendChild(nameSpan);

        if (formatted.folderPrefix) {
          const subSpan = document.createElement('span');
          subSpan.className = 'pakcli-recent-subfolder-hint';
          subSpan.textContent = ` (${formatted.folderPrefix})`;
          titleContainer.appendChild(subSpan);
        }
      }

      itemSelf.appendChild(titleContainer);

      // Remove single item button on hover
      const removeBtn = document.createElement('div');
      removeBtn.className = 'pakcli-recent-item-remove';
      removeBtn.setAttribute('aria-label', 'Remove from recent files');
      setIcon(removeBtn, 'x');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.recentFilesList = this.recentFilesList.filter((f) => f.path !== file.path);
        this.renderRecentList();
      });
      itemSelf.appendChild(removeBtn);

      // Tooltip with full path
      itemSelf.setAttribute('aria-label', file.path);

      // Click to open file
      itemSelf.addEventListener('click', async (e: MouseEvent) => {
        e.preventDefault();
        const modKey = Keymap.isModEvent(e);
        const leaf = this.app.workspace.getLeaf(modKey);
        await leaf.openFile(file);
        this.renderRecentList();
      });

      // Context menu
      itemSelf.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        const menu = new Menu();
        this.app.workspace.trigger('file-menu', menu, file, 'file-explorer');
        menu.addItem((item) => {
          item.setTitle('Remove from Recent Files')
            .setIcon('x')
            .onClick(() => {
              this.recentFilesList = this.recentFilesList.filter((f) => f.path !== file.path);
              this.renderRecentList();
            });
        });
        menu.showAtMouseEvent(e);
      });

      itemEl.appendChild(itemSelf);
      listEl.appendChild(itemEl);
    }
  }

  /**
   * Formatting Rule:
   * "if its a folder index.md dia munculnya namafolder/index.md"
   */
  private formatFileTitle(file: TFile): {
    fileName: string;
    folderPrefix: string;
    isIndexFolder: boolean;
  } {
    const isIndex = file.name.toLowerCase() === 'index.md';
    const parentFolder = file.parent && file.parent.path && file.parent.path !== '/' ? file.parent.name : '';

    if (isIndex && parentFolder) {
      return {
        fileName: 'index.md',
        folderPrefix: parentFolder,
        isIndexFolder: true,
      };
    }

    return {
      fileName: file.name,
      folderPrefix: parentFolder,
      isIndexFolder: false,
    };
  }

  private detach() {
    if (this.splitBtnEl) {
      this.splitBtnEl.remove();
      this.splitBtnEl = null;
    }
    if (this.recentPaneEl) {
      this.recentPaneEl.remove();
      this.recentPaneEl = null;
    }
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (leaves && leaves.length > 0) {
      const containerEl = (leaves[0].view as any)?.containerEl as HTMLElement;
      if (containerEl) {
        containerEl.removeClass('pakcli-explorer-split-active');
        const navHeader = containerEl.querySelector('.nav-header') as HTMLElement;
        const navFiles = containerEl.querySelector('.nav-files-container') as HTMLElement;
        if (navHeader) navHeader.style.removeProperty('order');
        if (navFiles) {
          navFiles.style.removeProperty('order');
          navFiles.style.removeProperty('flex');
          navFiles.style.removeProperty('overflow');
        }
      }
    }
  }
}

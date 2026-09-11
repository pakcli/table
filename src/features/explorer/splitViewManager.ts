import { App, Menu, Notice, setIcon, TFile, TFolder, TAbstractFile, WorkspaceLeaf, Keymap } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { ExplorerSectionId, RecentTimeFilter, RECENT_TIME_FILTER_OPTIONS } from './types';
import { ensureFolderExists } from '../sqlseal/utils/views';

export class SplitViewManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private splitBtnEl: HTMLElement | null = null;
  private baseBtnEl: HTMLElement | null = null;
  private recentPaneEl: HTMLElement | null = null;
  private splitterEl: HTMLElement | null = null;
  private attachedLeaf: WorkspaceLeaf | null = null;
  private recentFilesList: TFile[] = [];
  private openTimes: Map<string, number> = new Map();
  private isDragging = false;
  private mutationObserver: MutationObserver | null = null;
  private saveCsvTimeout: ReturnType<typeof setTimeout> | null = null;
  private onFolderClickBound: ((e: MouseEvent) => void) | null = null;

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init() {
    this.registerEvents();
    // Defer init until vault is fully indexed so getAbstractFileByPath works reliably
    this.app.workspace.onLayoutReady(() => {
      this.initRecentFiles().catch((err) => {
        console.error('[PakCLI] Error initializing recent files:', err);
      });
      this.attachToFileExplorer();
    });
  }

  public destroy() {
    if (this.saveCsvTimeout) {
      clearTimeout(this.saveCsvTimeout);
      this.saveCsvTimeout = null;
    }
    // Flush: save history immediately on destroy so it survives exit/reload
    if (this.recentFilesList.length > 0) {
      this.saveRecentsCsvArtifact().catch(() => {});
    }
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
        if (file instanceof TFile && !this.isArtifactFile(file.path)) {
          this.openTimes.set(file.path, Date.now());
          this.addRecentFile(file);
        }
      })
    );

    // 2. Listen to workspace layout changes to reattach if leaf moves or recreates
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.attachToFileExplorer();
        this.applyBaseExplorerFilter();
      })
    );

    // 3. Listen to file renames and deletes
    this.plugin.registerEvent(
      this.app.vault.on('rename', () => {
        this.refreshRecentFiles();
        this.applyBaseExplorerFilter();
      })
    );

    this.plugin.registerEvent(
      this.app.vault.on('delete', () => {
        this.refreshRecentFiles();
        this.applyBaseExplorerFilter();
      })
    );
  }

  private async initRecentFiles() {
    const rawPaths = this.app.workspace.getLastOpenFiles?.() || [];
    const files: TFile[] = [];
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile && !this.isArtifactFile(activeFile.path)) {
      files.push(activeFile);
      this.openTimes.set(activeFile.path, Date.now());
    }
    for (const path of rawPaths) {
      const abstract = this.app.vault.getAbstractFileByPath(path);
      if (abstract instanceof TFile && !files.some((f) => f.path === abstract.path)) {
        if (this.isArtifactFile(abstract.path)) continue;
        files.push(abstract);
        this.openTimes.set(abstract.path, abstract.stat.mtime || Date.now());
      }
    }

    // Load and merge history from recents.csv artifact if it exists
    await this.loadRecentsFromCsvArtifact(files);

    // Check available artifacts in the vault so they are included and never disappear
    const allVaultFiles = this.app.vault.getFiles();
    const availableArtifacts = allVaultFiles.filter((f) => f.path.startsWith('artifacts/'));
    for (const af of availableArtifacts) {
      if (!files.some((f) => f.path === af.path)) {
        files.push(af);
        if (!this.openTimes.has(af.path)) {
          this.openTimes.set(af.path, af.stat.mtime || Date.now());
        }
      }
    }

    // Sort combined list by most recent open time (descending)
    files.sort((a, b) => {
      const tA = this.openTimes.get(a.path) || 0;
      const tB = this.openTimes.get(b.path) || 0;
      return tB - tA;
    });

    const max = this.plugin.settings.explorerMaxRecentFiles || 20;
    this.recentFilesList = files.slice(0, max);
    this.renderRecentList();
    // Only save if we actually have files to persist (avoid overwriting history with an empty list)
    if (this.recentFilesList.length > 0) {
      this.scheduleSaveRecentsCsv();
    }
  }

  /**
   * Checks if a file path should be excluded.
   * All available vault files and artifacts are tracked; nothing disappears unless deleted from the vault.
   */
  private isArtifactFile(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') return true;
    return false;
  }

  public addRecentFile(file: TFile) {
    if (!file || !(file instanceof TFile)) return;
    // Skip invalid paths
    if (this.isArtifactFile(file.path)) return;
    this.recentFilesList = [
      file,
      ...this.recentFilesList.filter((f) => f.path !== file.path),
    ].slice(0, this.plugin.settings.explorerMaxRecentFiles || 20);
    this.renderRecentList();
    this.scheduleSaveRecentsCsv();
  }

  private refreshRecentFiles() {
    this.recentFilesList = this.recentFilesList.filter((f) => {
      return (
        f instanceof TFile &&
        !this.isArtifactFile(f.path) &&
        this.app.vault.getAbstractFileByPath(f.path) instanceof TFile
      );
    });
    this.renderRecentList();
    this.scheduleSaveRecentsCsv();
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
    this.attachFolderClickListener(containerEl);
    this.applyBaseExplorerFilter();
  }

  private injectHeaderButton(containerEl: HTMLElement) {
    const navButtons = containerEl.querySelector('.nav-buttons-container') as HTMLElement;
    if (!navButtons) return;

    if (
      this.splitBtnEl &&
      navButtons.contains(this.splitBtnEl) &&
      this.baseBtnEl &&
      navButtons.contains(this.baseBtnEl)
    ) {
      this.updateButtonState();
      return;
    }

    if (this.splitBtnEl) {
      this.splitBtnEl.remove();
      this.splitBtnEl = null;
    }
    if (this.baseBtnEl) {
      this.baseBtnEl.remove();
      this.baseBtnEl = null;
    }

    // 1. Split View Toggle Button
    const splitBtn = document.createElement('div');
    splitBtn.className = 'clickable-icon nav-action-button pakcli-explorer-split-btn';
    splitBtn.setAttribute('aria-label', 'Toggle Explorer Split View (Recent Files)');
    setIcon(splitBtn, 'rows-2');

    splitBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const current = this.plugin.settings.explorerSplitEnabled;
      this.plugin.settings.explorerSplitEnabled = !current;
      await this.plugin.saveSettings();
      this.updateButtonState();
      this.applyLayout();
      new Notice(`Explorer Split View: ${!current ? 'Enabled' : 'Disabled'}`);
    });

    // 2. Base Explorer Mode Filter Toggle Button (Beside Split Toggle)
    const baseBtn = document.createElement('div');
    baseBtn.className = 'clickable-icon nav-action-button pakcli-explorer-base-btn';
    baseBtn.setAttribute('aria-label', 'Toggle Base Explorer Mode (Base files & affected folders only)');
    setIcon(baseBtn, 'filter');

    baseBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = !this.plugin.settings.baseExplorerActive;
      this.plugin.settings.baseExplorerActive = next;
      await this.plugin.saveSettings();
      this.updateButtonState();
      this.applyBaseExplorerFilter();
      new Notice(`Base Explorer Mode: ${next ? 'ON (Base files & affected folders only)' : 'OFF (All files visible)'}`);
    });

    navButtons.appendChild(splitBtn);
    navButtons.appendChild(baseBtn);

    this.splitBtnEl = splitBtn;
    this.baseBtnEl = baseBtn;
    this.updateButtonState();
  }

  private updateButtonState() {
    if (this.splitBtnEl) {
      const isSplitEnabled = this.plugin.settings.explorerSplitEnabled;
      if (isSplitEnabled) {
        this.splitBtnEl.addClass('is-active');
        this.splitBtnEl.setAttribute('aria-label', 'Explorer Split View: Enabled (Click to Disable)');
      } else {
        this.splitBtnEl.removeClass('is-active');
        this.splitBtnEl.setAttribute('aria-label', 'Explorer Split View: Disabled (Click to Enable)');
      }
    }

    if (this.baseBtnEl) {
      const isBaseActive = this.plugin.settings.baseExplorerActive;
      if (isBaseActive) {
        this.baseBtnEl.addClass('is-active');
        this.baseBtnEl.setAttribute('aria-label', 'Base Explorer Mode: Active (Click to Disable)');
      } else {
        this.baseBtnEl.removeClass('is-active');
        this.baseBtnEl.setAttribute('aria-label', 'Base Explorer Mode: Inactive (Click to Enable)');
      }
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

    // Time filter & folder filter dropdown
    const filterSelect = document.createElement('select');
    filterSelect.className = 'dropdown pakcli-recent-time-select';
    filterSelect.setAttribute('aria-label', 'Filter recent files by timeframe or folder');
    this.populateFilterDropdown(filterSelect);

    filterSelect.addEventListener('change', async (e) => {
      e.stopPropagation();
      const val = filterSelect.value;
      if (val.startsWith('folder:')) {
        this.plugin.settings.activeRecentFolderFilter = val.replace('folder:', '');
      } else {
        this.plugin.settings.activeRecentFolderFilter = '';
        this.plugin.settings.explorerRecentTimeFilter = val as RecentTimeFilter;
      }
      await this.plugin.saveSettings();
      this.renderRecentList();
    });

    const csvBtn = document.createElement('div');
    csvBtn.className = 'clickable-icon pakcli-recent-csv-btn';
    csvBtn.setAttribute('aria-label', 'Open Recents as CSV Table (path, time last open, date last open)');
    setIcon(csvBtn, 'file-spreadsheet');
    csvBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const file = await this.saveRecentsCsvArtifact();
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        new Notice('Opened Recents CSV artifact');
      } else {
        new Notice('Unable to open Recents CSV artifact');
      }
    });

    const clearBtn = document.createElement('div');
    clearBtn.className = 'clickable-icon pakcli-recent-clear-btn';
    clearBtn.setAttribute('aria-label', 'Clear recent files list');
    setIcon(clearBtn, 'trash-2');
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.recentFilesList = [];
      this.openTimes.clear();
      this.plugin.settings.activeRecentFolderFilter = '';
      await this.plugin.saveSettings();
      this.updateDropdownOptions();
      this.renderRecentList();
      await this.saveRecentsCsvArtifact();
      new Notice('Recent files list cleared.');
    });

    actionsEl.appendChild(filterSelect);
    actionsEl.appendChild(csvBtn);
    actionsEl.appendChild(clearBtn);

    headerEl.appendChild(titleWrap);
    headerEl.appendChild(actionsEl);
    pane.appendChild(headerEl);

    // List container
    const listEl = document.createElement('div');
    listEl.className = 'pakcli-recent-list nav-files-container';
    pane.appendChild(listEl);

    // Drag & Drop listener on pane
    this.initDragAndDrop(pane);

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

  public populateFilterDropdown(filterSelect: HTMLSelectElement) {
    filterSelect.empty();

    // Timeframe options group
    const timeGroup = filterSelect.createEl('optgroup', { label: 'Timeframe' });
    for (const opt of RECENT_TIME_FILTER_OPTIONS) {
      timeGroup.createEl('option', { value: opt.id, text: opt.label });
    }

    // Folder Filters group
    const folderGroup = filterSelect.createEl('optgroup', { label: 'Folder Filters' });
    folderGroup.createEl('option', { value: 'folder:', text: 'All Folders' });

    const customPaths = this.plugin.settings.customRecentPaths || [];
    for (const p of customPaths) {
      folderGroup.createEl('option', { value: `folder:${p}`, text: `📁 ${p}` });
    }

    const activeFolder = this.plugin.settings.activeRecentFolderFilter;
    if (activeFolder) {
      filterSelect.value = `folder:${activeFolder}`;
    } else {
      filterSelect.value = this.plugin.settings.explorerRecentTimeFilter || 'all';
    }
  }

  public updateDropdownOptions() {
    if (!this.recentPaneEl) return;
    const select = this.recentPaneEl.querySelector('.pakcli-recent-time-select') as HTMLSelectElement;
    if (select) {
      this.populateFilterDropdown(select);
    }
  }

  public async addFolderToRecentFilter(folderPath: string, activate: boolean = false) {
    const set = new Set(this.plugin.settings.customRecentPaths || []);
    set.add(folderPath);
    this.plugin.settings.customRecentPaths = Array.from(set);

    if (activate) {
      this.plugin.settings.activeRecentFolderFilter = folderPath;
    }

    await this.plugin.saveSettings();
    this.updateDropdownOptions();
    this.renderRecentList();
    new Notice(`Folder "${folderPath}" added to recent filter dropdown${activate ? ' and activated' : ''}.`);
  }

  public async removeFolderFromRecentFilter(folderPath: string) {
    this.plugin.settings.customRecentPaths = (this.plugin.settings.customRecentPaths || []).filter((p) => p !== folderPath);
    if (this.plugin.settings.activeRecentFolderFilter === folderPath) {
      this.plugin.settings.activeRecentFolderFilter = '';
    }
    await this.plugin.saveSettings();
    this.updateDropdownOptions();
    this.renderRecentList();
    new Notice(`Removed "${folderPath}" from recent filter dropdown.`);
  }

  private initDragAndDrop(paneEl: HTMLElement) {
    paneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      paneEl.addClass('is-drag-over');
    });

    paneEl.addEventListener('dragleave', () => {
      paneEl.removeClass('is-drag-over');
    });

    paneEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      paneEl.removeClass('is-drag-over');

      const rawPath = e.dataTransfer?.getData('text/plain');
      if (!rawPath) return;

      const abstract = this.app.vault.getAbstractFileByPath(rawPath);
      if (abstract instanceof TFile) {
        this.addRecentFile(abstract);
        new Notice(`Added "${abstract.name}" to Recents`);
      } else if (abstract instanceof TFolder) {
        await this.addFolderToRecentFilter(abstract.path, true);
      }
    });
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
    const folderFilter = this.plugin.settings.activeRecentFolderFilter || '';
    let list = [...this.recentFilesList];

    if (filterId !== 'all') {
      const now = Date.now();
      const opt = RECENT_TIME_FILTER_OPTIONS.find((o) => o.id === filterId) || RECENT_TIME_FILTER_OPTIONS[0];
      let cutoff = 0;
      if (opt.id === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        cutoff = today.getTime();
      } else if (typeof opt.durationMs === 'number') {
        cutoff = now - opt.durationMs;
      }

      const allVaultFiles = this.app.vault.getFiles();
      list = allVaultFiles.filter((f) => {
        if (!(f instanceof TFile)) return false;
        if (this.isArtifactFile(f.path)) return false;
        const fileTime = Math.max(f.stat.mtime || 0, this.openTimes.get(f.path) || 0);
        return fileTime >= cutoff;
      });

      list.sort((a, b) => {
        const tA = Math.max(a.stat.mtime || 0, this.openTimes.get(a.path) || 0);
        const tB = Math.max(b.stat.mtime || 0, this.openTimes.get(b.path) || 0);
        return tB - tA;
      });
    }

    // Apply active folder filter if set
    if (folderFilter) {
      const normalizedFolder = folderFilter.trim().replace(/\/+$/, '');
      list = list.filter((f) => f.path.startsWith(`${normalizedFolder}/`) || f.path === normalizedFolder);
    }

    const maxFiles = this.plugin.settings.explorerMaxRecentFiles || 20;
    return list.slice(0, maxFiles);
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
      emptyEl.textContent = currentFilter === 'all' && !this.plugin.settings.activeRecentFolderFilter
        ? 'No recent files opened'
        : 'No files in this timeframe/folder';
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

      // Title container
      const titleContainer = document.createElement('div');
      titleContainer.className = 'tree-item-inner nav-file-title-content pakcli-recent-title-container';

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
        this.scheduleSaveRecentsCsv();
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
              this.scheduleSaveRecentsCsv();
            });
        });
        menu.showAtMouseEvent(e);
      });

      itemEl.appendChild(itemSelf);
      listEl.appendChild(itemEl);
    }
  }

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

  public isBaseFile(filePath: string): boolean {
    if (!filePath) return false;
    const lower = filePath.toLowerCase().trim();
    return (
      lower.endsWith('.base') ||
      lower.endsWith('.base.json') ||
      lower.endsWith('.base.md') ||
      lower.endsWith('index.md') ||
      lower.includes('.base.')
    );
  }

  public applyBaseExplorerFilter() {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const view = leaves[0].view as any;
    if (!view) return;

    const isActive = !!this.plugin.settings.baseExplorerActive;

    // Approach 1: Use Obsidian native view.fileItems if available
    if (view.fileItems && typeof view.fileItems === 'object') {
      const fileItemsMap = view.fileItems as Record<string, { el?: HTMLElement; file?: TAbstractFile }>;

      // 1. Process files
      for (const [path, item] of Object.entries(fileItemsMap)) {
        if (!item || !item.el || !(item.file instanceof TFile)) continue;
        if (item.el.closest('.pakcli-explorer-recent-pane')) continue;

        if (!isActive) {
          item.el.style.display = '';
        } else {
          if (this.isBaseFile(path)) {
            item.el.style.display = '';
          } else {
            item.el.style.display = 'none';
          }
        }
      }

      // 2. Process folders (sorted bottom-up by path length descending)
      const folderEntries = Object.entries(fileItemsMap)
        .filter(([path, item]) => item && item.el && item.file instanceof TFolder && path !== '/')
        .sort((a, b) => b[0].length - a[0].length);

      if (!isActive) {
        folderEntries.forEach(([_, item]) => {
          if (item && item.el) item.el.style.display = '';
        });
      } else {
        for (const [_, item] of folderEntries) {
          if (!item || !item.el) continue;
          const folderEl = item.el;
          const childrenContainer = folderEl.querySelector('.nav-folder-children');

          if (!childrenContainer) {
            folderEl.style.display = 'none';
            continue;
          }

          const visibleFiles = Array.from(childrenContainer.querySelectorAll('.nav-file'))
            .filter((el) => (el as HTMLElement).style.display !== 'none');
          const visibleFolders = Array.from(childrenContainer.querySelectorAll('.nav-folder'))
            .filter((el) => (el as HTMLElement).style.display !== 'none');

          if (visibleFiles.length > 0 || visibleFolders.length > 0) {
            folderEl.style.display = '';
          } else {
            folderEl.style.display = 'none';
          }
        }
      }
      return;
    }

    // Approach 2: DOM fallback query selector
    const containerEl = view.containerEl as HTMLElement;
    if (!containerEl) return;

    const originalTreeContainer = containerEl.querySelector('.nav-files-container:not(.pakcli-recent-list)') || containerEl;
    const fileItems = originalTreeContainer.querySelectorAll('.nav-file');

    fileItems.forEach((fileItem) => {
      if (fileItem.closest('.pakcli-explorer-recent-pane')) return;

      const titleEl = fileItem.querySelector('.nav-file-title') as HTMLElement;
      const path = titleEl?.getAttribute('data-path') || fileItem.getAttribute('data-path') || titleEl?.textContent || '';

      if (!isActive) {
        (fileItem as HTMLElement).style.display = '';
      } else {
        if (this.isBaseFile(path)) {
          (fileItem as HTMLElement).style.display = '';
        } else {
          (fileItem as HTMLElement).style.display = 'none';
        }
      }
    });

    const folderItems = Array.from(originalTreeContainer.querySelectorAll('.nav-folder'));

    if (!isActive) {
      folderItems.forEach((folderItem) => {
        (folderItem as HTMLElement).style.display = '';
      });
    } else {
      for (let i = folderItems.length - 1; i >= 0; i--) {
        const folderItem = folderItems[i] as HTMLElement;
        const childrenContainer = folderItem.querySelector('.nav-folder-children');

        if (!childrenContainer) {
          folderItem.style.display = 'none';
          continue;
        }

        const visibleFiles = Array.from(childrenContainer.querySelectorAll(':scope > .nav-file, :scope > .tree-item.nav-file'))
          .filter((el) => (el as HTMLElement).style.display !== 'none');
        const visibleFolders = Array.from(childrenContainer.querySelectorAll(':scope > .nav-folder, :scope > .tree-item.nav-folder'))
          .filter((el) => (el as HTMLElement).style.display !== 'none');

        if (visibleFiles.length > 0 || visibleFolders.length > 0) {
          folderItem.style.display = '';
        } else {
          folderItem.style.display = 'none';
        }
      }
    }
  }

  public getTimestampPrefix(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}_`;
  }

  public async moveToBacklog(item: TAbstractFile, useTimestamp: boolean = false) {
    try {
      const backlogFolder = (this.plugin.settings.backlogFolderPath || 'Backlog').trim().replace(/^\/+|\/+$/g, '') || 'Backlog';
      await ensureFolderExists(this.app, backlogFolder);

      const prefix = useTimestamp ? this.getTimestampPrefix() : '';
      const newPath = `${backlogFolder}/${prefix}${item.name}`;

      await this.app.fileManager.renameFile(item, newPath);
      new Notice(`Moved "${item.name}" to "${newPath}"`);
    } catch (err) {
      console.error('[PakCLI] Error moving to backlog:', err);
      new Notice(`Failed to move to backlog: ${String(err)}`);
    }
  }

  private attachFolderClickListener(containerEl: HTMLElement) {
    if (this.onFolderClickBound) {
      containerEl.removeEventListener('click', this.onFolderClickBound);
    }
    this.onFolderClickBound = (e: MouseEvent) => this.onFolderClick(e);
    containerEl.addEventListener('click', this.onFolderClickBound);
  }

  private onFolderClick(e: MouseEvent) {
    if (!this.plugin.settings.enableAutoFolderIndex) return;
    const target = (e.target as HTMLElement)?.closest('.nav-folder-title') as HTMLElement;
    if (!target) return;
    const path = target.getAttribute('data-path');
    if (!path) return;
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (abstract instanceof TFolder) {
      this.handleFolderIndexCreation(abstract).catch((err) => {
        console.error('[PakCLI] Error creating folder index:', err);
      });
    }
  }

  public async handleFolderIndexCreation(folder: TFolder) {
    if (!this.plugin.settings.enableAutoFolderIndex) return;
    const indexPath = `${folder.path === '/' ? '' : folder.path}/index.md`.replace(/^\/+/, '');
    const existing = this.app.vault.getAbstractFileByPath(indexPath);

    // Strictly enforce requirement: if file already exists, DO NOTHING
    if (existing instanceof TFile) {
      return;
    }

    // Construct title
    const prefix = this.plugin.settings.folderIndexPrefix || '';
    const suffix = this.plugin.settings.folderIndexSuffix || '';
    const useTs = this.plugin.settings.folderIndexUseTimestamp === true;
    const tsPrefix = useTs ? this.getTimestampPrefix() : '';

    const title = `${tsPrefix}${prefix}${folder.name}${suffix}`;
    const content = `---\ntitle: "${title}"\n---\n\n# ${title}\n\n`;

    try {
      const createdFile = await this.app.vault.create(indexPath, content);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(createdFile);
      new Notice(`Created folder index: ${indexPath}`);
    } catch (err) {
      console.error('[PakCLI] Failed to create folder index:', err);
    }
  }

  private detach() {
    if (this.splitBtnEl) {
      this.splitBtnEl.remove();
      this.splitBtnEl = null;
    }
    if (this.baseBtnEl) {
      this.baseBtnEl.remove();
      this.baseBtnEl = null;
    }
    if (this.recentPaneEl) {
      this.recentPaneEl.remove();
      this.recentPaneEl = null;
    }
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (leaves && leaves.length > 0) {
      const containerEl = (leaves[0].view as any)?.containerEl as HTMLElement;
      if (containerEl) {
        if (this.onFolderClickBound) {
          containerEl.removeEventListener('click', this.onFolderClickBound);
          this.onFolderClickBound = null;
        }
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

  public getRecentsCsvPath(): string {
    const folder = (this.plugin.settings.recentsArtifactFolderPath || 'artifacts/pakcli-table').trim().replace(/^\/+|\/+$/g, '') || 'artifacts/pakcli-table';
    return `${folder}/recents.csv`;
  }

  public scheduleSaveRecentsCsv() {
    if (this.saveCsvTimeout) {
      clearTimeout(this.saveCsvTimeout);
    }
    this.saveCsvTimeout = setTimeout(() => {
      this.saveRecentsCsvArtifact().catch((err) => {
        console.error('[PakCLI] Error saving recents CSV artifact:', err);
      });
    }, 400);
  }

  public async saveRecentsCsvArtifact(): Promise<TFile | null> {
    try {
      const folder = (this.plugin.settings.recentsArtifactFolderPath || 'artifacts/pakcli-table').trim().replace(/^\/+|\/+$/g, '') || 'artifacts/pakcli-table';
      await ensureFolderExists(this.app, folder);

      const csvPath = `${folder}/recents.csv`;
      const rows: string[] = ['path,time last open,date last open'];

      for (const file of this.recentFilesList) {
        if (!(file instanceof TFile)) continue;
        if (this.isArtifactFile(file.path)) continue;
        if (!(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) continue;

        const ts = this.openTimes.get(file.path) || file.stat.mtime || Date.now();
        const { timeStr, dateStr } = this.formatDateTime(ts);
        rows.push(`${this.escapeCsv(file.path)},${this.escapeCsv(timeStr)},${this.escapeCsv(dateStr)}`);
      }

      const csvContent = rows.join('\n') + '\n';
      const existing = this.app.vault.getAbstractFileByPath(csvPath);

      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, csvContent);
        return existing;
      } else {
        const created = await this.app.vault.create(csvPath, csvContent);
        return created;
      }
    } catch (e) {
      console.error('[PakCLI] Failed to save recents CSV artifact:', e);
      return null;
    }
  }

  private async loadRecentsFromCsvArtifact(files: TFile[]) {
    try {
      const primaryPath = this.getRecentsCsvPath();
      const possiblePaths = [
        primaryPath,
        'artifacts/pakcli-table/recents.csv',
        'artifacts/recents.csv',
        'csv_view_artifacts/recents.csv',
      ];

      let csvAbstract: TFile | null = null;
      for (const candidate of possiblePaths) {
        const abstract = this.app.vault.getAbstractFileByPath(candidate);
        if (abstract instanceof TFile) {
          csvAbstract = abstract;
          break;
        }
      }

      if (!csvAbstract) {
        const allFiles = this.app.vault.getFiles();
        csvAbstract = allFiles.find((f) => f.name.toLowerCase() === 'recents.csv') || null;
      }

      if (!(csvAbstract instanceof TFile)) return;

      const content = await this.app.vault.read(csvAbstract);
      const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) return;

      const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toUpperCase());
      const pathIdx = header.indexOf('PATH');
      const timeIdx = header.indexOf('TIME LAST OPEN');
      const dateIdx = header.indexOf('DATE LAST OPEN');

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const cols = this.parseCsvLine(line);
        const filePath = cols[pathIdx !== -1 ? pathIdx : 0];
        if (!filePath) continue;

        const timeStr = cols[timeIdx !== -1 ? timeIdx : 1] || '';
        const dateStr = cols[dateIdx !== -1 ? dateIdx : 2] || '';

        let timestamp = 0;
        if (dateStr && timeStr) {
          const parsed = Date.parse(`${dateStr}T${timeStr}`);
          if (!isNaN(parsed)) {
            timestamp = parsed;
          }
        }
        if (!timestamp) timestamp = Date.now();

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          if (!this.openTimes.has(file.path)) {
            this.openTimes.set(file.path, timestamp);
          }
          if (!files.some((f) => f.path === file.path)) {
            files.push(file);
          }
        }
      }
    } catch (e) {
      console.warn('[PakCLI] Could not load recents from CSV artifact:', e);
    }
  }

  private formatDateTime(timestamp: number): { timeStr: string; dateStr: string } {
    const d = new Date(timestamp);
    const validDate = isNaN(d.getTime()) ? new Date() : d;
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(validDate.getHours())}:${pad(validDate.getMinutes())}:${pad(validDate.getSeconds())}`;
    const dateStr = `${validDate.getFullYear()}-${pad(validDate.getMonth() + 1)}-${pad(validDate.getDate())}`;
    return { timeStr, dateStr };
  }

  private escapeCsv(val: string): string {
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }
}

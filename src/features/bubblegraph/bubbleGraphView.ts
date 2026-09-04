import { ItemView, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { BubbleNode, BubbleEdge, BubbleCluster, InspectorData } from './types';
import { buildVaultGraph, BuiltGraph } from './graphBuilder';
import { BubbleSimulation } from './simulation';
import { CanvasRenderer, ViewportTransform, RenderState } from './canvasRenderer';

export const BUBBLE_GRAPH_VIEW_TYPE = 'pakcli-bubble-graph';

export class BubbleGraphView extends ItemView {
    private plugin: PakCLITablePlugin;
    private canvasEl!: HTMLCanvasElement;
    private renderer!: CanvasRenderer;
    private simulation!: BubbleSimulation;

    private graphData!: BuiltGraph;
    private transform: ViewportTransform = { panX: 0, panY: 0, zoom: 1.0 };
    private animFrameId: number | null = null;

    // Interactive State
    private layoutMode: 'bubble' | 'default' = 'bubble';
    private maxDragDepth: number = 2;
    private hoveredNode: BubbleNode | null = null;
    private hoveredCluster: BubbleCluster | null = null;
    private selectedNode: BubbleNode | null = null;
    private searchQuery: string = '';
    private scopeFilter: string = 'all';

    // Label & Line Controls
    private showLabels: boolean = true;
    private showLines: boolean = true;
    private labelRangeLevel: number = 2; // 0=None, 1=Hubs/Active, 2=Docs, 3=All
    private labelFontSize: number = 11; // 8 - 24px

    // Timelapse State
    private timelapseMode: 'date' | 'vanilla' = 'date';
    private sortedNodes: BubbleNode[] = [];
    private isTimelapseRunning: boolean = false;
    private timelapseProgress: number = 1.0; // 0.0 (oldest) to 1.0 (present)
    private timelapseMinCtime: number = 0;
    private timelapseMaxCtime: number = 0;
    private lastVisibleCount: number = -1;

    // Drag / Pan state
    private isPanning: boolean = false;
    private panStartX: number = 0;
    private panStartY: number = 0;
    private isDraggingNode: boolean = false;

    // UI Elements
    private statsPillEl!: HTMLElement;
    private inspectorEl!: HTMLElement;
    private isInspectorOpen: boolean = true;
    private depthButtons: HTMLElement[] = [];
    private wandBtnEl!: HTMLElement;
    private linesToggleBtnEl!: HTMLElement;
    private textToggleBtnEl!: HTMLElement;
    private levelButtons: HTMLElement[] = [];
    private fontSizeSliderEl!: HTMLInputElement;
    private fontSizeDisplayEl!: HTMLElement;
    private timelinePlayBtnEl!: HTMLElement;
    private timelineSliderEl!: HTMLInputElement;
    private timelineDateBadgeEl!: HTMLElement;
    private timelapseModeButtons: HTMLElement[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: PakCLITablePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return BUBBLE_GRAPH_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Bubble Graph View';
    }

    getIcon(): string {
        return this.plugin.settings.bubbleRibbonIcon || 'circle-dot';
    }

    async onOpen(): Promise<void> {
        const container = this.contentEl;
        container.empty();
        container.addClass('pakcli-bubble-graph-container');

        this.layoutMode = this.plugin.settings.bubbleDefaultLayout || 'bubble';
        this.maxDragDepth = this.plugin.settings.bubbleMaxDragDepth ?? 2;
        this.showLabels = this.plugin.settings.bubbleShowLabels !== false;
        this.showLines = this.plugin.settings.bubbleShowLines !== false;
        this.timelapseMode = this.plugin.settings.bubbleTimelapseMode || 'date';

        // 1. Build Header Bar
        this.renderHeader(container);

        // 2. Build Workspace Split Area (Canvas + Inspector)
        const workspaceEl = container.createDiv({ cls: 'pakcli-bubble-workspace' });

        const canvasWrap = workspaceEl.createDiv({ cls: 'pakcli-bubble-canvas-wrap' });
        this.canvasEl = canvasWrap.createEl('canvas', { cls: 'pakcli-bubble-canvas' });
        this.renderer = new CanvasRenderer(this.canvasEl);

        this.renderInspector(workspaceEl);

        // 3. Build Bottom Timeline Minimap Scrubber
        this.renderTimelineScrubber(container);

        // 4. Initialize Graph & Simulation
        this.reloadGraphData();

        // 5. Setup Event Listeners
        this.setupCanvasEvents();
        this.setupResizeObserver(canvasWrap);

        // Listen for active note changes in Obsidian workspace
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file && this.graphData) {
                    const activePath = file.path;
                    let foundNode: BubbleNode | null = null;
                    for (const node of this.graphData.nodes) {
                        const wasActive = node.isActive;
                        node.isActive = node.id === activePath;
                        if (node.isActive) {
                            node.glyph = 'active';
                            foundNode = node;
                        } else if (wasActive) {
                            node.glyph = node.totalDegree <= 1 ? 'leaf' : 'document';
                        }
                    }
                    if (foundNode) {
                        this.selectNode(foundNode, false);
                    }
                }
            })
        );

        // 6. Start Render Loop
        this.startRenderLoop();
    }

    async onClose(): Promise<void> {
        if (this.animFrameId !== null) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    private reloadGraphData(): void {
        const activeFile = this.app.workspace.getActiveFile();
        this.graphData = buildVaultGraph(this.app, activeFile ? activeFile.path : null);

        // Sort all nodes chronologically by ctime for sequential vanilla timelapse
        this.sortedNodes = [...this.graphData.nodes].sort((a, b) => (a.ctime || 0) - (b.ctime || 0));

        // Compute min and max ctime for chronological timelapse
        const ctimes = this.graphData.nodes.map(n => n.ctime).filter(t => t && t > 0);
        if (ctimes.length > 0) {
            this.timelapseMinCtime = Math.min(...ctimes);
            this.timelapseMaxCtime = Math.max(...ctimes);
            if (this.timelapseMinCtime === this.timelapseMaxCtime) {
                this.timelapseMinCtime -= 86400000;
            }
        } else {
            this.timelapseMinCtime = Date.now() - 30 * 86400000;
            this.timelapseMaxCtime = Date.now();
        }
        this.timelapseProgress = 1.0;
        this.isTimelapseRunning = false;
        this.updateTimelineUI();

        this.simulation = new BubbleSimulation(
            this.graphData.nodes,
            this.graphData.edges,
            this.graphData.clusters,
            {
                maxDragDepth: this.maxDragDepth,
                layoutMode: this.layoutMode
            }
        );

        this.updateStatsPill();
        if (activeFile) {
            const activeNode = this.graphData.nodeMap.get(activeFile.path);
            if (activeNode) {
                this.selectNode(activeNode, false);
            }
        }
    }

    private renderHeader(container: HTMLElement): void {
        const headerEl = container.createDiv({ cls: 'pakcli-bubble-header' });

        // Left Branding & Tabs
        const leftGroup = headerEl.createDiv({ cls: 'pakcli-header-left' });
        const brandBadge = leftGroup.createDiv({ cls: 'pakcli-brand-badge' });
        brandBadge.createSpan({ text: '🫧 BUBBLE VIEW', cls: 'pakcli-brand-title' });

        const tabsWrap = leftGroup.createDiv({ cls: 'pakcli-mode-tabs' });
        const defaultTab = tabsWrap.createEl('button', {
            text: 'Graph View',
            cls: `pakcli-tab-btn ${this.layoutMode === 'default' ? 'active' : ''}`
        });
        const bubbleTab = tabsWrap.createEl('button', {
            text: '★ Bubble View',
            cls: `pakcli-tab-btn ${this.layoutMode === 'bubble' ? 'active' : ''}`
        });

        defaultTab.onclick = () => {
            this.layoutMode = 'default';
            defaultTab.addClass('active');
            bubbleTab.removeClass('active');
            this.simulation.setOptions({ layoutMode: 'default' });
        };

        bubbleTab.onclick = () => {
            this.layoutMode = 'bubble';
            bubbleTab.addClass('active');
            defaultTab.removeClass('active');
            this.simulation.setOptions({ layoutMode: 'bubble' });
        };

        // Middle Drag Depth Scrubber
        const depthGroup = headerEl.createDiv({ cls: 'pakcli-depth-group' });
        depthGroup.createSpan({ text: 'Depth:', cls: 'pakcli-depth-label' });
        const depthWrap = depthGroup.createDiv({ cls: 'pakcli-depth-buttons' });

        const depths = [
            { level: 0, label: '0: Lock' },
            { level: 1, label: '1: Folder' },
            { level: 2, label: '2: Subfolder' },
            { level: 3, label: '3: Child' }
        ];

        this.depthButtons = depths.map(d => {
            const btn = depthWrap.createEl('button', {
                text: d.label,
                cls: `pakcli-depth-btn ${this.maxDragDepth === d.level ? 'active' : ''}`
            });
            btn.onclick = () => {
                this.maxDragDepth = d.level;
                this.depthButtons.forEach(b => b.removeClass('active'));
                btn.addClass('active');
                this.simulation.setOptions({ maxDragDepth: d.level });
            };
            return btn;
        });

        // Text & Line Controls Group
        const textGroup = headerEl.createDiv({ cls: 'pakcli-text-controls-group' });

        // 1. Show Lines Toggle (Edges show or hide)
        this.linesToggleBtnEl = textGroup.createEl('button', {
            cls: `pakcli-icon-btn pakcli-lines-toggle-btn ${this.showLines ? 'active' : ''}`,
            title: 'Toggle Lines (Show/Hide)'
        });
        setIcon(this.linesToggleBtnEl, 'link');
        this.linesToggleBtnEl.onclick = async () => {
            this.showLines = !this.showLines;
            if (this.showLines) {
                this.linesToggleBtnEl.addClass('active');
            } else {
                this.linesToggleBtnEl.removeClass('active');
            }
            this.plugin.settings.bubbleShowLines = this.showLines;
            await this.plugin.saveSettings();
        };

        // 2. Show Text Node Toggle
        this.textToggleBtnEl = textGroup.createEl('button', {
            cls: `pakcli-icon-btn pakcli-text-toggle-btn ${this.showLabels ? 'active' : ''}`,
            title: 'Toggle Text Labels'
        });
        setIcon(this.textToggleBtnEl, 'type');
        this.textToggleBtnEl.onclick = async () => {
            this.showLabels = !this.showLabels;
            if (this.showLabels) {
                this.textToggleBtnEl.addClass('active');
            } else {
                this.textToggleBtnEl.removeClass('active');
            }
            this.plugin.settings.bubbleShowLabels = this.showLabels;
            await this.plugin.saveSettings();
        };

        // 2. Show Text Range Level 0-3
        const levelGroup = textGroup.createDiv({ cls: 'pakcli-level-group' });
        levelGroup.createSpan({ text: 'Text Level:', cls: 'pakcli-level-label' });
        const levelWrap = levelGroup.createDiv({ cls: 'pakcli-level-buttons' });

        const levels = [
            { lvl: 0, label: '0', title: 'Level 0: No labels (hover / select only)' },
            { lvl: 1, label: '1', title: 'Level 1: Hubs & active notes only' },
            { lvl: 2, label: '2', title: 'Level 2: Hubs & documents (2+ links)' },
            { lvl: 3, label: '3', title: 'Level 3: All notes including leaves' }
        ];

        this.levelButtons = levels.map(l => {
            const btn = levelWrap.createEl('button', {
                text: l.label,
                cls: `pakcli-level-btn ${this.labelRangeLevel === l.lvl ? 'active' : ''}`,
                title: l.title
            });
            btn.onclick = () => {
                this.labelRangeLevel = l.lvl;
                this.levelButtons.forEach(b => b.removeClass('active'));
                btn.addClass('active');
            };
            return btn;
        });

        // 3. Text Size Slider
        const sizeGroup = textGroup.createDiv({ cls: 'pakcli-size-group' });
        sizeGroup.createSpan({ text: 'Size:', cls: 'pakcli-size-label' });
        this.fontSizeSliderEl = sizeGroup.createEl('input', {
            type: 'range',
            cls: 'pakcli-font-slider'
        });
        this.fontSizeSliderEl.min = '8';
        this.fontSizeSliderEl.max = '24';
        this.fontSizeSliderEl.step = '1';
        this.fontSizeSliderEl.value = this.labelFontSize.toString();

        this.fontSizeDisplayEl = sizeGroup.createSpan({
            text: `${this.labelFontSize}px`,
            cls: 'pakcli-size-display'
        });

        this.fontSizeSliderEl.oninput = () => {
            this.labelFontSize = parseInt(this.fontSizeSliderEl.value, 10) || 11;
            this.fontSizeDisplayEl.setText(`${this.labelFontSize}px`);
        };

        // Stats Pill
        this.statsPillEl = headerEl.createDiv({ cls: 'pakcli-stats-pill' });
        this.updateStatsPill();

        // Right Controls: Timelapse Wand & Search & Buttons
        const rightGroup = headerEl.createDiv({ cls: 'pakcli-header-right' });

        // 4. Timelapse Magic Wand Button (Identical to Obsidian vanilla graph "Start timelapse animation")
        this.wandBtnEl = rightGroup.createEl('button', {
            cls: `pakcli-icon-btn pakcli-wand-btn ${this.isTimelapseRunning ? 'active' : ''}`,
            title: 'Start timelapse animation'
        });
        setIcon(this.wandBtnEl, 'wand-2');
        this.wandBtnEl.onclick = () => this.toggleTimelapse();

        const searchWrap = rightGroup.createDiv({ cls: 'pakcli-search-wrap' });
        const searchInput = searchWrap.createEl('input', {
            type: 'text',
            placeholder: '🔍 Search notes...',
            cls: 'pakcli-search-input'
        });
        searchInput.oninput = () => {
            this.searchQuery = searchInput.value.toLowerCase().trim();
            if (this.searchQuery && this.graphData) {
                const matched = this.graphData.nodes.find(n =>
                    n.name.toLowerCase().includes(this.searchQuery) ||
                    n.folderPath.toLowerCase().includes(this.searchQuery)
                );
                if (matched) {
                    this.hoveredNode = matched;
                }
            } else {
                this.hoveredNode = null;
            }
        };

        // Reset View Button
        const fitBtn = rightGroup.createEl('button', { cls: 'pakcli-icon-btn', title: 'Fit to View' });
        setIcon(fitBtn, 'maximize-2');
        fitBtn.onclick = () => this.fitToView();

        // Refresh Button
        const refreshBtn = rightGroup.createEl('button', { cls: 'pakcli-icon-btn', title: 'Refresh Graph' });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.onclick = () => this.reloadGraphData();

        // Inspector Toggle Button
        const inspectorBtn = rightGroup.createEl('button', { cls: 'pakcli-icon-btn', title: 'Toggle Inspector' });
        setIcon(inspectorBtn, 'info');
        inspectorBtn.onclick = () => {
            this.isInspectorOpen = !this.isInspectorOpen;
            if (this.isInspectorOpen) {
                this.inspectorEl.removeClass('collapsed');
            } else {
                this.inspectorEl.addClass('collapsed');
            }
        };
    }

    private toggleTimelapse(): void {
        if (this.isTimelapseRunning) {
            this.pauseTimelapse();
        } else {
            if (this.timelapseProgress >= 1.0) {
                this.timelapseProgress = 0.0;
                this.lastVisibleCount = -1;
            }
            this.startTimelapse();
        }
    }

    private startTimelapse(): void {
        this.isTimelapseRunning = true;
        this.updateTimelineUI();
    }

    private pauseTimelapse(): void {
        this.isTimelapseRunning = false;
        this.updateTimelineUI();
    }

    private updateTimelineUI(): void {
        if (this.timelineSliderEl) {
            this.timelineSliderEl.value = Math.round(this.timelapseProgress * 1000).toString();
        }
        if (this.timelineDateBadgeEl && this.graphData) {
            const totalCount = this.graphData.nodes.length;

            if (this.timelapseMode === 'vanilla') {
                const spawnedCount = Math.round(this.timelapseProgress * totalCount);
                if (this.timelapseProgress < 0.999 && spawnedCount < totalCount) {
                    const latestNode = spawnedCount > 0 ? this.sortedNodes[spawnedCount - 1] : this.sortedNodes[0];
                    const dateStr = latestNode?.ctime ? new Date(latestNode.ctime).toISOString().slice(0, 10) : '';
                    this.timelineDateBadgeEl.setText(`📅 ${dateStr} (${spawnedCount}/${totalCount} notes) • Vanilla 0.025s`);
                } else {
                    this.timelineDateBadgeEl.setText(`📅 Present (${totalCount}/${totalCount} notes) • Vanilla`);
                }
            } else {
                // Default: Date-based continuous timeline interpolation
                const cutoff = this.timelapseProgress < 0.999
                    ? this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress
                    : null;
                const visibleCount = this.graphData.nodes.filter(n => !cutoff || n.ctime <= cutoff).length;
                if (cutoff) {
                    const dateStr = new Date(cutoff).toISOString().slice(0, 10);
                    this.timelineDateBadgeEl.setText(`📅 ${dateStr} (${visibleCount}/${totalCount} notes) • Date-based`);
                } else {
                    this.timelineDateBadgeEl.setText(`📅 Present (${totalCount}/${totalCount} notes) • Date-based`);
                }
            }
        }
        if (this.wandBtnEl) {
            if (this.isTimelapseRunning) {
                this.wandBtnEl.addClass('active');
                this.wandBtnEl.setAttribute('title', 'Pause timelapse animation');
            } else {
                this.wandBtnEl.removeClass('active');
                const modeLabel = this.timelapseMode === 'vanilla' ? 'Vanilla 0.025s/node' : 'Date-based';
                this.wandBtnEl.setAttribute('title', `Start timelapse animation (${modeLabel})`);
            }
        }
        if (this.timelinePlayBtnEl) {
            setIcon(this.timelinePlayBtnEl, this.isTimelapseRunning ? 'pause' : 'play');
        }
    }

    private updateStatsPill(): void {
        if (!this.statsPillEl || !this.graphData) return;
        const s = this.graphData.stats;
        this.statsPillEl.setText(`Nodes: ${s.totalNodes}  |  Clusters: ${s.totalClusters}  |  Venn Bridges: ${s.totalVennBridges}`);
    }

    private renderInspector(parent: HTMLElement): void {
        this.inspectorEl = parent.createDiv({ cls: 'pakcli-bubble-inspector' });
        this.updateInspectorContent();
    }

    private updateInspectorContent(): void {
        if (!this.inspectorEl) return;
        this.inspectorEl.empty();

        const header = this.inspectorEl.createDiv({ cls: 'pakcli-inspector-header' });
        header.createSpan({ text: 'ℹ️ INSPECTOR', cls: 'pakcli-inspector-title' });

        if (!this.selectedNode) {
            const emptyState = this.inspectorEl.createDiv({ cls: 'pakcli-inspector-empty' });
            emptyState.createEl('p', { text: 'Click any note on the graph to inspect its hierarchy, Venn bridges, and connections.' });
            return;
        }

        const node = this.selectedNode;
        const details = this.inspectorEl.createDiv({ cls: 'pakcli-inspector-details' });

        // Note Title
        const titleRow = details.createDiv({ cls: 'pakcli-inspector-row' });
        titleRow.createSpan({ text: 'Active Note:', cls: 'pakcli-row-label' });
        titleRow.createEl('strong', { text: `📄 ${node.name}`, cls: 'pakcli-row-value primary' });

        // Folder
        const folderRow = details.createDiv({ cls: 'pakcli-inspector-row' });
        folderRow.createSpan({ text: 'Folder:', cls: 'pakcli-row-label' });
        folderRow.createSpan({ text: `📁 ${node.folderPath || '/'}`, cls: 'pakcli-row-value' });

        // Degree Centrality
        const degRow = details.createDiv({ cls: 'pakcli-inspector-row' });
        degRow.createSpan({ text: 'Degree Centrality:', cls: 'pakcli-row-label' });
        degRow.createSpan({ text: `${node.totalDegree} connections`, cls: 'pakcli-row-value' });

        // Scope Affinity
        const connectedEdges = this.graphData.edges.filter(e => e.source === node.id || e.target === node.id);
        const intraEdges = connectedEdges.filter(e => e.tier === 'tier1_intra');
        const affinityPercent = connectedEdges.length > 0
            ? Math.round((intraEdges.length / connectedEdges.length) * 100)
            : 100;

        const affinityRow = details.createDiv({ cls: 'pakcli-inspector-row' });
        affinityRow.createSpan({ text: 'Scope Affinity:', cls: 'pakcli-row-label' });
        affinityRow.createSpan({ text: `${affinityPercent}% Cluster`, cls: 'pakcli-row-value highlight' });

        // Backlinks Section
        const backSection = details.createDiv({ cls: 'pakcli-inspector-section' });
        const backlinks = this.graphData.edges
            .filter(e => e.target === node.id && e.sourceNode)
            .map(e => e.sourceNode!);
        backSection.createEl('h4', { text: `Backlinks (${backlinks.length}):` });
        const backList = backSection.createDiv({ cls: 'pakcli-link-list' });
        if (backlinks.length === 0) {
            backList.createSpan({ text: 'None', cls: 'pakcli-muted' });
        } else {
            backlinks.forEach(b => {
                const item = backList.createDiv({ text: `• ${b.name}`, cls: 'pakcli-link-item' });
                item.onclick = () => this.selectNode(b, true);
            });
        }

        // Outgoing Links Section
        const outSection = details.createDiv({ cls: 'pakcli-inspector-section' });
        const outgoing = this.graphData.edges
            .filter(e => e.source === node.id && e.targetNode)
            .map(e => e.targetNode!);
        outSection.createEl('h4', { text: `Outgoing (${outgoing.length}):` });
        const outList = outSection.createDiv({ cls: 'pakcli-link-list' });
        if (outgoing.length === 0) {
            outList.createSpan({ text: 'None', cls: 'pakcli-muted' });
        } else {
            outgoing.forEach(o => {
                const item = outList.createDiv({ text: `• ${o.name}`, cls: 'pakcli-link-item' });
                item.onclick = () => this.selectNode(o, true);
            });
        }

        // Open Note Button
        const openBtn = details.createEl('button', {
            text: 'Open Note ↗',
            cls: 'pakcli-open-note-btn'
        });
        openBtn.onclick = () => {
            this.openNoteInWorkspace(node.id);
        };
    }

    private renderTimelineScrubber(container: HTMLElement): void {
        const timelineEl = container.createDiv({ cls: 'pakcli-timeline-minimap' });

        this.timelinePlayBtnEl = timelineEl.createEl('button', {
            cls: 'pakcli-timeline-nav pakcli-timeline-play-btn',
            title: 'Play / Pause Timelapse'
        });
        setIcon(this.timelinePlayBtnEl, 'play');
        this.timelinePlayBtnEl.onclick = () => this.toggleTimelapse();

        const restartBtn = timelineEl.createEl('button', {
            cls: 'pakcli-timeline-nav',
            title: 'Restart from Oldest Note'
        });
        setIcon(restartBtn, 'rotate-ccw');
        restartBtn.onclick = () => {
            this.timelapseProgress = 0.0;
            this.lastVisibleCount = -1;
            this.startTimelapse();
        };

        timelineEl.createSpan({ text: '⏱ TIMELAPSE:', cls: 'pakcli-timeline-label' });

        // Mode Segmented Buttons: [ Date | Vanilla (0.025s) ]
        const modeGroup = timelineEl.createDiv({ cls: 'pakcli-timelapse-mode-group' });
        const dateModeBtn = modeGroup.createEl('button', {
            text: 'Date',
            cls: `pakcli-timelapse-mode-btn ${this.timelapseMode === 'date' ? 'active' : ''}`,
            title: 'Default: Date-based continuous timeline interpolation'
        });
        const vanillaModeBtn = modeGroup.createEl('button', {
            text: 'Vanilla (0.025s)',
            cls: `pakcli-timelapse-mode-btn ${this.timelapseMode === 'vanilla' ? 'active' : ''}`,
            title: 'Vanilla: Sequential spawn (0.025s per node/folder in chronological order)'
        });

        this.timelapseModeButtons = [dateModeBtn, vanillaModeBtn];

        dateModeBtn.onclick = () => {
            this.timelapseMode = 'date';
            dateModeBtn.addClass('active');
            vanillaModeBtn.removeClass('active');
            this.plugin.settings.bubbleTimelapseMode = 'date';
            this.plugin.saveSettings();
            this.lastVisibleCount = -1;
            this.updateTimelineUI();
        };

        vanillaModeBtn.onclick = () => {
            this.timelapseMode = 'vanilla';
            vanillaModeBtn.addClass('active');
            dateModeBtn.removeClass('active');
            this.plugin.settings.bubbleTimelapseMode = 'vanilla';
            this.plugin.saveSettings();
            this.lastVisibleCount = -1;
            this.updateTimelineUI();
        };

        const sliderWrap = timelineEl.createDiv({ cls: 'pakcli-timeline-track-wrap' });
        this.timelineSliderEl = sliderWrap.createEl('input', {
            type: 'range',
            cls: 'pakcli-timeline-slider'
        });
        this.timelineSliderEl.min = '0';
        this.timelineSliderEl.max = '1000';
        this.timelineSliderEl.step = '1';
        this.timelineSliderEl.value = '1000';

        this.timelineSliderEl.oninput = () => {
            this.timelapseProgress = parseFloat(this.timelineSliderEl.value) / 1000;
            this.lastVisibleCount = -1;
            this.updateTimelineUI();
        };

        this.timelineDateBadgeEl = timelineEl.createDiv({ cls: 'pakcli-timeline-date-badge' });
        this.updateTimelineUI();
    }

    private setupCanvasEvents(): void {
        const canvas = this.canvasEl;

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            const newZoom = Math.min(4.0, Math.max(0.15, this.transform.zoom * zoomFactor));

            // Zoom toward mouse position
            const rect = canvas.getBoundingClientRect();
            const mouseScreenX = e.clientX - rect.left - canvas.width / 2;
            const mouseScreenY = e.clientY - rect.top - canvas.height / 2;

            this.transform.panX -= (mouseScreenX - this.transform.panX) * (zoomFactor - 1);
            this.transform.panY -= (mouseScreenY - this.transform.panY) * (zoomFactor - 1);
            this.transform.zoom = newZoom;
        });

        canvas.addEventListener('mousedown', (e) => {
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const clickedNode = this.findNodeAt(worldPos.x, worldPos.y);

            if (clickedNode) {
                this.isDraggingNode = true;
                this.simulation.startDrag(clickedNode, worldPos.x, worldPos.y);
            } else {
                this.isPanning = true;
                this.panStartX = e.clientX - this.transform.panX;
                this.panStartY = e.clientY - this.transform.panY;
            }
        });

        window.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                if (!this.isPanning && !this.isDraggingNode) return;
            }

            const worldPos = this.screenToWorld(e.clientX, e.clientY);

            if (this.isDraggingNode) {
                this.simulation.updateDrag(worldPos.x, worldPos.y);
            } else if (this.isPanning) {
                this.transform.panX = e.clientX - this.panStartX;
                this.transform.panY = e.clientY - this.panStartY;
            } else {
                // Hover Detection
                const node = this.findNodeAt(worldPos.x, worldPos.y);
                this.hoveredNode = node;
                canvas.style.cursor = node ? 'pointer' : 'grab';

                // Check cluster hover if no node hovered
                if (!node && this.graphData) {
                    this.hoveredCluster = this.findClusterAt(worldPos.x, worldPos.y);
                } else {
                    this.hoveredCluster = null;
                }
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDraggingNode) {
                this.simulation.endDrag();
                this.isDraggingNode = false;
            }
            this.isPanning = false;
        });

        canvas.addEventListener('click', (e) => {
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const clickedNode = this.findNodeAt(worldPos.x, worldPos.y);
            if (clickedNode) {
                this.selectNode(clickedNode, false);
            }
        });

        canvas.addEventListener('dblclick', (e) => {
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const clickedNode = this.findNodeAt(worldPos.x, worldPos.y);
            if (clickedNode) {
                this.openNoteInWorkspace(clickedNode.id);
            }
        });
    }

    private setupResizeObserver(wrapEl: HTMLElement): void {
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    this.canvasEl.width = width;
                    this.canvasEl.height = height;
                }
            }
        });
        resizeObserver.observe(wrapEl);
    }

    private startRenderLoop(): void {
        let lastTime = performance.now();

        const renderLoop = (time: number) => {
            const dt = Math.min(64, time - lastTime);
            lastTime = time;

            if (this.isTimelapseRunning) {
                if (this.timelapseMode === 'vanilla') {
                    // Vanilla mode: 0.025s (25ms) per node / folder in chronological order
                    const delayPerNodeMs = (this.plugin.settings.bubbleTimelapseVanillaSpeed ?? 0.025) * 1000;
                    const totalDurationMs = Math.max(500, this.sortedNodes.length * delayPerNodeMs);
                    this.timelapseProgress += dt / totalDurationMs;
                } else {
                    // Default Date-based mode: ~12s continuous time range interpolation
                    this.timelapseProgress += dt / 12000;
                }

                if (this.timelapseProgress >= 1.0) {
                    this.timelapseProgress = 1.0;
                    this.pauseTimelapse();
                }
                this.updateTimelineUI();
            }

            let renderVisibleNodeIds: Set<string> | null = null;
            let renderCutoff: number | null = null;

            if (this.timelapseProgress < 0.999) {
                if (this.timelapseMode === 'vanilla') {
                    const count = Math.round(this.timelapseProgress * this.sortedNodes.length);
                    renderVisibleNodeIds = new Set(this.sortedNodes.slice(0, count).map(n => n.id));
                } else {
                    renderCutoff = this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress;
                    renderVisibleNodeIds = new Set(this.graphData.nodes.filter(n => n.ctime <= renderCutoff!).map(n => n.id));
                }
            }

            const currentVisibleCount = renderVisibleNodeIds ? renderVisibleNodeIds.size : (this.graphData ? this.graphData.nodes.length : 0);
            if (currentVisibleCount !== this.lastVisibleCount) {
                this.lastVisibleCount = currentVisibleCount;
                if (this.simulation) {
                    this.simulation.reheat(0.35);
                }
            }

            if (this.simulation) {
                this.simulation.step(renderVisibleNodeIds);
            }

            if (this.renderer && this.graphData) {

                const renderState: RenderState = {
                    nodes: this.graphData.nodes,
                    edges: this.graphData.edges,
                    clusters: this.graphData.clusters,
                    nodeMap: this.graphData.nodeMap,
                    layoutMode: this.layoutMode,
                    hoveredNode: this.hoveredNode,
                    hoveredCluster: this.hoveredCluster,
                    selectedNode: this.selectedNode,
                    searchQuery: this.searchQuery,
                    scopeFilter: this.scopeFilter,
                    showVennBridges: this.plugin.settings.bubbleShowVennBridges !== false,
                    interLinkGlow: this.plugin.settings.bubbleInterLinkGlow !== false,
                    showLines: this.showLines,
                    showLabels: this.showLabels,
                    labelRangeLevel: this.labelRangeLevel,
                    labelFontSize: this.labelFontSize,
                    hullOpacity: this.plugin.settings.bubbleHullOpacity || 0.12,
                    intraLinkOpacity: this.plugin.settings.bubbleIntraLinkOpacity || 0.2,
                    timelapseCtimeCutoff: renderCutoff,
                    timelapseVisibleNodeIds: renderVisibleNodeIds
                };

                this.renderer.render(this.transform, renderState, time);
            }

            this.animFrameId = requestAnimationFrame(renderLoop);
        };

        this.animFrameId = requestAnimationFrame(renderLoop);
    }

    private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
        const rect = this.canvasEl.getBoundingClientRect();
        const screenX = clientX - rect.left - this.canvasEl.width / 2;
        const screenY = clientY - rect.top - this.canvasEl.height / 2;

        return {
            x: (screenX - this.transform.panX) / this.transform.zoom,
            y: (screenY - this.transform.panY) / this.transform.zoom
        };
    }

    private findNodeAt(worldX: number, worldY: number): BubbleNode | null {
        if (!this.graphData) return null;

        let visibleSet: Set<string> | null = null;
        let cutoff: number | null = null;

        if (this.timelapseProgress < 0.999) {
            if (this.timelapseMode === 'vanilla') {
                const count = Math.round(this.timelapseProgress * this.sortedNodes.length);
                visibleSet = new Set(this.sortedNodes.slice(0, count).map(n => n.id));
            } else {
                cutoff = this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress;
            }
        }

        for (let i = this.graphData.nodes.length - 1; i >= 0; i--) {
            const node = this.graphData.nodes[i];
            if (visibleSet && !visibleSet.has(node.id)) continue;
            if (cutoff && node.ctime > cutoff) continue;
            const dist = Math.hypot(node.x - worldX, node.y - worldY);
            if (dist <= node.radius + 4) {
                return node;
            }
        }
        return null;
    }

    private findClusterAt(worldX: number, worldY: number): BubbleCluster | null {
        if (!this.graphData) return null;

        let visibleSet: Set<string> | null = null;
        let cutoff: number | null = null;

        if (this.timelapseProgress < 0.999) {
            if (this.timelapseMode === 'vanilla') {
                const count = Math.round(this.timelapseProgress * this.sortedNodes.length);
                visibleSet = new Set(this.sortedNodes.slice(0, count).map(n => n.id));
            } else {
                cutoff = this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress;
            }
        }

        for (const cluster of this.graphData.clusters) {
            if (visibleSet || cutoff) {
                const hasVisible = cluster.nodeIds.some(id => {
                    const n = this.graphData.nodeMap.get(id);
                    if (!n) return false;
                    if (visibleSet) return visibleSet.has(id);
                    if (cutoff) return n.ctime <= cutoff;
                    return true;
                });
                if (!hasVisible) continue;
            }

            const b = cluster.boundingBox;
            if (worldX >= b.minX && worldX <= b.maxX && worldY >= b.minY && worldY <= b.maxY) {
                return cluster;
            }
        }
        return null;
    }

    public selectNode(node: BubbleNode, centerCamera: boolean = true): void {
        this.selectedNode = node;
        this.updateInspectorContent();

        if (centerCamera) {
            this.transform.panX = -node.x * this.transform.zoom;
            this.transform.panY = -node.y * this.transform.zoom;
        }
    }

    public openNoteInWorkspace(filePath: string): void {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    private fitToView(): void {
        if (!this.graphData || this.graphData.nodes.length === 0) return;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const node of this.graphData.nodes) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x);
            maxY = Math.max(maxY, node.y);
        }

        const width = maxX - minX + 120;
        const height = maxY - minY + 120;
        const scaleX = this.canvasEl.width / width;
        const scaleY = this.canvasEl.height / height;
        const newZoom = Math.min(2.0, Math.max(0.3, Math.min(scaleX, scaleY)));

        this.transform.zoom = newZoom;
        this.transform.panX = -((minX + maxX) / 2) * newZoom;
        this.transform.panY = -((minY + maxY) / 2) * newZoom;
    }
}

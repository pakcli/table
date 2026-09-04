import { BubbleNode, BubbleEdge, BubbleCluster } from './types';
import { createSmoothHullPath } from './hullGenerator';

export interface ViewportTransform {
    panX: number;
    panY: number;
    zoom: number;
}

export interface RenderState {
    nodes: BubbleNode[];
    edges: BubbleEdge[];
    clusters: BubbleCluster[];
    nodeMap: Map<string, BubbleNode>;
    layoutMode: 'bubble' | 'default';
    hoveredNode: BubbleNode | null;
    hoveredCluster: BubbleCluster | null;
    selectedNode: BubbleNode | null;
    searchQuery: string;
    scopeFilter: string;
    showVennBridges: boolean;
    interLinkGlow: boolean;
    showLines: boolean;
    showLabels: boolean;
    labelRangeLevel: number; // 0 = none, 1 = hubs, 2 = hubs+docs, 3 = all
    labelFontSize: number; // 8 to 24px
    hullOpacity: number;
    intraLinkOpacity: number;
    timelapseCtimeCutoff?: number | null;
    timelapseVisibleNodeIds?: Set<string> | null;
}

export class CanvasRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private animationTime: number = 0;

    private isNodeVisible(node: BubbleNode, state: RenderState): boolean {
        if (state.timelapseVisibleNodeIds) {
            return state.timelapseVisibleNodeIds.has(node.id);
        }
        if (state.timelapseCtimeCutoff) {
            return node.ctime <= state.timelapseCtimeCutoff;
        }
        return true;
    }

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Failed to obtain 2D rendering context');
        }
        this.ctx = context;
    }

    public render(transform: ViewportTransform, state: RenderState, time: number): void {
        this.animationTime = time;
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Save base state
        ctx.save();

        // 1. Draw subtle grid in screen coordinates
        this.drawBackgroundGrid(transform, width, height);

        // 2. Apply viewport transform (pan & zoom)
        ctx.translate(width / 2 + transform.panX, height / 2 + transform.panY);
        ctx.scale(transform.zoom, transform.zoom);

        // Hover neighbor set for fast lookup
        const hoveredNeighbors = new Set<string>();
        if (state.hoveredNode) {
            hoveredNeighbors.add(state.hoveredNode.id);
            for (const edge of state.edges) {
                if (edge.source === state.hoveredNode.id) hoveredNeighbors.add(edge.target);
                if (edge.target === state.hoveredNode.id) hoveredNeighbors.add(edge.source);
            }
        }

        // 3. Draw Bubble Contour Hulls (if bubble layout mode enabled)
        if (state.layoutMode === 'bubble') {
            this.drawClusterHulls(state, transform.zoom);
        }

        // 4. Draw Links (3-Tier Hierarchy)
        this.drawEdges(state, hoveredNeighbors);

        // 5. Draw Node Glyphs
        this.drawNodes(state, hoveredNeighbors, transform.zoom);

        // Restore base state
        ctx.restore();

        // 6. Draw Screen-Space Tooltip
        if (state.hoveredNode) {
            this.drawTooltip(state.hoveredNode, transform, width, height);
        }
    }

    private drawBackgroundGrid(transform: ViewportTransform, width: number, height: number): void {
        const ctx = this.ctx;
        const gridSize = 40 * transform.zoom;
        if (gridSize < 12) return; // Too dense to render

        const offsetX = (width / 2 + transform.panX) % gridSize;
        const offsetY = (height / 2 + transform.panY) % gridSize;

        ctx.fillStyle = 'rgba(150, 160, 180, 0.04)';
        for (let x = offsetX; x < width; x += gridSize) {
            for (let y = offsetY; y < height; y += gridSize) {
                ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
            }
        }
    }

    private drawClusterHulls(state: RenderState, zoom: number): void {
        const ctx = this.ctx;

        // Draw top-level clusters first, then nested subfolders
        const sortedClusters = [...state.clusters].sort((a, b) => a.depth - b.depth);

        for (const cluster of sortedClusters) {
            if (cluster.hullPolygon.length < 3) continue;

            if (state.timelapseVisibleNodeIds || state.timelapseCtimeCutoff) {
                const hasVisible = cluster.nodeIds.some(id => {
                    const n = state.nodeMap.get(id);
                    return n ? this.isNodeVisible(n, state) : false;
                });
                if (!hasVisible) continue;
            }

            const isHovered = state.hoveredCluster?.id === cluster.id;
            const isDimmed = state.hoveredNode && !cluster.nodeIds.includes(state.hoveredNode.id);

            ctx.save();
            if (isDimmed) {
                ctx.globalAlpha = 0.2;
            }

            // Create smooth Bézier path
            createSmoothHullPath(ctx, cluster.hullPolygon);

            // Fill styling
            const baseColor = cluster.color || '#38bdf8';
            if (cluster.depth === 1) {
                // Top-level Parent Bubble
                const fillAlpha = isHovered ? state.hullOpacity * 2.2 : state.hullOpacity;
                ctx.fillStyle = this.hexToRgba(baseColor, fillAlpha);
                ctx.fill();

                // Glow contour stroke
                if (isHovered) {
                    ctx.shadowColor = baseColor;
                    ctx.shadowBlur = 16;
                    ctx.strokeStyle = this.hexToRgba(baseColor, 0.9);
                    ctx.lineWidth = 2.5;
                } else {
                    ctx.strokeStyle = this.hexToRgba(baseColor, 0.35);
                    ctx.lineWidth = 1.4;
                }
                ctx.stroke();
            } else {
                // Nested Child Bubble (Subfolder) - Solid continuous stroke (no dashes)
                const fillAlpha = isHovered ? 0.25 : 0.08;
                ctx.fillStyle = this.hexToRgba(baseColor, fillAlpha);
                ctx.fill();

                ctx.strokeStyle = this.hexToRgba(baseColor, isHovered ? 0.85 : 0.45);
                ctx.lineWidth = 1.3;
                ctx.stroke();
            }

            // Folder Label Tab Badge (Spec v18: ╭┤ 01-projects ├╮)
            if (cluster.depth === 1 && state.showLabels) {
                this.drawClusterFolderTab(cluster, baseColor, isHovered, state);
            }

            ctx.restore();
        }
    }

    private drawClusterFolderTab(
        cluster: BubbleCluster,
        color: string,
        isHovered: boolean,
        state: RenderState
    ): void {
        const visibleCount = (state.timelapseVisibleNodeIds || state.timelapseCtimeCutoff)
            ? cluster.nodeIds.filter(id => {
                const n = state.nodeMap.get(id);
                return n ? this.isNodeVisible(n, state) : false;
            }).length
            : cluster.nodeIds.length;

        if (visibleCount === 0) return;

        const ctx = this.ctx;
        const box = cluster.boundingBox;

        const labelText = `📁 ${cluster.name} (${visibleCount})`;
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        const textWidth = ctx.measureText(labelText).width;
        const tabWidth = textWidth + 18;
        const tabHeight = 22;

        const tabX = cluster.centroid.x - tabWidth / 2;
        const tabY = box.minY - 12;

        ctx.save();
        // Pill background
        ctx.beginPath();
        ctx.roundRect(tabX, tabY, tabWidth, tabHeight, 6);
        ctx.fillStyle = isHovered ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.82)';
        ctx.fill();

        ctx.strokeStyle = isHovered ? color : this.hexToRgba(color, 0.55);
        ctx.lineWidth = isHovered ? 1.5 : 1;
        ctx.stroke();

        // Label Text
        ctx.fillStyle = isHovered ? '#ffffff' : '#cbd5e1';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, tabX + 9, tabY + tabHeight / 2);

        ctx.restore();
    }

    private drawEdges(state: RenderState, hoveredNeighbors: Set<string>): void {
        const ctx = this.ctx;

        for (const edge of state.edges) {
            const src = edge.sourceNode;
            const tgt = edge.targetNode;
            if (!src || !tgt) continue;

            if (!this.isNodeVisible(src, state) || !this.isNodeVisible(tgt, state)) continue;

            const isEdgeConnectedToHover = state.hoveredNode &&
                (edge.source === state.hoveredNode.id || edge.target === state.hoveredNode.id);

            if (!state.showLines && !isEdgeConnectedToHover) continue;

            const isDimmed = state.hoveredNode && !isEdgeConnectedToHover;

            ctx.save();

            if (isDimmed) {
                ctx.globalAlpha = 0.08;
            }

            if (edge.tier === 'tier2_inter') {
                // Tier 2: Inter-Folder Venn Bridge (High-Contrast Glow)
                if (state.showVennBridges) {
                    const isGlowing = state.interLinkGlow || isEdgeConnectedToHover;
                    if (isGlowing && isEdgeConnectedToHover) {
                        ctx.shadowColor = '#00f2ff';
                        ctx.shadowBlur = 12;
                    }
                    ctx.strokeStyle = isEdgeConnectedToHover ? '#00f2ff' : 'rgba(0, 242, 255, 0.4)';
                    ctx.lineWidth = isEdgeConnectedToHover ? 2.4 : 1.3;
                    ctx.beginPath();
                    ctx.moveTo(src.x, src.y);
                    ctx.lineTo(tgt.x, tgt.y);
                    ctx.stroke();
                }
            } else {
                // Tier 1: Intra-Folder Sibling (Thin, low visual weight)
                ctx.strokeStyle = isEdgeConnectedToHover
                    ? src.color
                    : `rgba(148, 163, 184, ${state.intraLinkOpacity})`;
                ctx.lineWidth = isEdgeConnectedToHover ? 1.8 : 1.0;
                ctx.beginPath();
                ctx.moveTo(src.x, src.y);
                ctx.lineTo(tgt.x, tgt.y);
                ctx.stroke();
            }

            // Tier 3: Directional Flow / Hover Marching Particles
            if (isEdgeConnectedToHover || (state.showLines && src.isActive && edge.tier === 'tier2_inter')) {
                this.drawFlowParticle(src, tgt, edge.tier === 'tier2_inter' ? '#00f2ff' : src.color);
            }

            ctx.restore();
        }
    }

    private drawFlowParticle(
        src: BubbleNode,
        tgt: BubbleNode,
        color: string
    ): void {
        const ctx = this.ctx;
        const progress = (this.animationTime % 1200) / 1200;
        const px = src.x + (tgt.x - src.x) * progress;
        const py = src.y + (tgt.y - src.y) * progress;

        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.restore();
    }

    private drawNodes(state: RenderState, hoveredNeighbors: Set<string>, zoom: number): void {
        const ctx = this.ctx;

        for (const node of state.nodes) {
            if (!this.isNodeVisible(node, state)) continue;

            const isHovered = state.hoveredNode?.id === node.id;
            const isNeighbor = hoveredNeighbors.has(node.id);
            const isSelected = state.selectedNode?.id === node.id;
            const isDimmed = state.hoveredNode && !isHovered && !isNeighbor;

            ctx.save();
            if (isDimmed) {
                ctx.globalAlpha = 0.12;
            }

            // Draw Node Glyphs according to Spec v18
            switch (node.glyph) {
                case 'active':
                    this.drawActiveNodeGlyph(node);
                    break;
                case 'hub':
                    this.drawHubNodeGlyph(node, isHovered, isSelected);
                    break;
                case 'leaf':
                    this.drawLeafNodeGlyph(node, isHovered);
                    break;
                case 'document':
                default:
                    this.drawStandardDocumentGlyph(node, isHovered, isSelected);
                    break;
            }

            // Draw Labels (Level 0-3 Range + Font Size Slider)
            let isLevelAllowed = false;
            const level = state.labelRangeLevel ?? 2;
            if (level === 0) {
                isLevelAllowed = false; // 0 = None
            } else if (level === 1) {
                isLevelAllowed = node.glyph === 'hub' || node.glyph === 'active';
            } else if (level === 2) {
                isLevelAllowed = node.glyph === 'hub' || node.glyph === 'active' || node.totalDegree >= 2 || (zoom > 1.2 && node.totalDegree >= 1);
            } else {
                isLevelAllowed = true; // 3 = All
            }

            const shouldShowLabel = state.showLabels && (
                isHovered ||
                isSelected ||
                isLevelAllowed
            );

            if (shouldShowLabel) {
                this.drawNodeLabel(node, isHovered || isSelected, state.labelFontSize || 11);
            }

            ctx.restore();
        }
    }

    // Spec v18: ((•)) Active Node (Fixed r=8px + animated radial pulse aura)
    private drawActiveNodeGlyph(node: BubbleNode): void {
        const ctx = this.ctx;

        // Animated radial pulse aura
        const pulse = (this.animationTime % 1500) / 1500;
        const maxWaveR = node.radius + 14;
        const currentWaveR = node.radius + pulse * 14;
        const waveAlpha = (1 - pulse) * 0.7;

        ctx.beginPath();
        ctx.arc(node.x, node.y, currentWaveR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 242, 255, ${waveAlpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Core Glowing Node
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#00f2ff';
        ctx.shadowColor = '#00f2ff';
        ctx.shadowBlur = 16;
        ctx.fill();

        // Inner Dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }

    // Spec v18: ( + ) Folder Hub / Index (r = 6 + sqrt(deg_in + deg_out))
    private drawHubNodeGlyph(node: BubbleNode, isHovered: boolean, isSelected: boolean): void {
        const ctx = this.ctx;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        if (isHovered || isSelected) {
            ctx.shadowColor = node.color;
            ctx.shadowBlur = 14;
        }
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Center '+' glyph
        const crossSize = Math.max(3, node.radius * 0.45);
        ctx.beginPath();
        ctx.moveTo(node.x - crossSize, node.y);
        ctx.lineTo(node.x + crossSize, node.y);
        ctx.moveTo(node.x, node.y - crossSize);
        ctx.lineTo(node.x, node.y + crossSize);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Spec v18: ( • ) Standard Document (r = 3 + sqrt(deg_total))
    private drawStandardDocumentGlyph(node: BubbleNode, isHovered: boolean, isSelected: boolean): void {
        const ctx = this.ctx;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        if (isHovered || isSelected) {
            ctx.shadowColor = node.color;
            ctx.shadowBlur = 10;
        }
        ctx.fill();

        // Center dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(1.2, node.radius * 0.35), 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }

    // Spec v18: ( ▫ ) Leaf / Term Entry (Compact r=2.5px)
    private drawLeafNodeGlyph(node: BubbleNode, isHovered: boolean): void {
        const ctx = this.ctx;
        const size = node.radius * 1.8;

        ctx.save();
        ctx.translate(node.x, node.y);
        ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(203, 213, 225, 0.7)';
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
    }

    private drawNodeLabel(node: BubbleNode, isProminent: boolean, baseFontSize: number = 11): void {
        const ctx = this.ctx;
        const label = node.name;
        const fontSize = isProminent ? baseFontSize + 1 : baseFontSize;
        ctx.font = `${isProminent ? '600' : '400'} ${fontSize}px Inter, system-ui, sans-serif`;

        const textX = node.x + node.radius + 5;
        const textY = node.y + fontSize * 0.35;

        // Dark background halo for high contrast
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.lineWidth = 3;
        ctx.strokeText(label, textX, textY);

        ctx.fillStyle = isProminent ? '#ffffff' : '#e2e8f0';
        ctx.fillText(label, textX, textY);
    }

    private drawTooltip(
        node: BubbleNode,
        transform: ViewportTransform,
        width: number,
        height: number
    ): void {
        const ctx = this.ctx;

        // Convert world coords to screen
        const screenX = width / 2 + transform.panX + node.x * transform.zoom;
        const screenY = height / 2 + transform.panY + node.y * transform.zoom;

        const glyphSymbol = node.glyph === 'hub' ? '( + )' : (node.glyph === 'active' ? '((•))' : (node.glyph === 'leaf' ? '( ▫ )' : '( • )'));
        const titleText = `${glyphSymbol} ${node.name}`;
        const folderText = `📁 ${node.folderPath || '/'}`;
        const statsText = `Links: ↗ ${node.outDegree}  |  ↖ ${node.inDegree}  |  Σ ${node.totalDegree}`;

        ctx.font = '600 12px Inter, system-ui, sans-serif';
        const titleWidth = ctx.measureText(titleText).width;
        ctx.font = '400 10px Inter, system-ui, sans-serif';
        const folderWidth = ctx.measureText(folderText).width;
        const statsWidth = ctx.measureText(statsText).width;

        const boxWidth = Math.max(titleWidth, folderWidth, statsWidth) + 24;
        const boxHeight = 62;
        const boxX = Math.min(width - boxWidth - 16, Math.max(16, screenX - boxWidth / 2));
        const boxY = Math.max(16, screenY - node.radius * transform.zoom - boxHeight - 12);

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.fill();
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = node.color;
        ctx.shadowBlur = 10;
        ctx.stroke();

        // Title
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(titleText, boxX + 12, boxY + 18);

        // Folder
        ctx.font = '400 10px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(folderText, boxX + 12, boxY + 36);

        // Stats
        ctx.font = '500 10px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(statsText, boxX + 12, boxY + 52);

        ctx.restore();
    }

    private hexToRgba(hex: string, alpha: number): string {
        let clean = hex.replace('#', '');
        if (clean.length === 3) {
            clean = clean.split('').map(c => c + c).join('');
        }
        const num = parseInt(clean, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}

import { BubbleNode, BubbleEdge, BubbleCluster } from './types';
import { updateClusterHulls } from './hullGenerator';

export interface SimulationOptions {
    maxDragDepth: number;
    layoutMode: 'bubble' | 'default';
    repulsionStrength?: number;
    linkStrength?: number;
    vennAttraction?: number;
    clusterCentroidStrength?: number;
    damping?: number;
}

export function computeLeafClusterRadius(nodeCount: number, depth: number): number {
    if (nodeCount <= 0) return 0;
    if (nodeCount === 1) return depth === 1 ? 32 : 22;
    if (nodeCount === 2) return depth === 1 ? 42 : 30;
    if (depth === 1) {
        return Math.max(48, Math.round(Math.sqrt(nodeCount) * 12.0 + 36));
    }
    const factor = Math.max(5.5, 8.5 - depth * 0.5);
    return Math.max(22, Math.round(Math.sqrt(nodeCount) * factor + 16));
}

export function computeClusterRadius(nodeCount: number, depth: number): number {
    return computeLeafClusterRadius(nodeCount, depth);
}

export function computeAllClusterRadii(clusters: BubbleCluster[], visibleNodeIds?: Set<string> | null): void {
    const sorted = [...clusters].sort((a, b) => b.depth - a.depth);
    for (const c of sorted) {
        const visibleIds = visibleNodeIds ? c.nodeIds.filter(id => visibleNodeIds.has(id)) : c.nodeIds;
        if (visibleIds.length === 0) {
            c.radius = 0;
            continue;
        }

        const childSubs = clusters.filter(s => s.parentClusterId === c.id && s.radius > 0);
        const directCount = c.directNodeIds 
            ? (visibleNodeIds ? c.directNodeIds.filter(id => visibleNodeIds.has(id)).length : c.directNodeIds.length)
            : Math.max(0, visibleIds.length - childSubs.reduce((sum, s) => sum + s.nodeIds.length, 0));

        const baseR = computeLeafClusterRadius(visibleIds.length, c.depth);
        if (childSubs.length === 0) {
            c.radius = baseR;
            continue;
        }

        let totalSubArea = 0;
        let maxSubRadius = 0;
        for (const sub of childSubs) {
            const sr = sub.radius + 1.5;
            totalSubArea += Math.PI * sr * sr;
            if (sub.radius > maxSubRadius) maxSubRadius = sub.radius;
        }

        const looseArea = directCount * (Math.PI * 14 * 14);
        const totalArea = totalSubArea + looseArea;
        const packingR = Math.ceil(Math.sqrt(totalArea / (Math.PI * 0.52)) + 14);
        c.radius = Math.max(baseR, packingR, maxSubRadius + (c.depth === 1 ? 24 : 18));
    }
}

export function computeTopClusterRadius(c: BubbleCluster, subClusters: BubbleCluster[], visibleNodeCount: number): number {
    const baseR = visibleNodeCount <= 1 ? 28
        : visibleNodeCount === 2 ? 38
        : computeLeafClusterRadius(visibleNodeCount, 1);

    const childSubs = subClusters.filter(s => s.parentClusterId === c.id && s.radius > 0);
    if (childSubs.length === 0) return baseR;

    let totalSubArea = 0;
    let maxSubRadius = 0;
    for (const sub of childSubs) {
        const sr = sub.radius + 1.5;
        totalSubArea += Math.PI * sr * sr;
        if (sub.radius > maxSubRadius) maxSubRadius = sub.radius;
    }

    const subNodeCount = childSubs.reduce((sum, s) => sum + s.nodeIds.length, 0);
    const looseCount = Math.max(0, visibleNodeCount - subNodeCount);
    const looseArea = looseCount * (Math.PI * 14 * 14);

    const totalArea = totalSubArea + looseArea;
    const packingR = Math.ceil(Math.sqrt(totalArea / (Math.PI * 0.52)) + 14);

    return Math.max(baseR, packingR, maxSubRadius + 24);
}


export class BubbleSimulation {
    private nodes: BubbleNode[] = [];
    private edges: BubbleEdge[] = [];
    private clusters: BubbleCluster[] = [];
    private nodeMap: Map<string, BubbleNode> = new Map();
    private options: SimulationOptions;

    private alpha: number = 1.0;
    private alphaMin: number = 0.001;
    private alphaDecay: number = 0.02;

    private draggedNodes: Array<{ node: BubbleNode; offsetX: number; offsetY: number }> = [];
    private isDragging: boolean = false;

    constructor(
        nodes: BubbleNode[],
        edges: BubbleEdge[],
        clusters: BubbleCluster[],
        options: SimulationOptions
    ) {
        this.nodes = nodes;
        this.edges = edges;
        this.clusters = clusters;
        this.options = {
            repulsionStrength: 500,
            linkStrength: 0.03,
            vennAttraction: 0.0,
            clusterCentroidStrength: 0.08,
            damping: 0.76,
            ...options
        };
        this.nodes.forEach(n => this.nodeMap.set(n.id, n));
        this.initializePositions();
    }

    private initializePositions(): void {
        const topClusters = this.clusters.filter(c => c.depth === 1);
        if (topClusters.length === 0) return;

        // 1. Precompute all cluster radii bottom-up across all depths (1 to 5)
        computeAllClusterRadii(this.clusters);
        for (const c of this.clusters) {
            c.vx = 0;
            c.vy = 0;
        }

        // 2. Position top-level clusters (depth 1) around orbit
        let totalDiameter = 0;
        const gap = 20;
        topClusters.forEach(c => {
            totalDiameter += (2 * c.radius + gap);
        });

        const orbitRadius = Math.max(40, (totalDiameter / (2 * Math.PI)) * 0.20);
        let currentAngle = 0;

        topClusters.forEach((cluster) => {
            const r = cluster.radius;
            const arc = ((2 * r + gap) / totalDiameter) * Math.PI * 2;
            const angle = currentAngle + arc / 2;
            currentAngle += arc;

            const cx = Math.cos(angle) * orbitRadius;
            const cy = Math.sin(angle) * orbitRadius;
            cluster.centroid = { x: cx, y: cy };
        });

        // 3. Position nested clusters hierarchically (depth 2 up to max depth)
        const maxDepth = Math.max(1, ...this.clusters.map(c => c.depth));
        for (let d = 2; d <= maxDepth; d++) {
            const parents = this.clusters.filter(c => c.depth === d - 1);
            for (const parent of parents) {
                const children = this.clusters.filter(c => c.depth === d && c.parentClusterId === parent.id && c.radius > 0);
                if (children.length === 0) continue;

                const numChildren = children.length;
                if (numChildren === 1) {
                    children[0].centroid = { x: parent.centroid.x, y: parent.centroid.y };
                } else {
                    children.forEach((child, idx) => {
                        const phi = idx * 2.3999632;
                        const dist = Math.sqrt((idx + 0.5) / numChildren) * Math.max(12, parent.radius - child.radius - 10);
                        child.centroid = {
                            x: parent.centroid.x + Math.cos(phi) * dist,
                            y: parent.centroid.y + Math.sin(phi) * dist
                        };
                    });

                    // PBD relaxation among sibling clusters inside parent
                    for (let iter = 0; iter < 15; iter++) {
                        for (let i = 0; i < children.length; i++) {
                            const ca = children[i];
                            for (let j = i + 1; j < children.length; j++) {
                                const cb = children[j];
                                const minD = ca.radius + cb.radius + 2;
                                const dx = cb.centroid.x - ca.centroid.x;
                                const dy = cb.centroid.y - ca.centroid.y;
                                const d2 = dx * dx + dy * dy;
                                if (d2 < minD * minD) {
                                    const dist = Math.sqrt(d2) || 0.001;
                                    const s = ((minD - dist) * 0.5) / dist;
                                    ca.centroid.x -= dx * s; ca.centroid.y -= dy * s;
                                    cb.centroid.x += dx * s; cb.centroid.y += dy * s;
                                }
                            }
                        }
                        for (const child of children) {
                            const maxSubD = Math.max(0, parent.radius - child.radius - 4);
                            const dx = child.centroid.x - parent.centroid.x;
                            const dy = child.centroid.y - parent.centroid.y;
                            const dist = Math.hypot(dx, dy) || 0.001;
                            if (dist > maxSubD) {
                                const scale = maxSubD / dist;
                                child.centroid.x = parent.centroid.x + dx * scale;
                                child.centroid.y = parent.centroid.y + dy * scale;
                            }
                        }
                    }
                }
            }
        }

        // 4. Place nodes inside their immediate deepest container cluster
        const clusterById = new Map<string, BubbleCluster>();
        for (const c of this.clusters) clusterById.set(c.id, c);

        const clusterDirectNodes = new Map<string, BubbleNode[]>();
        for (const c of this.clusters) clusterDirectNodes.set(c.id, []);

        for (const node of this.nodes) {
            if (!node.topLevelFolder || node.topLevelFolder === '/') continue;
            let targetCluster: BubbleCluster | undefined = clusterById.get(node.subClusterId);
            if (!targetCluster) {
                targetCluster = clusterById.get(node.clusterId);
            }
            if (targetCluster) {
                clusterDirectNodes.get(targetCluster.id)?.push(node);
            }
        }

        for (const [clusterId, directNodes] of clusterDirectNodes.entries()) {
            const cluster = clusterById.get(clusterId);
            if (!cluster || directNodes.length === 0) continue;

            const count = directNodes.length;
            if (count === 1) {
                directNodes[0].x = cluster.centroid.x;
                directNodes[0].y = cluster.centroid.y;
                directNodes[0].vx = 0;
                directNodes[0].vy = 0;
            } else {
                const spread = Math.max(6, cluster.radius * 0.60);
                directNodes.forEach((node, idx) => {
                    const phi = idx * 2.3999632;
                    const dist = Math.sqrt((idx + 0.5) / count) * spread;
                    node.x = cluster.centroid.x + Math.cos(phi) * dist;
                    node.y = cluster.centroid.y + Math.sin(phi) * dist;
                    node.vx = 0;
                    node.vy = 0;
                });
            }
        }

        this.nodes.forEach(n => {
            if (n.topLevelFolder === '/' && n.x === 0 && n.y === 0) {
                const angle = Math.random() * Math.PI * 2;
                const r = orbitRadius * 1.25 + Math.random() * 50;
                n.x = Math.cos(angle) * r;
                n.y = Math.sin(angle) * r;
                n.vx = 0; n.vy = 0;
            }
        });

        updateClusterHulls(this.clusters, this.nodeMap, 18, null, this.options.layoutMode === 'bubble');
    }

    public setOptions(opts: Partial<SimulationOptions>): void {
        this.options = { ...this.options, ...opts };
        this.reheat();
    }

    public reheat(amount: number = 0.4): void {
        this.alpha = Math.max(this.alpha, amount);
    }

    public step(visibleNodeIds?: Set<string> | null): boolean {
        const isBubbleMode = this.options.layoutMode === 'bubble';

        // In bubble mode: run FOREVER so gravity continuously pulls clusters to center.
        // In default mode: stop when settled (alpha < alphaMin).
        if (!this.isDragging && this.alpha < this.alphaMin) {
            if (!isBubbleMode) return false;
        }

        const alpha = this.alpha;
        const damping = this.options.damping || 0.76;

        if (isBubbleMode) {
            const clusterById = new Map<string, BubbleCluster>();
            this.clusters.forEach(c => clusterById.set(c.id, c));

            const getVisibleCount = (c: BubbleCluster): number => {
                if (!visibleNodeIds) return c.nodeIds.length;
                return c.nodeIds.filter(id => visibleNodeIds.has(id)).length;
            };

            const topClusters = this.clusters.filter(c => c.depth === 1);
            const topCount = topClusters.length;
            const subClusters = this.clusters.filter(c => c.depth === 2);

            // =====================================================================
            // LEVEL 1: TOP CLUSTERS — POSITION-BASED DYNAMICS (PBD)
            //
            // Gravity  = group center pull + centroid *= (1 - k) [direct shrink to center]
            // Separate = 10-pass iterative position projection [guaranteed no overlap]
            // Nodes    = shift by total centroid delta (gravity + separation)
            //
            // PBD has NO velocity channel → cannot oscillate, circle, or earthquake.
            // =====================================================================

            // 0. Update all cluster radii strictly across all depths (1 to 5)
            computeAllClusterRadii(this.clusters, visibleNodeIds);
            for (const c of this.clusters) { c.vx = 0; c.vy = 0; }

            // Snapshot ALL centroids before any change this frame
            const prevPos = new Map<string, { x: number; y: number }>();
            for (const c of this.clusters) prevPos.set(c.id, { x: c.centroid.x, y: c.centroid.y });

            // 1. Group-level centering: pull collective center of mass of top folders to (0, 0)
            let activeTopCount = 0;
            let comX = 0;
            let comY = 0;
            for (const c of topClusters) {
                if (c.radius === 0) continue;
                comX += c.centroid.x;
                comY += c.centroid.y;
                activeTopCount++;
            }
            if (activeTopCount > 0 && !this.isDragging) {
                comX /= activeTopCount;
                comY /= activeTopCount;
                const groupPullK = 0.05;
                for (const c of topClusters) {
                    if (c.radius === 0) continue;
                    c.centroid.x -= comX * groupPullK;
                    c.centroid.y -= comY * groupPullK;
                }
            }

            // 2. Top-level individual cluster gravity: steady inward pull toward (0,0)
            for (const c of topClusters) {
                if (c.radius === 0) continue;
                const d = Math.hypot(c.centroid.x, c.centroid.y) || 0.001;
                const pullSpeed = Math.min(d * 0.035 + 1.2, 7.0);
                c.centroid.x -= (c.centroid.x / d) * pullSpeed;
                c.centroid.y -= (c.centroid.y / d) * pullSpeed;
            }

            // 3. Top-level separation: 12 PBD passes with tight spacing ("just touch", no overlap)
            for (let iter = 0; iter < 12; iter++) {
                for (let i = 0; i < topCount; i++) {
                    const ca = topClusters[i];
                    if (ca.radius === 0) continue;
                    for (let j = i + 1; j < topCount; j++) {
                        const cb = topClusters[j];
                        if (cb.radius === 0) continue;
                        const minD = ca.radius + cb.radius + 2;
                        const dx = cb.centroid.x - ca.centroid.x;
                        const dy = cb.centroid.y - ca.centroid.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < minD * minD) {
                            const d = Math.sqrt(d2) || 0.001;
                            const s = ((minD - d) * 0.5) / d;
                            ca.centroid.x -= dx * s; ca.centroid.y -= dy * s;
                            cb.centroid.x += dx * s; cb.centroid.y += dy * s;
                        }
                    }
                }
            }

            // =====================================================================
            // LEVEL 2: NESTED CLUSTERS (DEPTH 2 TO MAXDEPTH) — PBD INSIDE PARENT
            // =====================================================================
            const maxDepth = Math.max(1, ...this.clusters.map(c => c.depth));

            for (let d = 2; d <= maxDepth; d++) {
                const clustersAtDepth = this.clusters.filter(c => c.depth === d && c.radius > 0 && c.parentClusterId);

                // Co-move with parent's displacement
                for (const sub of clustersAtDepth) {
                    const parent = clusterById.get(sub.parentClusterId!);
                    if (!parent || parent.radius === 0) continue;
                    const pp = prevPos.get(parent.id);
                    if (pp) {
                        sub.centroid.x += parent.centroid.x - pp.x;
                        sub.centroid.y += parent.centroid.y - pp.y;
                    }
                }

                // Subfolder gentle inward gravity toward parent center
                const subGravK = 0.02;
                for (const sub of clustersAtDepth) {
                    const parent = clusterById.get(sub.parentClusterId!);
                    if (!parent || parent.radius === 0) continue;
                    sub.centroid.x += (parent.centroid.x - sub.centroid.x) * subGravK;
                    sub.centroid.y += (parent.centroid.y - sub.centroid.y) * subGravK;
                }

                // Sibling separation & Container boundary constraint — 12 PBD passes [just touch]
                for (let iter = 0; iter < 12; iter++) {
                    for (let i = 0; i < clustersAtDepth.length; i++) {
                        const sa = clustersAtDepth[i];
                        for (let j = i + 1; j < clustersAtDepth.length; j++) {
                            const sb = clustersAtDepth[j];
                            if (sa.parentClusterId !== sb.parentClusterId) continue;
                            const minD = sa.radius + sb.radius + 2;
                            const dx = sb.centroid.x - sa.centroid.x;
                            const dy = sb.centroid.y - sa.centroid.y;
                            const d2 = dx * dx + dy * dy;
                            if (d2 < minD * minD) {
                                const dist = Math.sqrt(d2) || 0.001;
                                const s = ((minD - dist) * 0.5) / dist;
                                sa.centroid.x -= dx * s; sa.centroid.y -= dy * s;
                                sb.centroid.x += dx * s; sb.centroid.y += dy * s;
                            }
                        }
                    }

                    // Hard boundary clamp: subfolder must strictly stay inside parent circle
                    for (const sub of clustersAtDepth) {
                        const parent = clusterById.get(sub.parentClusterId!);
                        if (!parent || parent.radius === 0) continue;
                        const maxSubD = Math.max(0, parent.radius - sub.radius - 4);
                        const dx = sub.centroid.x - parent.centroid.x;
                        const dy = sub.centroid.y - parent.centroid.y;
                        const dist = Math.hypot(dx, dy) || 0.001;
                        if (dist > maxSubD) {
                            const scale = maxSubD / dist;
                            sub.centroid.x = parent.centroid.x + dx * scale;
                            sub.centroid.y = parent.centroid.y + dy * scale;
                        }
                    }
                }
            }

            // Adapt parent radius bottom-up if needed to cleanly enclose outermost subclusters
            for (let d = maxDepth - 1; d >= 1; d--) {
                const parents = this.clusters.filter(c => c.depth === d && c.radius > 0);
                for (const p of parents) {
                    const childSubs = this.clusters.filter(s => s.parentClusterId === p.id && s.radius > 0);
                    for (const sub of childSubs) {
                        const dist = Math.hypot(sub.centroid.x - p.centroid.x, sub.centroid.y - p.centroid.y);
                        const requiredR = Math.ceil(dist + sub.radius + 8);
                        if (requiredR > p.radius) {
                            p.radius = requiredR;
                        }
                    }
                }
            }

            // Shift nodes by the displacement of their IMMEDIATE container cluster
            for (const node of this.nodes) {
                if (node.fx !== null) continue;
                let container: BubbleCluster | undefined = clusterById.get(node.subClusterId);
                if (!container || container.radius === 0) {
                    container = clusterById.get(node.clusterId);
                }
                if (container && container.radius > 0) {
                    const prev = prevPos.get(container.id);
                    if (prev) {
                        const sx = container.centroid.x - prev.x;
                        const sy = container.centroid.y - prev.y;
                        node.x += sx;
                        node.y += sy;
                    }
                }
            }

            // =====================================================================
            // LEVEL 3: NODES — LIGHT VELOCITY + HARD BOUNDARY CLAMP
            // =====================================================================

            // A. Light pairwise repulsion within same folder
            const nc = this.nodes.length;
            for (let i = 0; i < nc; i++) {
                const na = this.nodes[i];
                if (visibleNodeIds && !visibleNodeIds.has(na.id)) continue;
                for (let j = i + 1; j < nc; j++) {
                    const nb = this.nodes[j];
                    if (visibleNodeIds && !visibleNodeIds.has(nb.id)) continue;
                    if (na.topLevelFolder !== nb.topLevelFolder) continue;
                    const dx = nb.x - na.x;
                    const dy = nb.y - na.y;
                    const d2 = dx * dx + dy * dy;
                    const minD = na.radius + nb.radius + 4;
                    if (d2 < minD * minD) {
                        const d = Math.sqrt(d2) || 0.001;
                        const f = Math.min((minD - d) * 0.35, 0.9) * (0.1 + 0.35 * alpha);
                        const nx = dx / d; const ny = dy / d;
                        if (na.fx === null) { na.vx -= nx * f; na.vy -= ny * f; }
                        if (nb.fx === null) { nb.vx += nx * f; nb.vy += ny * f; }
                    }
                }
            }

            // B. Intra-folder spring (tier1_intra edges)
            for (const edge of this.edges) {
                if (edge.tier !== 'tier1_intra') continue;
                const src = edge.sourceNode; const tgt = edge.targetNode;
                if (!src || !tgt) continue;
                if (visibleNodeIds && (!visibleNodeIds.has(src.id) || !visibleNodeIds.has(tgt.id))) continue;
                const dx = tgt.x - src.x; const dy = tgt.y - src.y;
                const d = Math.hypot(dx, dy) || 1;
                const f = (d - 22) * 0.012 * alpha;
                const fx = (dx / d) * f; const fy = (dy / d) * f;
                if (tgt.glyph === 'hub' && src.glyph !== 'hub') {
                    src.vx += fx * 1.2; src.vy += fy * 1.2;
                } else if (src.glyph === 'hub' && tgt.glyph !== 'hub') {
                    tgt.vx -= fx * 1.2; tgt.vy -= fy * 1.2;
                } else {
                    src.vx += fx; src.vy += fy; tgt.vx -= fx; tgt.vy -= fy;
                }
            }

            // C. Root/unclustered nodes → center pull
            for (const node of this.nodes) {
                if (!node.topLevelFolder || node.topLevelFolder === '/') {
                    if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;
                    if (node.fx !== null) continue;
                    const d = Math.hypot(node.x, node.y) || 1;
                    const pull = Math.min(d * 0.012, 1.5) * Math.max(alpha, 0.4);
                    node.vx -= (node.x / d) * pull;
                    node.vy -= (node.y / d) * pull;
                }
            }

            // D. Integrate + hard boundary clamp (no earthquake)
            for (const node of this.nodes) {
                if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;
                if (node.fx !== null) continue;
                if (!node.topLevelFolder || node.topLevelFolder === '/') continue;

                let container: BubbleCluster | undefined = clusterById.get(node.subClusterId);
                if (!container || container.radius === 0) {
                    container = clusterById.get(node.clusterId);
                }
                if (!container || container.radius === 0) continue;

                // Hard speed cap prevents dense-folder resonance
                const spd = Math.hypot(node.vx, node.vy);
                if (spd > 1.5) { node.vx = (node.vx / spd) * 1.5; node.vy = (node.vy / spd) * 1.5; }

                node.x += node.vx; node.y += node.vy;
                node.vx *= 0.80; node.vy *= 0.80;

                // Hard clamp inside container
                const maxR = (container.depth > 1)
                    ? Math.max(4, container.radius - node.radius - 4)
                    : Math.max(8, container.radius - node.radius - 8);
                const cdx = node.x - container.centroid.x;
                const cdy = node.y - container.centroid.y;
                const cd = Math.hypot(cdx, cdy) || 0.001;

                if (cd > maxR * 0.75) {
                    const pull = (cd - maxR * 0.75) * 0.08;
                    node.vx -= (cdx / cd) * pull;
                    node.vy -= (cdy / cd) * pull;
                }

                if (cd > maxR) {
                    node.x = container.centroid.x + (cdx / cd) * maxR;
                    node.y = container.centroid.y + (cdy / cd) * maxR;
                    const outV = node.vx * (cdx / cd) + node.vy * (cdy / cd);
                    if (outV > 0) { node.vx -= (cdx / cd) * outV; node.vy -= (cdy / cd) * outV; }
                }

                // If container has child subclusters, repel loose nodes away from child subclusters so they don't clip
                const childSubs = this.clusters.filter(s => s.parentClusterId === container!.id && s.radius > 0);
                for (const s of childSubs) {
                    const sdx = node.x - s.centroid.x;
                    const sdy = node.y - s.centroid.y;
                    const sd = Math.hypot(sdx, sdy) || 0.001;
                    const minSd = s.radius + node.radius + 3;
                    if (sd < minSd) {
                        const push = minSd - sd;
                        node.x += (sdx / sd) * push;
                        node.y += (sdy / sd) * push;
                        node.vx += (sdx / sd) * 0.5;
                        node.vy += (sdy / sd) * 0.5;
                    }
                }
            }

        } else {
            // =========================================================================
            // STANDARD DEFAULT FORCE-DIRECTED GRAPH MODE
            // =========================================================================
            const nodeCount = this.nodes.length;
            for (let i = 0; i < nodeCount; i++) {
                const na = this.nodes[i];
                if (visibleNodeIds && !visibleNodeIds.has(na.id)) continue;
                for (let j = i + 1; j < nodeCount; j++) {
                    const nb = this.nodes[j];
                    if (visibleNodeIds && !visibleNodeIds.has(nb.id)) continue;
                    const dx = nb.x - na.x; const dy = nb.y - na.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < 200 * 200) {
                        const dist = Math.sqrt(distSq) || 1;
                        const force = (400 / distSq) * alpha;
                        na.vx -= (dx / dist) * force; na.vy -= (dy / dist) * force;
                        nb.vx += (dx / dist) * force; nb.vy += (dy / dist) * force;
                    }
                }
            }

            for (const edge of this.edges) {
                const src = edge.sourceNode; const tgt = edge.targetNode;
                if (!src || !tgt) continue;
                if (visibleNodeIds && (!visibleNodeIds.has(src.id) || !visibleNodeIds.has(tgt.id))) continue;
                const dx = tgt.x - src.x; const dy = tgt.y - src.y;
                const dist = Math.hypot(dx, dy) || 1;
                const targetDist = edge.tier === 'tier2_inter' ? 120 : 50;
                const force = (dist - targetDist) * 0.03 * alpha;
                src.vx += (dx / dist) * force; src.vy += (dy / dist) * force;
                tgt.vx -= (dx / dist) * force; tgt.vy -= (dy / dist) * force;
            }
        }

        // =========================================================================
        // FINAL VELOCITY INTEGRATION (default mode nodes + unspawned node parking)
        // =========================================================================
        const maxSpeed = 3.5;
        for (const node of this.nodes) {
            if (visibleNodeIds && !visibleNodeIds.has(node.id)) {
                // Park unspawned node at cluster centroid
                const cluster = this.clusters.find(c => c.nodeIds.includes(node.id));
                if (cluster) {
                    node.x = cluster.centroid.x; node.y = cluster.centroid.y;
                    node.vx = 0; node.vy = 0;
                }
                continue;
            }

            if (node.fx !== null && node.fy !== null) {
                node.x = node.fx; node.y = node.fy;
                node.vx = 0; node.vy = 0;
                continue;
            }

            // Bubble mode nodes are integrated in Level 3 above
            if (isBubbleMode) continue;

            const speed = Math.hypot(node.vx, node.vy);
            if (speed > maxSpeed) { node.vx = (node.vx / speed) * maxSpeed; node.vy = (node.vy / speed) * maxSpeed; }
            node.x += node.vx; node.y += node.vy;
            node.vx *= damping; node.vy *= damping;
        }

        updateClusterHulls(this.clusters, this.nodeMap, 18, visibleNodeIds, isBubbleMode);
        this.alpha *= (1 - this.alphaDecay);
        // In bubble mode: always keep running (gravity is a continuous living force)
        return isBubbleMode ? true : (this.alpha >= this.alphaMin || this.isDragging);
    }

    public startDrag(targetNode: BubbleNode, worldX: number, worldY: number): void {
        const depth = this.options.maxDragDepth;
        if (depth === 0) return;
        this.isDragging = true;
        this.draggedNodes = [];

        if (depth >= 1 && depth <= 5) {
            const cluster = this.clusters.find(c => c.depth === depth && c.nodeIds.includes(targetNode.id));
            if (cluster) {
                const clusterNodes = this.nodes.filter(n => cluster.nodeIds.includes(n.id));
                for (const n of clusterNodes) {
                    this.draggedNodes.push({ node: n, offsetX: n.x - worldX, offsetY: n.y - worldY });
                    n.fx = n.x; n.fy = n.y;
                }
            } else {
                this.draggedNodes.push({ node: targetNode, offsetX: targetNode.x - worldX, offsetY: targetNode.y - worldY });
                targetNode.fx = targetNode.x; targetNode.fy = targetNode.y;
            }
        } else {
            this.draggedNodes.push({ node: targetNode, offsetX: targetNode.x - worldX, offsetY: targetNode.y - worldY });
            targetNode.fx = targetNode.x; targetNode.fy = targetNode.y;
        }
        this.reheat(0.3);
    }

    public updateDrag(worldX: number, worldY: number): void {
        if (!this.isDragging || this.draggedNodes.length === 0) return;
        for (const item of this.draggedNodes) {
            item.node.fx = worldX + item.offsetX;
            item.node.fy = worldY + item.offsetY;
            item.node.x = item.node.fx;
            item.node.y = item.node.fy;
        }
        const depth = this.options.maxDragDepth;
        if (depth >= 1 && depth <= 5 && this.draggedNodes.length > 0) {
            const firstNodeId = this.draggedNodes[0].node.id;
            const cluster = this.clusters.find(c => c.depth === depth && c.nodeIds.includes(firstNodeId));
            if (cluster) {
                let sx = 0, sy = 0;
                this.draggedNodes.forEach(item => { sx += item.node.x; sy += item.node.y; });
                cluster.centroid.x = sx / this.draggedNodes.length;
                cluster.centroid.y = sy / this.draggedNodes.length;
            }
        }
        this.reheat(0.2);
    }

    public endDrag(): void {
        this.isDragging = false;
        for (const item of this.draggedNodes) { item.node.fx = null; item.node.fy = null; }
        this.draggedNodes = [];
        this.reheat(0.1);
    }
}

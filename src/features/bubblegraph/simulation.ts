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

export function computeClusterRadius(nodeCount: number, depth: number): number {
    if (depth === 1) {
        return Math.max(48, Math.round(Math.sqrt(nodeCount) * 12.0 + 36));
    }
    return Math.max(22, Math.round(Math.sqrt(nodeCount) * 7.5 + 16));
}

export function computeTopClusterRadius(c: BubbleCluster, subClusters: BubbleCluster[], visibleNodeCount: number): number {
    const baseR = visibleNodeCount <= 1 ? 28
        : visibleNodeCount === 2 ? 38
        : computeClusterRadius(visibleNodeCount, 1);

    const childSubs = subClusters.filter(s => s.parentClusterId === c.id && s.radius > 0);
    if (childSubs.length === 0) return baseR;

    let totalSubArea = 0;
    for (const sub of childSubs) {
        const sr = sub.radius + 2;
        totalSubArea += Math.PI * sr * sr;
    }
    const packingR = Math.ceil(Math.sqrt(totalSubArea / (Math.PI * 0.78)) + 10);
    return Math.max(baseR, packingR);
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
        const subClusters = this.clusters.filter(c => c.depth === 2);

        // Precompute subfolder radii
        subClusters.forEach(sub => {
            const count = sub.nodeIds.length;
            sub.radius = count === 0 ? 0 : count === 1 ? 24 : count === 2 ? 34 : computeClusterRadius(count, 2);
            sub.vx = 0;
            sub.vy = 0;
        });

        let totalDiameter = 0;
        const gap = 20;
        topClusters.forEach(c => {
            const r = computeTopClusterRadius(c, subClusters, c.nodeIds.length);
            c.radius = r;
            c.vx = 0;
            c.vy = 0;
            totalDiameter += (2 * r + gap);
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
            cluster.vx = 0;
            cluster.vy = 0;

            const childSubs = this.clusters.filter(sub => sub.depth === 2 && sub.parentClusterId === cluster.id);

            if (childSubs.length > 0) {
                const numSubs = childSubs.length;
                childSubs.forEach((sub, sIdx) => {
                    sub.radius = computeClusterRadius(sub.nodeIds.length, 2);
                    sub.vx = 0; sub.vy = 0;
                    const phi = sIdx * 2.3999632;
                    const dist = Math.sqrt((sIdx + 0.5) / numSubs) * Math.max(15, r - sub.radius - 12);
                    sub.centroid = { x: cx + Math.cos(phi) * dist, y: cy + Math.sin(phi) * dist };
                    const subSpread = Math.max(5, sub.radius - 8);
                    sub.nodeIds.forEach((nid, nIdx) => {
                        const node = this.nodeMap.get(nid);
                        if (node) {
                            if (sub.nodeIds.length === 1) {
                                node.x = sub.centroid.x; node.y = sub.centroid.y;
                            } else {
                                const nPhi = nIdx * 2.3999632;
                                const nDist = Math.sqrt((nIdx + 0.5) / sub.nodeIds.length) * subSpread;
                                node.x = sub.centroid.x + Math.cos(nPhi) * nDist;
                                node.y = sub.centroid.y + Math.sin(nPhi) * nDist;
                            }
                            node.vx = 0; node.vy = 0;
                        }
                    });
                });

                const assignedIds = new Set<string>();
                childSubs.forEach(sub => sub.nodeIds.forEach(id => assignedIds.add(id)));
                const remaining = cluster.nodeIds.filter(id => !assignedIds.has(id));
                const remSpread = Math.max(8, r * 0.45);
                remaining.forEach((nid, idx) => {
                    const node = this.nodeMap.get(nid);
                    if (node) {
                        const phi = idx * 2.3999632;
                        const d = Math.sqrt((idx + 0.5) / (remaining.length || 1)) * remSpread;
                        node.x = cx + Math.cos(phi) * d;
                        node.y = cy + Math.sin(phi) * d;
                        node.vx = 0; node.vy = 0;
                    }
                });
            } else {
                const nodeIds = cluster.nodeIds;
                const maxSpread = Math.max(8, r * 0.65);
                nodeIds.forEach((nid, idx) => {
                    const node = this.nodeMap.get(nid);
                    if (node) {
                        if (nodeIds.length === 1) {
                            node.x = cx; node.y = cy;
                        } else {
                            const phi = idx * 2.3999632;
                            const d = Math.sqrt((idx + 0.5) / nodeIds.length) * maxSpread;
                            node.x = cx + Math.cos(phi) * d;
                            node.y = cy + Math.sin(phi) * d;
                        }
                        node.vx = 0; node.vy = 0;
                    }
                });
            }
        });

        this.nodes.forEach(n => {
            if (n.topLevelFolder === '/' && n.x === 0 && n.y === 0) {
                const angle = Math.random() * Math.PI * 2;
                const r = orbitRadius * 1.25 + Math.random() * 50;
                n.x = Math.cos(angle) * r;
                n.y = Math.sin(angle) * r;
                n.vx = 0; n.vy = 0;
            }
        });

        updateClusterHulls(this.clusters, this.nodeMap);
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

            // Update subfolder radii strictly (no unbounded growth)
            for (const sub of subClusters) {
                const count = getVisibleCount(sub);
                sub.radius = count === 0 ? 0
                    : count === 1 ? 24
                    : count === 2 ? 34
                    : computeClusterRadius(count, 2);
                sub.vx = 0; sub.vy = 0;
            }

            // Update top cluster radii strictly (canonical bounding circle based on node & subfolder counts)
            for (const c of topClusters) {
                const count = getVisibleCount(c);
                c.radius = count === 0 ? 0 : computeTopClusterRadius(c, subClusters, count);
                c.vx = 0; c.vy = 0;
            }

            // Snapshot ALL centroids before any change
            const prevPos = new Map<string, { x: number; y: number }>();
            for (const c of this.clusters) prevPos.set(c.id, { x: c.centroid.x, y: c.centroid.y });

            // 1. Group-level centering: pull the collective center of mass of all folders to (0, 0)
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

            // 2. Individual cluster gravity: steady, active inward pull toward (0,0).
            // Pulls level 1 folders toward the center of the frame so they pack snugly.
            for (const c of topClusters) {
                if (c.radius === 0) continue;
                const d = Math.hypot(c.centroid.x, c.centroid.y) || 0.001;
                // Active pull speed: scales with distance, with solid floor so clusters actively migrate inward
                const pullSpeed = Math.min(d * 0.035 + 1.2, 7.0);
                c.centroid.x -= (c.centroid.x / d) * pullSpeed;
                c.centroid.y -= (c.centroid.y / d) * pullSpeed;
            }

            // SEPARATION: 10 PBD passes with tight spacing (no phantom gaps)
            for (let iter = 0; iter < 10; iter++) {
                for (let i = 0; i < topCount; i++) {
                    const ca = topClusters[i];
                    if (ca.radius === 0) continue;
                    for (let j = i + 1; j < topCount; j++) {
                        const cb = topClusters[j];
                        if (cb.radius === 0) continue;
                        const minD = ca.radius + cb.radius + 6;
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

            // Collect subfolder node IDs (L2 handles them)
            const subIds = new Set<string>();
            for (const sub of subClusters) for (const nid of sub.nodeIds) subIds.add(nid);

            // Shift non-subfolder nodes by total L1 delta
            for (const c of topClusters) {
                if (c.radius === 0) continue;
                const prev = prevPos.get(c.id)!;
                const sx = c.centroid.x - prev.x;
                const sy = c.centroid.y - prev.y;
                for (const nid of c.nodeIds) {
                    if (subIds.has(nid)) continue;
                    const n = this.nodeMap.get(nid);
                    if (n && n.fx === null) { n.x += sx; n.y += sy; }
                }
            }

            // =====================================================================
            // LEVEL 2: SUBFOLDERS — PBD INSIDE PARENT
            // =====================================================================

            // Co-move subfolder with parent (so it follows parent's L1 displacement)
            for (const sub of subClusters) {
                if (sub.radius === 0 || !sub.parentClusterId) continue;
                const parent = clusterById.get(sub.parentClusterId);
                if (!parent || parent.radius === 0) continue;
                const pp = prevPos.get(parent.id)!;
                sub.centroid.x += parent.centroid.x - pp.x;
                sub.centroid.y += parent.centroid.y - pp.y;
            }

            // Subfolder gravity toward parent center (steady, living inward pull)
            const subGravK = 0.04;
            for (const sub of subClusters) {
                if (sub.radius === 0 || !sub.parentClusterId) continue;
                const parent = clusterById.get(sub.parentClusterId);
                if (!parent || parent.radius === 0) continue;
                sub.centroid.x += (parent.centroid.x - sub.centroid.x) * subGravK;
                sub.centroid.y += (parent.centroid.y - sub.centroid.y) * subGravK;
            }

            // Sibling separation — 4 PBD passes with maximum step clamp (prevents explosion)
            for (let iter = 0; iter < 4; iter++) {
                for (let i = 0; i < subClusters.length; i++) {
                    const sa = subClusters[i];
                    if (sa.radius === 0) continue;
                    for (let j = i + 1; j < subClusters.length; j++) {
                        const sb = subClusters[j];
                        if (sb.radius === 0 || sa.parentClusterId !== sb.parentClusterId) continue;
                        const minD = sa.radius + sb.radius + 6;
                        const dx = sb.centroid.x - sa.centroid.x;
                        const dy = sb.centroid.y - sa.centroid.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < minD * minD) {
                            const d = Math.sqrt(d2) || 0.001;
                            const push = Math.min((minD - d) * 0.5, 3.5);
                            const s = push / d;
                            sa.centroid.x -= dx * s; sa.centroid.y -= dy * s;
                            sb.centroid.x += dx * s; sb.centroid.y += dy * s;
                        }
                    }
                }
            }

            // Hard boundary clamp: subfolder must strictly stay inside parent circle
            for (const sub of subClusters) {
                if (sub.radius === 0 || !sub.parentClusterId) continue;
                const parent = clusterById.get(sub.parentClusterId);
                if (!parent || parent.radius === 0) continue;
                const maxSubD = Math.max(4, parent.radius - sub.radius - 8);
                const dx = sub.centroid.x - parent.centroid.x;
                const dy = sub.centroid.y - parent.centroid.y;
                const d = Math.hypot(dx, dy) || 0.001;
                if (d > maxSubD) {
                    const scale = maxSubD / d;
                    sub.centroid.x = parent.centroid.x + dx * scale;
                    sub.centroid.y = parent.centroid.y + dy * scale;
                }
            }

            // Shift subfolder nodes by total L2 delta
            for (const sub of subClusters) {
                if (sub.radius === 0) continue;
                const prev = prevPos.get(sub.id)!;
                const sx = sub.centroid.x - prev.x;
                const sy = sub.centroid.y - prev.y;
                for (const nid of sub.nodeIds) {
                    const n = this.nodeMap.get(nid);
                    if (n && n.fx === null) { n.x += sx; n.y += sy; }
                }
            }

            // =====================================================================
            // LEVEL 3: NODES — LIGHT VELOCITY + HARD BOUNDARY CLAMP
            // =====================================================================
            const nodeToSub = new Map<string, BubbleCluster>();
            for (const sub of subClusters) for (const nid of sub.nodeIds) nodeToSub.set(nid, sub);

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
            for (const c of topClusters) {
                if (c.radius === 0) continue;
                for (const nid of c.nodeIds) {
                    if (visibleNodeIds && !visibleNodeIds.has(nid)) continue;
                    const node = this.nodeMap.get(nid);
                    if (!node || node.fx !== null) continue;

                    // Hard speed cap prevents dense-folder resonance
                    const spd = Math.hypot(node.vx, node.vy);
                    if (spd > 1.5) { node.vx = (node.vx / spd) * 1.5; node.vy = (node.vy / spd) * 1.5; }

                    node.x += node.vx; node.y += node.vy;
                    node.vx *= 0.80; node.vy *= 0.80;

                    // Hard clamp inside container — position only, no velocity spike
                    const sub = nodeToSub.get(nid);
                    const container = (sub && sub.radius > 0) ? sub : c;
                    const maxR = (container === sub)
                        ? Math.max(4, container.radius - node.radius - 4)
                        : Math.max(8, container.radius - node.radius - 8);
                    const cdx = node.x - container.centroid.x;
                    const cdy = node.y - container.centroid.y;
                    const cd = Math.hypot(cdx, cdy) || 0.001;

                    // Restorative pull toward container center if drifting toward perimeter
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

        updateClusterHulls(this.clusters, this.nodeMap, 18, visibleNodeIds);
        this.alpha *= (1 - this.alphaDecay);
        // In bubble mode: always keep running (gravity is a continuous living force)
        return isBubbleMode ? true : (this.alpha >= this.alphaMin || this.isDragging);
    }

    public startDrag(targetNode: BubbleNode, worldX: number, worldY: number): void {
        const depth = this.options.maxDragDepth;
        if (depth === 0) return;
        this.isDragging = true;
        this.draggedNodes = [];

        if (depth === 1) {
            const clusterNodes = this.nodes.filter(n => n.topLevelFolder === targetNode.topLevelFolder);
            for (const n of clusterNodes) {
                this.draggedNodes.push({ node: n, offsetX: n.x - worldX, offsetY: n.y - worldY });
                n.fx = n.x; n.fy = n.y;
            }
        } else if (depth === 2) {
            const subNodes = this.nodes.filter(n => n.subClusterId === targetNode.subClusterId);
            for (const n of subNodes) {
                this.draggedNodes.push({ node: n, offsetX: n.x - worldX, offsetY: n.y - worldY });
                n.fx = n.x; n.fy = n.y;
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
        if (this.options.maxDragDepth === 1 && this.draggedNodes.length > 0) {
            const topCluster = this.clusters.find(c => c.depth === 1 && c.id === this.draggedNodes[0].node.topLevelFolder);
            if (topCluster) {
                let sx = 0, sy = 0;
                this.draggedNodes.forEach(item => { sx += item.node.x; sy += item.node.y; });
                topCluster.centroid.x = sx / this.draggedNodes.length;
                topCluster.centroid.y = sy / this.draggedNodes.length;
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

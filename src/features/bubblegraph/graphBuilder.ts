import { App, TFile, normalizePath } from 'obsidian';
import { BubbleNode, BubbleEdge, BubbleCluster, NodeGlyphType, GraphStats } from './types';
import { computeClusterRadius } from './simulation';
import { FolderRule } from '../tree/types';

// Critical design constraint: All non-captain folders (and all folders when captain colors toggle is off)
// MUST remain dark gray. No random rainbow palettes.
export const DARK_GRAY_COLOR = '#4a5568';

export function matchFolderRule(folderPath: string, rules: FolderRule[]): FolderRule | null {
    if (!rules || rules.length === 0 || !folderPath) return null;
    const activeRules = rules.filter(r => r.enabled);
    const matches: FolderRule[] = [];
    const normalizedPath = normalizePath(folderPath);

    for (const rule of activeRules) {
        const normalizedRulePath = normalizePath(rule.path || '');
        if (normalizedRulePath.includes('*')) {
            const regexParts = normalizedRulePath.split('/').map(part => {
                if (part === '*') return '[^/]+';
                if (part === '**') return '.*';
                return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]+');
            });
            const regexString = regexParts.join('/');
            const fullRegex = rule.includeChildren ? new RegExp(`^${regexString}(?:/.*)?$`) : new RegExp(`^${regexString}$`);
            if (fullRegex.test(normalizedPath)) {
                matches.push(rule);
            }
        } else if (rule.includeChildren) {
            if (normalizedRulePath === "" || normalizedRulePath === ".") {
                matches.push(rule);
            } else if (normalizedPath === normalizedRulePath || normalizedPath.startsWith(normalizedRulePath + '/')) {
                matches.push(rule);
            }
        } else {
            if (normalizedPath === normalizedRulePath) {
                matches.push(rule);
            }
        }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => (b.path || '').length - (a.path || '').length);
    return matches[0];
}

export function getFolderColor(
    folderPath: string,
    captainRules?: FolderRule[],
    useCaptainColors: boolean = false
): string {
    if (useCaptainColors && captainRules && captainRules.length > 0 && folderPath && folderPath !== '/') {
        const matchedRule = matchFolderRule(folderPath, captainRules);
        if (matchedRule && matchedRule.color) {
            return matchedRule.color;
        }
    }
    return DARK_GRAY_COLOR;
}

export interface BuiltGraph {
    nodes: BubbleNode[];
    edges: BubbleEdge[];
    clusters: BubbleCluster[];
    stats: GraphStats;
    nodeMap: Map<string, BubbleNode>;
    clusterMap: Map<string, BubbleCluster>;
}

export function buildVaultGraph(
    app: App, 
    activeFilePath: string | null = null,
    captainRules?: FolderRule[],
    useCaptainColors: boolean = false,
    maxClusterDepth: number = 3
): BuiltGraph {
    const files: TFile[] = app.vault.getMarkdownFiles();
    const resolvedLinks = app.metadataCache.resolvedLinks || {};

    // 1. Calculate In/Out Degrees
    const outDegrees = new Map<string, number>();
    const inDegrees = new Map<string, number>();
    const rawEdges: Array<{ source: string; target: string }> = [];

    for (const sourcePath in resolvedLinks) {
        const targets = resolvedLinks[sourcePath];
        let outCount = 0;
        for (const targetPath in targets) {
            outCount++;
            inDegrees.set(targetPath, (inDegrees.get(targetPath) || 0) + 1);
            rawEdges.push({ source: sourcePath, target: targetPath });
        }
        outDegrees.set(sourcePath, outCount);
    }

    // 2. Map Folders and Hierarchies
    const folderToFiles = new Map<string, TFile[]>();
    for (const file of files) {
        const folder = file.parent ? file.parent.path : '';
        if (!folderToFiles.has(folder)) {
            folderToFiles.set(folder, []);
        }
        folderToFiles.get(folder).push(file);
    }

    // 3. Build Nodes
    const nodes: BubbleNode[] = [];
    const nodeMap = new Map<string, BubbleNode>();

    for (const file of files) {
        const path = file.path;
        const name = file.basename;
        const folderPath = file.parent && file.parent.path !== '/' ? file.parent.path : '';

        let topLevelFolder = '/';
        let subFolder = '';

        if (folderPath && folderPath !== '/') {
            const parts = folderPath.split('/');
            topLevelFolder = parts[0];
            subFolder = parts.length > 1 ? parts.slice(1).join('/') : '';
        }

        const outDeg = outDegrees.get(path) || 0;
        const inDeg = inDegrees.get(path) || 0;
        const totalDeg = inDeg + outDeg;

        const clusterId = topLevelFolder;
        const subClusterId = folderPath && folderPath !== '/'
            ? folderPath.split('/').slice(0, Math.min(folderPath.split('/').length, maxClusterDepth)).join('/')
            : '/';

        // Check if index note of folder
        const folderFiles = folderToFiles.get(folderPath) || [];
        const isMaxDegreeInFolder = folderFiles.length > 1 && 
            folderFiles.every(f => (outDegrees.get(f.path) || 0) + (inDegrees.get(f.path) || 0) <= totalDeg);
        const isNamedAfterFolder = name.toLowerCase() === (subFolder ? subFolder.split('/').pop() : topLevelFolder).toLowerCase();
        const isIndexNote = isNamedAfterFolder || isMaxDegreeInFolder || name.toLowerCase() === 'readme' || name.toLowerCase() === 'index';

        const isActive = activeFilePath === path;

        // Semantic Glyph assignment & Radius formula according to Spec v18
        let glyph: NodeGlyphType;
        let radius: number;

        if (isActive) {
            glyph = 'active';
            radius = 8; // Fixed 8px + pulse aura
        } else if (isIndexNote && totalDeg >= 2) {
            glyph = 'hub';
            // r = 6 + sqrt(deg_in + deg_out)
            radius = Math.round(6 + Math.sqrt(inDeg + outDeg));
        } else if (totalDeg <= 1) {
            glyph = 'leaf';
            radius = 2.5; // Compact 2.5px
        } else {
            glyph = 'document';
            // r = 3 + sqrt(deg_total)
            radius = Math.round(3 + Math.sqrt(totalDeg));
        }

        const color = getFolderColor(folderPath || topLevelFolder, captainRules, useCaptainColors);

        const node: BubbleNode = {
            id: path,
            name,
            folderPath,
            topLevelFolder,
            subFolder,
            ctime: file.stat.ctime || file.stat.mtime || Date.now(),
            inDegree: inDeg,
            outDegree: outDeg,
            totalDegree: totalDeg,
            glyph,
            radius,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            fx: null,
            fy: null,
            color,
            isActive,
            clusterId,
            subClusterId
        };

        nodes.push(node);
        nodeMap.set(path, node);
    }

    // 4. Build Edges & Classify 3-Tier Hierarchy
    const edges: BubbleEdge[] = [];
    let totalVennBridges = 0;

    for (const raw of rawEdges) {
        const srcNode = nodeMap.get(raw.source);
        const tgtNode = nodeMap.get(raw.target);

        if (!srcNode || !tgtNode) continue;

        const isIntra = srcNode.topLevelFolder === tgtNode.topLevelFolder;
        const tier = isIntra ? 'tier1_intra' : 'tier2_inter';

        if (tier === 'tier2_inter') {
            totalVennBridges++;
        }

        edges.push({
            source: raw.source,
            target: raw.target,
            sourceNode: srcNode,
            targetNode: tgtNode,
            tier,
            isIntraFolder: isIntra,
            color: isIntra ? srcNode.color : '#00f2ff' // Neon cyan for inter-cluster Venn bridge
        });
    }

    // 5. Build Clusters — N-depth recursive folder hierarchy
    // Each folder path segment up to maxClusterDepth gets its own cluster bubble.
    // e.g. folderPath "a/b/c" with maxClusterDepth=5 → clusters: "a" (d1), "a/b" (d2), "a/b/c" (d3)
    const clusters: BubbleCluster[] = [];
    const clusterMap = new Map<string, BubbleCluster>();

    // Collect all folder paths that appear in the graph
    const allFolderPaths = new Set<string>();
    for (const node of nodes) {
        if (!node.folderPath || node.topLevelFolder === '/') continue;
        // Add every ancestor path up to maxClusterDepth
        const parts = node.folderPath.split('/');
        const maxParts = Math.min(parts.length, maxClusterDepth);
        for (let d = 1; d <= maxParts; d++) {
            allFolderPaths.add(parts.slice(0, d).join('/'));
        }
    }

    // Map each cluster path → list of DIRECT child node ids (nodes whose folderPath matches exactly)
    // Note: a cluster at depth d owns ALL nodes in that folder subtree for containment,
    // but nodeIds for the cluster only lists nodes directly in that folder
    const clusterDirectNodeIds = new Map<string, string[]>();
    const clusterAllNodeIds = new Map<string, string[]>();

    for (const folderPath of allFolderPaths) {
        clusterDirectNodeIds.set(folderPath, []);
        clusterAllNodeIds.set(folderPath, []);
    }

    for (const node of nodes) {
        if (!node.folderPath || node.topLevelFolder === '/') continue;
        const parts = node.folderPath.split('/');
        const maxParts = Math.min(parts.length, maxClusterDepth);
        for (let d = 1; d <= maxParts; d++) {
            const ancestorPath = parts.slice(0, d).join('/');
            if (clusterAllNodeIds.has(ancestorPath)) {
                clusterAllNodeIds.get(ancestorPath).push(node.id);
            }
        }
        // Direct membership: only at node's actual folder depth (capped to maxClusterDepth)
        const cappedPath = parts.slice(0, maxClusterDepth).join('/');
        if (clusterDirectNodeIds.has(cappedPath)) {
            clusterDirectNodeIds.get(cappedPath).push(node.id);
        }
    }

    // Create cluster objects sorted by depth (shallowest first)
    const sortedFolderPaths = [...allFolderPaths].sort((a, b) => {
        const da = a.split('/').length;
        const db = b.split('/').length;
        return da !== db ? da - db : a.localeCompare(b);
    });

    for (const folderPath of sortedFolderPaths) {
        const parts = folderPath.split('/');
        const depth = parts.length;
        if (depth > maxClusterDepth) continue;

        const parentPath = depth > 1 ? parts.slice(0, depth - 1).join('/') : null;
        const name = parts[parts.length - 1];
        // nodeIds contains ALL nodes in this folder and its sub-folders (for layout bounding)
        const allIds = [...new Set(clusterAllNodeIds.get(folderPath) || [])];
        if (allIds.length === 0) continue;

        const cluster: BubbleCluster = {
            id: folderPath,
            name,
            parentClusterId: parentPath,
            depth,
            nodeIds: allIds,
            directNodeIds: [...new Set(clusterDirectNodeIds.get(folderPath) || [])],
            centroid: { x: 0, y: 0 },
            radius: computeClusterRadius(allIds.length, depth),
            color: getFolderColor(folderPath, captainRules, useCaptainColors),
            hullPolygon: [],
            smoothedHull: [],
            boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
        };
        clusters.push(cluster);
        clusterMap.set(folderPath, cluster);
    }

    return {
        nodes,
        edges,
        clusters,
        stats: {
            totalNodes: nodes.length,
            totalClusters: clusters.length,
            totalVennBridges
        },
        nodeMap,
        clusterMap
    };
}

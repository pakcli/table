import { App, TFile } from 'obsidian';
import { BubbleNode, BubbleEdge, BubbleCluster, NodeGlyphType, GraphStats } from './types';
import { computeClusterRadius } from './simulation';

// Curated modern editorial palette for bubble hulls and clusters
const CLUSTER_PALETTE = [
    '#38bdf8', // Sky Cyan
    '#818cf8', // Indigo
    '#c084fc', // Purple/Violet
    '#f472b6', // Pink
    '#fb923c', // Amber/Orange
    '#34d399', // Emerald Green
    '#2dd4bf', // Teal
    '#a78bfa', // Lavender
    '#f87171', // Coral Red
    '#fbbf24', // Sun Gold
];

export function getFolderColor(folderName: string): string {
    if (!folderName || folderName === '/') return '#94a3b8'; // Neutral Slate for root
    let hash = 0;
    for (let i = 0; i < folderName.length; i++) {
        hash = (hash << 5) - hash + folderName.charCodeAt(i);
        hash |= 0;
    }
    const index = Math.abs(hash) % CLUSTER_PALETTE.length;
    return CLUSTER_PALETTE[index];
}

export interface BuiltGraph {
    nodes: BubbleNode[];
    edges: BubbleEdge[];
    clusters: BubbleCluster[];
    stats: GraphStats;
    nodeMap: Map<string, BubbleNode>;
    clusterMap: Map<string, BubbleCluster>;
}

export function buildVaultGraph(app: App, activeFilePath: string | null = null): BuiltGraph {
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
        folderToFiles.get(folder)!.push(file);
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
        const subClusterId = folderPath || '/';

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

        const color = getFolderColor(topLevelFolder);

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

    // 5. Build Clusters (Folders & Subfolders)
    const clusters: BubbleCluster[] = [];
    const clusterMap = new Map<string, BubbleCluster>();

    // Top-level clusters
    const topFolderMap = new Map<string, string[]>();
    const subFolderMap = new Map<string, string[]>();

    for (const node of nodes) {
        if (node.topLevelFolder !== '/') {
            if (!topFolderMap.has(node.topLevelFolder)) {
                topFolderMap.set(node.topLevelFolder, []);
            }
            topFolderMap.get(node.topLevelFolder)!.push(node.id);
        }

        if (node.folderPath && node.folderPath !== node.topLevelFolder) {
            if (!subFolderMap.has(node.folderPath)) {
                subFolderMap.set(node.folderPath, []);
            }
            subFolderMap.get(node.folderPath)!.push(node.id);
        }
    }

    // Create top-level parent clusters
    for (const [folder, nodeIds] of topFolderMap.entries()) {
        const cluster: BubbleCluster = {
            id: folder,
            name: folder,
            parentClusterId: null,
            depth: 1,
            nodeIds,
            centroid: { x: 0, y: 0 },
            radius: computeClusterRadius(nodeIds.length, 1),
            color: getFolderColor(folder),
            hullPolygon: [],
            smoothedHull: [],
            boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
        };
        clusters.push(cluster);
        clusterMap.set(folder, cluster);
    }

    // Create nested subfolder child clusters
    for (const [subFolder, nodeIds] of subFolderMap.entries()) {
        const topParent = subFolder.split('/')[0];
        const subName = subFolder.split('/').pop() || subFolder;
        const cluster: BubbleCluster = {
            id: subFolder,
            name: subName,
            parentClusterId: topParent,
            depth: 2,
            nodeIds,
            centroid: { x: 0, y: 0 },
            radius: computeClusterRadius(nodeIds.length, 2),
            color: getFolderColor(topParent),
            hullPolygon: [],
            smoothedHull: [],
            boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
        };
        clusters.push(cluster);
        clusterMap.set(subFolder, cluster);
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

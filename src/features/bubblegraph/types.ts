export type NodeGlyphType = 'hub' | 'active' | 'document' | 'leaf';

export type LinkTier = 'tier1_intra' | 'tier2_inter' | 'tier3_flow';

export interface BubbleNode {
    id: string; // File path, e.g. "01-projects/alpha-app/router.md"
    name: string; // Base name, e.g. "router"
    folderPath: string; // Full relative folder, e.g. "01-projects/alpha-app"
    topLevelFolder: string; // Top-level folder, e.g. "01-projects" or "/"
    subFolder: string; // Subfolder part, e.g. "alpha-app"
    ctime: number; // File creation timestamp for timelapse animation
    inDegree: number;
    outDegree: number;
    totalDegree: number;
    glyph: NodeGlyphType;
    radius: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    fx: number | null;
    fy: number | null;
    color: string;
    isActive: boolean;
    clusterId: string;
    subClusterId: string;
}

export interface BubbleEdge {
    source: string;
    target: string;
    sourceNode?: BubbleNode;
    targetNode?: BubbleNode;
    tier: LinkTier;
    isIntraFolder: boolean;
    color: string;
}

export interface BubbleCluster {
    id: string;
    name: string;
    parentClusterId: string | null;
    depth: number; // 1 = top-level, 2 = subfolder
    nodeIds: string[];
    centroid: { x: number; y: number };
    radius: number;
    vx?: number;
    vy?: number;
    color: string;
    hullPolygon: Array<{ x: number; y: number }>;
    smoothedHull: Array<{ x: number; y: number }>;
    boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
    isHovered?: boolean;
}

export interface InspectorData {
    activeNode: BubbleNode | null;
    folder: string;
    backlinks: Array<{ id: string; name: string }>;
    outgoing: Array<{ id: string; name: string }>;
    degreeCentrality: number;
    scopeAffinity: number; // percentage (0-100)
}

export interface GraphStats {
    totalNodes: number;
    totalClusters: number;
    totalVennBridges: number;
}

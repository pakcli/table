import { BubbleNode, BubbleCluster } from './types';

export interface Point {
    x: number;
    y: number;
}

// Generate a smooth circular polygon (steps points around centroid)
export function generateCircleHull(centroid: Point, radius: number, steps: number = 48): Point[] {
    const res: Point[] = [];
    for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        res.push({
            x: centroid.x + Math.cos(angle) * radius,
            y: centroid.y + Math.sin(angle) * radius
        });
    }
    return res;
}

// Monotone chain algorithm for 2D convex hull
function crossProduct(o: Point, a: Point, b: Point): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function computeConvexHull(points: Point[]): Point[] {
    if (points.length <= 2) return [...points];

    const sorted = [...points].sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

    const lower: Point[] = [];
    for (const p of sorted) {
        while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }

    const upper: Point[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

// Generate a smooth capsule / stadium hull around two points with generous padding
export function generateStadiumHull(p1: Point, p2: Point, padding: number): Point[] {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);

    if (len < 1) {
        return generateCircleHull(p1, padding, 16);
    }

    const angle = Math.atan2(dy, dx);
    const res: Point[] = [];
    const steps = 8;

    for (let i = 0; i <= steps; i++) {
        const a = (angle - Math.PI / 2) + (i / steps) * Math.PI;
        res.push({
            x: p2.x + Math.cos(a) * padding,
            y: p2.y + Math.sin(a) * padding
        });
    }

    for (let i = 0; i <= steps; i++) {
        const a = (angle + Math.PI / 2) + (i / steps) * Math.PI;
        res.push({
            x: p1.x + Math.cos(a) * padding,
            y: p1.y + Math.sin(a) * padding
        });
    }

    return res;
}

// Expand hull outwards by padding distance from centroid
export function expandHull(hull: Point[], centroid: Point, padding: number): Point[] {
    if (hull.length === 0) return [];
    if (hull.length === 1) {
        return generateCircleHull(hull[0], padding, 16);
    }
    if (hull.length === 2) {
        return generateStadiumHull(hull[0], hull[1], padding);
    }

    return hull.map(pt => {
        const dx = pt.x - centroid.x;
        const dy = pt.y - centroid.y;
        const dist = Math.hypot(dx, dy) || 1;
        return {
            x: pt.x + (dx / dist) * (padding * 1.12),
            y: pt.y + (dy / dist) * (padding * 1.12)
        };
    });
}

// Generate smooth cubic Bézier spline through points
export function createSmoothHullPath(ctx: CanvasRenderingContext2D, points: Point[]): void {
    if (points.length < 3) {
        if (points.length === 2) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[1].x, points[1].y);
        }
        return;
    }

    ctx.beginPath();
    ctx.moveTo((points[0].x + points[points.length - 1].x) / 2, (points[0].y + points[points.length - 1].y) / 2);

    for (let i = 0; i < points.length; i++) {
        const curr = points[i];
        const next = points[(i + 1) % points.length];
        const midX = (curr.x + next.x) / 2;
        const midY = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }
    ctx.closePath();
}

export function updateClusterHulls(
    clusters: BubbleCluster[],
    nodeMap: Map<string, BubbleNode>,
    padding: number = 18,
    visibleNodeIds?: Set<string> | null,
    isBubbleMode: boolean = false
): void {
    // Process subclusters (depth 2) first so top-level clusters (depth 1) know subcluster boundaries
    const sorted = [...clusters].sort((a, b) => b.depth - a.depth);

    for (const cluster of sorted) {
        let clusterNodes = cluster.nodeIds
            .map(id => nodeMap.get(id))
            .filter((n): n is BubbleNode => Boolean(n));

        if (visibleNodeIds) {
            clusterNodes = clusterNodes.filter(n => visibleNodeIds.has(n.id));
        }

        if (clusterNodes.length === 0) {
            cluster.hullPolygon = [];
            cluster.radius = 0;
            cluster.boundingBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
            continue;
        }

        if (isBubbleMode) {
            // In bubble mode, centroid and radius are authoritatively managed by the PBD bubble simulation.
            // Preserving exact radius and centroid guarantees circles never overlap and "just touch" as simulated.
            cluster.boundingBox = {
                minX: cluster.centroid.x - cluster.radius,
                minY: cluster.centroid.y - cluster.radius,
                maxX: cluster.centroid.x + cluster.radius,
                maxY: cluster.centroid.y + cluster.radius
            };
            cluster.hullPolygon = generateCircleHull(cluster.centroid, cluster.radius, 48);
            continue;
        }

        // 1. Calculate Centroid
        let sumX = 0;
        let sumY = 0;
        for (const n of clusterNodes) {
            sumX += n.x;
            sumY += n.y;
        }
        const count = clusterNodes.length;
        const avgCentroid = { x: sumX / count, y: sumY / count };

        // For subclusters (depth 2), centroid directly tracks member nodes
        // For top clusters (depth 1), preserve simulation-positioned centroid if valid
        if (cluster.depth === 2 || !cluster.centroid || (cluster.centroid.x === 0 && cluster.centroid.y === 0 && count > 0)) {
            cluster.centroid = avgCentroid;
        }

        // 2. Measure maximum distance from centroid to enclose all nodes
        let maxR = 0;
        for (const n of clusterNodes) {
            const d = Math.hypot(n.x - cluster.centroid.x, n.y - cluster.centroid.y) + n.radius;
            if (d > maxR) maxR = d;
        }

        // For parent cluster, also enclose any child subclusters
        if (cluster.depth === 1) {
            const childSubs = clusters.filter(s => s.depth === 2 && s.parentClusterId === cluster.id && s.radius > 0);
            for (const sub of childSubs) {
                const d = Math.hypot(sub.centroid.x - cluster.centroid.x, sub.centroid.y - cluster.centroid.y) + sub.radius;
                if (d > maxR) maxR = d;
            }
        }

        // 3. Compute aesthetic circular radius with generous breathing room
        const effPadding = cluster.depth === 1 ? padding + 8 : padding + 4;
        const minR = clusterNodes.length <= 1 
            ? (cluster.depth === 1 ? 36 : 22)
            : clusterNodes.length === 2 
                ? (cluster.depth === 1 ? 46 : 30) 
                : (cluster.depth === 1 ? Math.max(54, cluster.radius || 0) : Math.max(26, cluster.radius || 0));

        cluster.radius = Math.max(minR, maxR + effPadding, cluster.radius || 0);

        // 4. Update Bounding Box strictly around the circle
        cluster.boundingBox = {
            minX: cluster.centroid.x - cluster.radius,
            minY: cluster.centroid.y - cluster.radius,
            maxX: cluster.centroid.x + cluster.radius,
            maxY: cluster.centroid.y + cluster.radius
        };

        // 5. Generate smooth circular hull polygon (48 vertices)
        cluster.hullPolygon = generateCircleHull(cluster.centroid, cluster.radius, 48);
    }
}


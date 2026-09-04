import { BubbleNode, BubbleCluster } from './types';

export interface Point {
    x: number;
    y: number;
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
        const res: Point[] = [];
        const steps = 16;
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            res.push({
                x: p1.x + Math.cos(angle) * padding,
                y: p1.y + Math.sin(angle) * padding
            });
        }
        return res;
    }

    const angle = Math.atan2(dy, dx);
    const res: Point[] = [];
    const steps = 8;

    // Semicircular end cap around p2 (extending outward past p2 in direction of angle)
    for (let i = 0; i <= steps; i++) {
        const a = (angle - Math.PI / 2) + (i / steps) * Math.PI;
        res.push({
            x: p2.x + Math.cos(a) * padding,
            y: p2.y + Math.sin(a) * padding
        });
    }

    // Semicircular end cap around p1 (extending outward past p1 in direction of angle + PI)
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
        // Generate a 16-point circle around single node
        const p = hull[0];
        const res: Point[] = [];
        const steps = 16;
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            res.push({
                x: p.x + Math.cos(angle) * padding,
                y: p.y + Math.sin(angle) * padding
            });
        }
        return res;
    }
    if (hull.length === 2) {
        // Proper capsule stadium with semicircular end caps: both nodes are well inside
        return generateStadiumHull(hull[0], hull[1], padding);
    }

    // For polygons with 3+ points, expand along outward direction with slight corner expansion to offset Bezier rounding
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
    visibleNodeIds?: Set<string> | null
): void {
    for (const cluster of clusters) {
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

        // 1. Calculate Centroid
        let sumX = 0;
        let sumY = 0;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const n of clusterNodes) {
            sumX += n.x;
            sumY += n.y;
            minX = Math.min(minX, n.x - n.radius);
            minY = Math.min(minY, n.y - n.radius);
            maxX = Math.max(maxX, n.x + n.radius);
            maxY = Math.max(maxY, n.y + n.radius);
        }

        const count = clusterNodes.length;
        cluster.centroid = { x: sumX / count, y: sumY / count };

        // 2. Add generous padding to bounding box and hull (nodes deeply inside)
        const effPadding = cluster.depth === 1 ? padding + 8 : padding + 4;
        cluster.boundingBox = {
            minX: minX - effPadding,
            minY: minY - effPadding,
            maxX: maxX + effPadding,
            maxY: maxY + effPadding
        };

        let maxR = 0;
        for (const n of clusterNodes) {
            const d = Math.hypot(n.x - cluster.centroid.x, n.y - cluster.centroid.y) + n.radius;
            if (d > maxR) maxR = d;
        }

        const minR = clusterNodes.length <= 1 
            ? 30 
            : (clusterNodes.length === 2 ? 38 : (cluster.depth === 1 ? Math.min(56, 30 + clusterNodes.length * 5) : 24));
        if (!cluster.radius || cluster.radius === 0) {
            cluster.radius = Math.max(minR, maxR + effPadding);
        } else {
            cluster.radius = Math.max(cluster.radius, minR);
        }

        // 3. Compute Convex Hull with boundary containment safety
        const limitR = cluster.radius - 2;
        const points: Point[] = clusterNodes.map(n => {
            const dx = n.x - cluster.centroid.x;
            const dy = n.y - cluster.centroid.y;
            const d = Math.hypot(dx, dy) || 0.001;
            if (d > limitR) {
                return {
                    x: cluster.centroid.x + (dx / d) * limitR,
                    y: cluster.centroid.y + (dy / d) * limitR
                };
            }
            return { x: n.x, y: n.y };
        });
        const rawHull = computeConvexHull(points);

        // 4. Expand Hull
        cluster.hullPolygon = expandHull(rawHull, cluster.centroid, effPadding);
    }
}

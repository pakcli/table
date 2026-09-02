import { Platform } from 'obsidian';

/**
 * Pure JavaScript path utility functions that work cross-platform
 * (Mobile Android/iOS, Web, Desktop) without importing Node.js 'path'.
 */
export const PathUtils = {
	join(...parts: string[]): string {
		return parts
			.map((part, index) => {
				if (index === 0) {
					return part.trim().replace(/[\/\\]+$/, '');
				}
				return part.trim().replace(/^[\/\\]+|[\/\\]+$/g, '');
			})
			.filter(part => part.length > 0)
			.join('/');
	},

	dirname(pathStr: string): string {
		const normalized = pathStr.replace(/\\/g, '/').replace(/\/+$/, '');
		const lastSlash = normalized.lastIndexOf('/');
		if (lastSlash === -1) return '.';
		if (lastSlash === 0) return '/';
		return normalized.slice(0, lastSlash);
	},

	basename(pathStr: string, ext?: string): string {
		const normalized = pathStr.replace(/\\/g, '/').replace(/\/+$/, '');
		const lastSlash = normalized.lastIndexOf('/');
		let base = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
		if (ext && base.endsWith(ext)) {
			base = base.slice(0, -ext.length);
		}
		return base;
	},

	isAbsolute(pathStr: string): boolean {
		if (/^[a-zA-Z]:[\\\/]/.test(pathStr)) return true;
		if (pathStr.startsWith('/') || pathStr.startsWith('\\\\')) return true;
		return false;
	},

	extname(pathStr: string): string {
		const base = this.basename(pathStr);
		const lastDot = base.lastIndexOf('.');
		if (lastDot <= 0) return '';
		return base.slice(lastDot);
	},

	relative(from: string, to: string): string {
		const normFrom = from.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
		const normTo = to.replace(/\\/g, '/').toLowerCase();
		if (normTo.startsWith(normFrom)) {
			const rel = to.slice(normFrom.length);
			return rel.replace(/^[\/\\]+/, '');
		}
		return to;
	},

	normalize(pathStr: string): string {
		return pathStr.replace(/\\/g, '/');
	}
};

/**
 * Safely access path utilities. Always uses pure JS PathUtils.
 */
export function getNodePath(): typeof PathUtils {
	return PathUtils;
}

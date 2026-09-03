import { AsciiProjectData, AsciiTheme, LayerData } from '../types';
import { GridBuffer } from '../core/GridBuffer';

export class AsciiSerializer {
	/**
	 * Parses codeblock source into structured project data
	 */
	public static parse(source: string): AsciiProjectData {
		const trimmed = source.trim();

		// Try parsing as JSON project first
		if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
			try {
				const json = JSON.parse(trimmed) as {
					frames?: unknown[];
					rows?: number;
					cols?: number;
					theme?: string;
					layers?: LayerData[];
				};
				if (json && Array.isArray(json.frames)) {
					const frameList: string[] = json.frames.map(f => typeof f === 'string' ? f : String(f ?? ''));
					const firstFrame = frameList[0] || '';
					const lines = firstFrame.split(/\r?\n/);
					const rows = typeof json.rows === 'number' ? json.rows : Math.max(lines.length, 15);
					const cols = typeof json.cols === 'number' ? json.cols : Math.max(...lines.map((l: string) => l.length), 40);

					return {
						version: 1,
						type: 'asciidraw',
						cols,
						rows,
						fps: 8,
						theme: (json.theme as AsciiTheme) || 'default',
						frames: frameList,
						layers: Array.isArray(json.layers) ? json.layers : undefined
					};
				}
			} catch {
				// Fall through to plain text parsing
			}
		}

		// Plain text ASCII diagram
		const lines = source.split(/\r?\n/);
		const rows = Math.max(lines.length, 15);
		const cols = Math.max(...lines.map(l => l.length), 40);

		return {
			version: 1,
			type: 'asciidraw',
			cols,
			rows,
			fps: 8,
			theme: 'default',
			frames: [source],
			rawText: source
		};
	}

	/**
	 * Serializes GridBuffers or multi-layer projects into codeblock content
	 */
	public static serialize(
		buffers: GridBuffer[],
		theme: AsciiTheme = 'default',
		forceJson = false,
		layers?: LayerData[]
	): string {
		if (buffers.length === 0) return '';

		const hasMultipleLayers = layers && layers.length > 1;

		// If single frame, single layer, not forced JSON, and default theme -> clean plain ASCII!
		if (buffers.length === 1 && !hasMultipleLayers && !forceJson && theme === 'default') {
			return buffers[0].toString(true);
		}

		// Multi-layer or styled project -> serialize as JSON
		const frameStrings = buffers.map(b => b.toString(false));
		const maxCols = Math.max(...buffers.map(b => b.cols));
		const maxRows = Math.max(...buffers.map(b => b.rows));

		const project: AsciiProjectData = {
			version: 1,
			type: 'asciidraw',
			cols: maxCols,
			rows: maxRows,
			fps: 8,
			theme,
			frames: frameStrings,
			layers: hasMultipleLayers ? layers : undefined
		};

		return JSON.stringify(project, null, 2);
	}
}

import { AsciiProjectData, AsciiTheme, LayerData } from '../types';
import { GridBuffer } from '../core/GridBuffer';

export class AsciiSerializer {
	/**
	 * Parses codeblock source into structured project data
	 */
	public static parse(source: string): AsciiProjectData {
		const trimmed = source.trim();

		// 1. Try parsing as JSON project first
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
					const rows = typeof json.rows === 'number' && json.rows > 0 ? json.rows : Math.max(lines.length, 20);
					const cols = typeof json.cols === 'number' && json.cols > 0 ? json.cols : Math.max(...lines.map((l: string) => l.length), 60);

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

		// 2. Check for dimension/theme metadata header comment: <!-- size: 80x24, theme: matrix -->
		let cols = 60;
		let rows = 20;
		let theme: AsciiTheme = 'default';
		let cleanedSource = source;

		const metaMatch = source.match(/^(?:<!--|%%)\s*(?:size:\s*(\d+)\s*[xX]\s*(\d+))?(?:[,\s]*theme:\s*([a-zA-Z0-9_\-\s]+))?\s*(?:-->|%%)\r?\n/i);
		if (metaMatch) {
			if (metaMatch[1] && metaMatch[2]) {
				cols = Math.max(5, parseInt(metaMatch[1], 10));
				rows = Math.max(3, parseInt(metaMatch[2], 10));
			}
			if (metaMatch[3]) {
				theme = metaMatch[3].trim() as AsciiTheme;
			}
			cleanedSource = source.substring(metaMatch[0].length);
		} else {
			const lines = source.split(/\r?\n/);
			rows = Math.max(lines.length, 20);
			cols = Math.max(...lines.map(l => l.length), 60);
		}

		return {
			version: 1,
			type: 'asciidraw',
			cols,
			rows,
			fps: 8,
			theme,
			frames: [cleanedSource],
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

		const maxCols = Math.max(...buffers.map(b => b.cols), 60);
		const maxRows = Math.max(...buffers.map(b => b.rows), 20);

		// Multi-layer, styled project, or forced JSON -> serialize as JSON
		if (forceJson || (layers && layers.length > 0) || theme !== 'default') {
			const frameStrings = buffers.map(b => b.toString(false));

			const project: AsciiProjectData = {
				version: 1,
				type: 'asciidraw',
				cols: maxCols,
				rows: maxRows,
				fps: 8,
				theme,
				frames: frameStrings,
				layers: (layers && layers.length > 0) ? layers : undefined
			};

			return JSON.stringify(project, null, 2);
		}

		// Single frame plain ASCII with size metadata header
		const content = buffers[0].toString(true);
		const header = `<!-- size: ${maxCols}x${maxRows} -->\n`;
		return header + content;
	}
}

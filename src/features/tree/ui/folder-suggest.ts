import { AbstractInputSuggest, App, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<string> {
	private inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	getSuggestions(inputStr: string): string[] {
		let folderPaths: string[] = [];
		try {
			const vaultRecord = this.app.vault as unknown as Record<string, unknown>;
			if (typeof vaultRecord['getAllFolders'] === 'function') {
				const getFoldersFn = vaultRecord['getAllFolders'] as (includeRoot: boolean) => TFolder[];
				const folders = getFoldersFn(false);
				folderPaths = folders.map((folder: TFolder) => folder.path);
			} else {
				const files = this.app.vault.getAllLoadedFiles();
				folderPaths = files.filter((f): f is TFolder => f instanceof TFolder).map(f => f.path);
			}
		} catch {
			try {
				const files = this.app.vault.getAllLoadedFiles();
				folderPaths = files.filter((f): f is TFolder => f instanceof TFolder).map(f => f.path);
			} catch {
				folderPaths = [];
			}
		}

		const inputLower = (inputStr || '').toLowerCase();
		const matchingPaths = folderPaths.filter(path =>
			path.toLowerCase().includes(inputLower)
		);

		// Sort alphabetically
		matchingPaths.sort();
		return matchingPaths;
	}

	renderSuggestion(path: string, el: HTMLElement): void {
		el.createEl('span', { text: path });
	}

	selectSuggestion(path: string): void {
		this.setValue(path);
		this.close();
		// Dispatch the input event so that the onChange callback of the Setting component fires
		this.inputEl.dispatchEvent(new Event('input'));
	}
}

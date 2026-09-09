import { App, Modal, Notice, Setting, TFile, TFolder } from "obsidian";

export interface FolderizeOptions {
	folderNameInput: string; // "0" or custom name
	createIndexMd: boolean;
	indexMode: "as-index" | "new-index"; // "as-index": move current file to index.md, "new-index": keep current file, create separate index.md
	addFrontmatterTitle: boolean;
	titleInput: string; // "0" or custom title
}

export class TurnFileIntoFolderModal extends Modal {
	private file: TFile;
	private options: FolderizeOptions = {
		folderNameInput: "0",
		createIndexMd: true,
		indexMode: "as-index",
		addFrontmatterTitle: true,
		titleInput: "0",
	};

	constructor(app: App, file: TFile) {
		super(app);
		this.file = file;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("turn-file-into-folder-modal");

		contentEl.createEl("h2", { text: "📁 Turn File into Folder" });

		const baseName = this.file.basename;
		const parentPath = this.file.parent ? (this.file.parent.path === "/" ? "" : this.file.parent.path) : "";

		const infoBox = contentEl.createEl("div", {
			cls: "folderize-info-box",
			attr: {
				style: "background: var(--background-secondary); padding: 0.8rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.88rem; border: 1px solid var(--background-modifier-border);"
			}
		});
		infoBox.innerHTML = `<strong>Source Note:</strong> <code>${this.file.path}</code><br><small style="color:var(--text-muted)">Default shorthand <b>0</b> = use original file name (<code>${baseName}</code>)</small>`;

		// 1. Folder Name Setting
		new Setting(contentEl)
			.setName("Folder Name")
			.setDesc(`Enter "0" to use file name (${baseName}) or type custom folder name:`)
			.addText((text) => {
				text.setPlaceholder("0 or custom name")
					.setValue(this.options.folderNameInput)
					.onChange((val) => {
						this.options.folderNameInput = val.trim() || "0";
					});
			});

		// 2. Create index.md Toggle
		let indexModeSetting: Setting | null = null;
		new Setting(contentEl)
			.setName("Create index.md")
			.setDesc("Create an index.md file inside the new folder (ideal for Quartz / Folder Note)")
			.addToggle((toggle) => {
				toggle.setValue(this.options.createIndexMd).onChange((val) => {
					this.options.createIndexMd = val;
					if (indexModeSetting) {
						indexModeSetting.settingEl.style.display = val ? "flex" : "none";
					}
				});
			});

		// 3. How to create index.md
		indexModeSetting = new Setting(contentEl)
			.setName("index.md Strategy")
			.setDesc("Choose how index.md is handled:")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("as-index", `Rename current note to ${baseName}/index.md (Recommended)`)
					.addOption("new-index", `Keep current note (${baseName}.md) & create fresh index.md`)
					.setValue(this.options.indexMode)
					.onChange((val) => {
						this.options.indexMode = val as "as-index" | "new-index";
					});
			});

		// 4. Frontmatter Title Toggle
		let titleInputSetting: Setting | null = null;
		new Setting(contentEl)
			.setName("Add Frontmatter Title")
			.setDesc("Inject or update YAML frontmatter `title: x` in index.md")
			.addToggle((toggle) => {
				toggle.setValue(this.options.addFrontmatterTitle).onChange((val) => {
					this.options.addFrontmatterTitle = val;
					if (titleInputSetting) {
						titleInputSetting.settingEl.style.display = val ? "flex" : "none";
					}
				});
			});

		// 5. Title Value: "0" = file name, or custom
		titleInputSetting = new Setting(contentEl)
			.setName("Frontmatter Title Value (x)")
			.setDesc(`Enter "0" for "${baseName}" or type desired title manually:`)
			.addText((text) => {
				text.setPlaceholder("0 or manual title")
					.setValue(this.options.titleInput)
					.onChange((val) => {
						this.options.titleInput = val.trim() || "0";
					});
			});

		// Action Buttons
		const btnRow = contentEl.createEl("div", {
			attr: { style: "display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1.5rem;" }
		});

		const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnRow.createEl("button", {
			text: "Turn into Folder",
			cls: "mod-cta"
		});
		confirmBtn.onclick = async () => {
			confirmBtn.disabled = true;
			confirmBtn.textContent = "Processing...";
			try {
				await this.executeFolderize(baseName, parentPath);
				this.close();
			} catch (err: any) {
				new Notice(`Error turning file into folder: ${err?.message || err}`);
				confirmBtn.disabled = false;
				confirmBtn.textContent = "Turn into Folder";
			}
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async executeFolderize(baseName: string, parentPath: string): Promise<void> {
		// Resolve target folder name
		const folderName = (this.options.folderNameInput === "0" || !this.options.folderNameInput)
			? baseName
			: this.options.folderNameInput;

		const targetFolderPath = parentPath ? `${parentPath}/${folderName}` : folderName;

		// 1. Create target folder if not exists
		let folder = this.app.vault.getAbstractFileByPath(targetFolderPath);
		if (!folder) {
			folder = await this.app.vault.createFolder(targetFolderPath);
		} else if (!(folder instanceof TFolder)) {
			throw new Error(`A file already exists at ${targetFolderPath}`);
		}

		// Resolve frontmatter title value
		const titleVal = (this.options.titleInput === "0" || !this.options.titleInput)
			? baseName
			: this.options.titleInput;

		if (this.options.createIndexMd) {
			if (this.options.indexMode === "as-index") {
				// Strategy A: Move this file into targetFolderPath/index.md
				const targetIndexPath = `${targetFolderPath}/index.md`;
				await this.app.fileManager.renameFile(this.file, targetIndexPath);

				// Now update frontmatter title in index.md if requested
				const indexFile = this.app.vault.getAbstractFileByPath(targetIndexPath);
				if (indexFile instanceof TFile && this.options.addFrontmatterTitle) {
					await this.updateFrontmatterTitle(indexFile, titleVal);
				}

				new Notice(`Successfully turned "${baseName}" into folder "${folderName}/index.md"!`);
				if (indexFile instanceof TFile) {
					this.app.workspace.getLeaf(false).openFile(indexFile);
				}
			} else {
				// Strategy B: Move this file into targetFolderPath/baseName.md and create targetFolderPath/index.md
				const targetFilePath = `${targetFolderPath}/${this.file.name}`;
				await this.app.fileManager.renameFile(this.file, targetFilePath);

				const targetIndexPath = `${targetFolderPath}/index.md`;
				let indexContent = `# ${titleVal}\n\n`;
				if (this.options.addFrontmatterTitle) {
					indexContent = `---\ntitle: "${titleVal}"\n---\n\n# ${titleVal}\n\n`;
				}

				const existingIndex = this.app.vault.getAbstractFileByPath(targetIndexPath);
				if (!existingIndex) {
					const newIndexFile = await this.app.vault.create(targetIndexPath, indexContent);
					new Notice(`Created folder "${folderName}" with "${this.file.name}" and index.md!`);
					this.app.workspace.getLeaf(false).openFile(newIndexFile);
				} else {
					new Notice(`Moved "${this.file.name}" into "${folderName}/". (index.md already existed)`);
				}
			}
		} else {
			// No index.md requested: just move file into targetFolderPath/baseName.md
			const targetFilePath = `${targetFolderPath}/${this.file.name}`;
			await this.app.fileManager.renameFile(this.file, targetFilePath);
			new Notice(`Moved "${baseName}" into folder "${folderName}/"!`);
		}
	}

	private async updateFrontmatterTitle(file: TFile, title: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, any>) => {
			fm.title = title;
		});
	}
}

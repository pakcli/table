import { App, Modal, Setting, TFile } from "obsidian";

export function getArtifactPath(csvPath: string, customFolder?: string): string {
  const folder = (customFolder && customFolder.trim()) ? customFolder.trim().replace(/^\/+|\/+$/g, '') : 'csv_view_artifacts';
  const withoutExt = csvPath.substring(0, csvPath.lastIndexOf('.')) || csvPath;
  return folder ? `${folder}/${withoutExt}.json` : `${withoutExt}.json`;
}

export async function ensureFolderExists(app: App, folderPath: string) {
  try {
    if (app.vault.adapter && typeof app.vault.adapter.mkdir === "function") {
      await app.vault.adapter.mkdir(folderPath).catch(() => {
        // Folder may already exist
      });
    }
  } catch {
    // Adapter mkdir fallback
  }
  const parts = folderPath.split('/');
  let current = '';
  for (const part of parts) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    try {
      const folder = app.vault.getAbstractFileByPath ? app.vault.getAbstractFileByPath(current) : null;
      if (!folder) {
        await app.vault.createFolder(current).catch(() => {
          // Folder may already exist
        });
      }
    } catch {
      // Folder creation error ignored
    }
  }
}

export async function handleArtifactRename(app: App, oldPath: string, newPath: string, customFolder?: string) {
  const oldArtifactPath = getArtifactPath(oldPath, customFolder);
  let oldArtifactFile = (app.vault.getFileByPath ? app.vault.getFileByPath(oldArtifactPath) : app.vault.getAbstractFileByPath(oldArtifactPath)) as TFile | null;
  if (!oldArtifactFile && customFolder && customFolder.trim() !== 'csv_view_artifacts') {
    const legacyPath = getArtifactPath(oldPath, 'csv_view_artifacts');
    oldArtifactFile = (app.vault.getFileByPath ? app.vault.getFileByPath(legacyPath) : app.vault.getAbstractFileByPath(legacyPath)) as TFile | null;
  }
  if (oldArtifactFile instanceof TFile) {
    const newArtifactPath = getArtifactPath(newPath, customFolder);
    const parentIndex = newArtifactPath.lastIndexOf('/');
    if (parentIndex !== -1) {
      const parentPath = newArtifactPath.substring(0, parentIndex);
      await ensureFolderExists(app, parentPath);
    }
    await app.vault.rename(oldArtifactFile, newArtifactPath);
  }
}

async function listAllJsonFiles(app: App, folderPath: string): Promise<string[]> {
  const results: string[] = [];
  try {
    if (app.vault.adapter && typeof app.vault.adapter.list === 'function') {
      const queue = [folderPath];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (await app.vault.adapter.exists(current)) {
          const res = await app.vault.adapter.list(current);
          if (res.files) {
            for (const f of res.files) {
              if (f.toLowerCase().endsWith('.json')) {
                results.push(f.replace(/\\/g, '/'));
              }
            }
          }
          if (res.folders) {
            for (const sub of res.folders) {
              queue.push(sub.replace(/\\/g, '/'));
            }
          }
        }
      }
      if (results.length > 0) return results;
    }
  } catch {
    // fallback to vault.getFiles()
  }

  const prefix = folderPath ? `${folderPath}/` : '';
  const files = app.vault.getFiles();
  for (const f of files) {
    if (f.path.startsWith(prefix) && f.extension.toLowerCase() === 'json') {
      results.push(f.path);
    }
  }
  return results;
}

export async function moveArtifactsBetweenFolders(
  app: App,
  sourceFolder: string,
  targetFolder: string
): Promise<{ moved: number; errors: number }> {
  const src = sourceFolder.trim().replace(/^\/+|\/+$/g, '');
  const dest = targetFolder.trim().replace(/^\/+|\/+$/g, '');
  if (!src || !dest || src === dest) {
    return { moved: 0, errors: 0 };
  }

  await ensureFolderExists(app, dest);

  const filePaths = await listAllJsonFiles(app, src);
  let moved = 0;
  let errors = 0;
  const srcPrefix = `${src}/`;

  for (const rawPath of filePaths) {
    try {
      const normalizedPath = rawPath.replace(/\\/g, '/');
      const relPath = normalizedPath.startsWith(srcPrefix)
        ? normalizedPath.substring(srcPrefix.length)
        : normalizedPath.substring(normalizedPath.indexOf(srcPrefix) + srcPrefix.length);

      const targetPath = `${dest}/${relPath}`;
      const parentIndex = targetPath.lastIndexOf('/');
      if (parentIndex !== -1) {
        const parentPath = targetPath.substring(0, parentIndex);
        await ensureFolderExists(app, parentPath);
      }

      const fileObj = app.vault.getAbstractFileByPath
        ? app.vault.getAbstractFileByPath(normalizedPath)
        : null;

      if (fileObj instanceof TFile) {
        const existingTarget = (
          app.vault.getFileByPath
            ? app.vault.getFileByPath(targetPath)
            : app.vault.getAbstractFileByPath(targetPath)
        ) as TFile | null;

        if (existingTarget instanceof TFile) {
          const content = await app.vault.read(fileObj);
          await app.vault.modify(existingTarget, content);
          await app.vault.delete(fileObj);
        } else {
          await app.vault.rename(fileObj, targetPath);
        }
      } else if (app.vault.adapter) {
        const content = await app.vault.adapter.read(normalizedPath);
        await app.vault.adapter.write(targetPath, content);
        await app.vault.adapter.remove(normalizedPath);
      }
      moved++;
    } catch (err) {
      console.error(`Failed to move artifact file ${rawPath} to ${dest}:`, err);
      errors++;
    }
  }

  return { moved, errors };
}

export class PromptModal extends Modal {
  private value: string = "";
  private onSubmit: (value: string) => void;

  constructor(
    app: App,
    private titleText: string,
    private placeholder: string,
    defaultValue: string,
    onSubmit: (value: string) => void
  ) {
    super(app);
    this.value = defaultValue;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.titleText });

    new Setting(contentEl)
      .addText((text) => {
        text
          .setPlaceholder(this.placeholder)
          .setValue(this.value)
          .onChange((val) => {
            this.value = val;
          });
        
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.onSubmit(this.value);
            this.close();
          }
        });

        window.setTimeout(() => {
          text.inputEl.focus();
          text.inputEl.select();
        }, 50);
      });

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = buttonContainer.createEl("button", { text: "Submit", cls: "mod-cta" });
    submitBtn.addEventListener("click", () => {
      this.onSubmit(this.value);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private titleText: string,
    private messageText: string,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", { text: this.messageText });

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = buttonContainer.createEl("button", { text: "Confirm", cls: "mod-warning" });
    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function formatHeaderName(name: string): string {
  if (!name) return "";
  return name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // Handles camelCase
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export interface AutocompleteColConfig {
  column: string;
  replacementEnabled: boolean;
  replacement: string;
  wikilinkEnabled: boolean;
}

export function parseAutocompleteSettings(settingStr: string): {
  columns: string[];
  replacements: Record<string, string>;
  configs: AutocompleteColConfig[];
} {
  const columns: string[] = [];
  const replacements: Record<string, string> = {};
  const configs: AutocompleteColConfig[] = [];

  if (!settingStr) {
    return { columns, replacements, configs };
  }

  const trimmed = settingStr.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && item.column) {
            const col = item.column.trim();
            const colLower = col.toLowerCase();
            const repEnabled = item.replacementEnabled !== false;
            const rep = (item.replacement || "").trim();
            const wikiEnabled = item.wikilinkEnabled !== false;

            if (wikiEnabled) {
              columns.push(colLower);
            }
            if (repEnabled) {
              replacements[colLower] = rep || formatHeaderName(col);
            }
            configs.push({
              column: col,
              replacementEnabled: repEnabled,
              replacement: rep,
              wikilinkEnabled: wikiEnabled
            });
          }
        }
        return { columns, replacements, configs };
      } else if (typeof parsed === 'object' && parsed !== null) {
        for (const [col, rep] of Object.entries(parsed)) {
          const colTrimmed = col.trim();
          const colLower = colTrimmed.toLowerCase();
          const repStr = typeof rep === 'string' ? rep.trim() : "";
          columns.push(colLower);
          replacements[colLower] = repStr || formatHeaderName(colTrimmed);
          configs.push({
            column: colTrimmed,
            replacementEnabled: true,
            replacement: repStr,
            wikilinkEnabled: true
          });
        }
        return { columns, replacements, configs };
      }
    } catch (e) {
      console.error("Failed to parse autocomplete columns settings as JSON", e);
    }
  }

  // Fallback to legacy comma-separated string
  const legacyCols = settingStr.split(',').map((s) => s.trim()).filter(Boolean);
  for (const col of legacyCols) {
    const colLower = col.toLowerCase();
    columns.push(colLower);
    const rep = formatHeaderName(col);
    replacements[colLower] = rep;
    configs.push({
      column: col,
      replacementEnabled: true,
      replacement: rep,
      wikilinkEnabled: true
    });
  }

  return { columns, replacements, configs };
}

export function resolveHeaderName(name: string, settingStr: string): string {
  if (!name) return "";
  const { replacements } = parseAutocompleteSettings(settingStr);
  const lower = name.toLowerCase();
  if (lower in replacements) {
    return replacements[lower] || name;
  }
  return name;
}

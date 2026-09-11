import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import * as React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';

export interface TriageResultItem {
  file: TFile;
  originalName: string;
  newName: string;
  action: 'keep' | 'trash';
  resourcePath: string;
}

export class TriageSummaryModal extends Modal {
  private folder: TFolder;
  private items: TriageResultItem[];

  constructor(app: App, folder: TFolder, items: TriageResultItem[]) {
    super(app);
    this.folder = folder;
    // Clone items list for local state manipulation
    this.items = items.map(item => ({ ...item }));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('triage-summary-modal-container');

    render(
      <SummaryView
        folderName={this.folder.name}
        initialItems={this.items}
        onCancel={() => this.close()}
        onApply={(finalItems) => this.handleApply(finalItems)}
      />,
      contentEl
    );
  }

  onClose() {
    const { contentEl } = this;
    unmountComponentAtNode(contentEl);
    contentEl.empty();
  }

  private async handleApply(finalItems: TriageResultItem[]) {
    let trashedCount = 0;
    let renamedCount = 0;

    for (const item of finalItems) {
      try {
        if (item.action === 'trash') {
          // Move to vault trash (.trash folder), NEVER permanent unlink
          await this.app.vault.trash(item.file, false);
          trashedCount++;
        } else if (item.action === 'keep') {
          const trimmedNewName = item.newName.trim();
          if (trimmedNewName && trimmedNewName !== item.originalName) {
            const parentPath = item.file.parent ? item.file.parent.path : '';
            const newPath = parentPath === '/' || !parentPath
              ? trimmedNewName
              : `${parentPath}/${trimmedNewName}`;

            await this.app.fileManager.renameFile(item.file, newPath);
            renamedCount++;
          }
        }
      } catch (err) {
        console.error(`Failed to process triage action for ${item.originalName}:`, err);
        new Notice(`Error processing ${item.originalName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    new Notice(`Triage Complete: ${trashedCount} trashed, ${renamedCount} renamed.`);
    this.close();
  }
}

interface SummaryViewProps {
  folderName: string;
  initialItems: TriageResultItem[];
  onCancel: () => void;
  onApply: (items: TriageResultItem[]) => void;
}

const SummaryView: React.FC<SummaryViewProps> = ({ folderName, initialItems, onCancel, onApply }) => {
  const [items, setItems] = React.useState<TriageResultItem[]>(initialItems);

  const handleActionToggle = (index: number) => {
    setItems(prev => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        action: copy[index].action === 'keep' ? 'trash' : 'keep',
      };
      return copy;
    });
  };

  const handleNameChange = (index: number, val: string) => {
    setItems(prev => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        newName: val,
      };
      return copy;
    });
  };

  const keepCount = items.filter(i => i.action === 'keep').length;
  const trashCount = items.filter(i => i.action === 'trash').length;

  return (
    <div className="triage-summary-wrapper">
      <div className="triage-summary-header">
        <h2>Folder Image Triage Summary — <span>{folderName}</span></h2>
        <div className="triage-summary-stats">
          <span className="stat-badge keep">Keep: {keepCount}</span>
          <span className="stat-badge trash">Trash: {trashCount}</span>
        </div>
      </div>

      <div className="triage-summary-table-wrapper">
        <table className="triage-summary-table">
          <thead>
            <tr>
              <th style={{ width: '80px' }}>Preview</th>
              <th>Original File</th>
              <th>Rename To</th>
              <th style={{ width: '120px', textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.file.path} className={`triage-row ${item.action}`}>
                <td className="triage-thumb-cell">
                  <img src={item.resourcePath} alt={item.originalName} className="triage-thumb" />
                </td>
                <td className="triage-name-cell">
                  <span className="file-name">{item.originalName}</span>
                </td>
                <td className="triage-rename-cell">
                  <input
                    type="text"
                    className="triage-rename-input"
                    value={item.newName}
                    disabled={item.action === 'trash'}
                    onChange={(e) => handleNameChange(idx, (e.target as HTMLInputElement).value)}
                  />
                </td>
                <td className="triage-action-cell">
                  <button
                    type="button"
                    className={`triage-toggle-btn ${item.action}`}
                    onClick={() => handleActionToggle(idx)}
                  >
                    {item.action === 'keep' ? '✓ KEEP' : '🗑 TRASH'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="triage-summary-footer">
        <button type="button" className="triage-btn secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="triage-btn primary" onClick={() => onApply(items)}>
          Apply & Execute Changes
        </button>
      </div>
    </div>
  );
};

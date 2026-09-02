import { Notice } from 'obsidian';

/**
 * In-vault copy helper without direct system clipboard access.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  new Notice('Content ready: ' + text.slice(0, 30) + '...');
  return true;
}

import { App, ItemView, WorkspaceLeaf, TFile, TFolder } from 'obsidian';
import * as React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import { DeckOrientation, ImageTriageView, TriageMode } from './ImageTriageModal';
import { TriageResultItem, TriageSummaryModal } from './TriageSummaryModal';

export const IMAGE_CAROUSEL_VIEW_TYPE = 'pakcli-image-carousel-view';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp']);

export class ImageCarouselView extends ItemView {
  private folderPath: string = '';
  private mode: TriageMode = 'view';
  private orientation: DeckOrientation = 'horizontal';
  private sideCards: number = 5;
  private direction: string = 'left-right';
  private curve: string = 'exponential';
  private switchDuration: number = 0.5;
  private holdDuration: number = 1.0;
  private autoPlay: boolean = true;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return IMAGE_CAROUSEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    const folderName = this.folderPath ? this.folderPath.split('/').pop() || 'Folder' : 'Folder';
    return `Image Triage: ${folderName}`;
  }

  getIcon(): string {
    return 'gallery-thumbnails';
  }

  async setState(state: any, result: any) {
    if (state.folderPath) this.folderPath = state.folderPath;
    if (state.mode) this.mode = state.mode;
    if (state.orientation) this.orientation = state.orientation;
    if (state.sideCards !== undefined) this.sideCards = Number(state.sideCards);
    if (state.direction) this.direction = state.direction;
    if (state.curve) this.curve = state.curve;
    if (state.switchDuration !== undefined) this.switchDuration = Number(state.switchDuration);
    if (state.holdDuration !== undefined) this.holdDuration = Number(state.holdDuration);
    if (state.autoPlay !== undefined) this.autoPlay = Boolean(state.autoPlay);
    await super.setState(state, result);
    this.renderView();
  }

  getState() {
    return {
      folderPath: this.folderPath,
      mode: this.mode,
      orientation: this.orientation,
      sideCards: this.sideCards,
      direction: this.direction,
      curve: this.curve,
      switchDuration: this.switchDuration,
      holdDuration: this.holdDuration,
      autoPlay: this.autoPlay,
    };
  }

  async onOpen() {
    this.renderView();
  }

  async onClose() {
    unmountComponentAtNode(this.contentEl);
    this.contentEl.empty();
  }

  renderView() {
    const container = this.contentEl;
    unmountComponentAtNode(container);
    container.empty();
    container.addClass('image-carousel-view-page');

    if (!this.folderPath) {
      container.createEl('div', { cls: 'image-carousel-empty-view', text: 'Select a folder to view or triage images.' });
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
    if (!(folder instanceof TFolder)) {
      container.createEl('div', { cls: 'image-carousel-empty-view', text: `Folder not found: ${this.folderPath}` });
      return;
    }

    const imageFiles: TFile[] = [];
    const collectImages = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile && IMAGE_EXTENSIONS.has(child.extension.toLowerCase())) {
          imageFiles.push(child);
        } else if (child instanceof TFolder) {
          collectImages(child);
        }
      }
    };
    collectImages(folder);

    if (imageFiles.length === 0) {
      container.createEl('div', { cls: 'image-carousel-empty-view', text: `No image files found in folder "${folder.name}".` });
      return;
    }

    render(
      <ImageTriageView
        app={this.app}
        folder={folder}
        imageFiles={imageFiles}
        initialMode={this.mode}
        initialOrientation={this.orientation}
        sideCards={this.sideCards}
        direction={this.direction}
        curve={this.curve}
        switchDuration={this.switchDuration}
        holdDuration={this.holdDuration}
        autoPlay={this.autoPlay}
        onClose={() => this.leaf.detach()}
        onFinishTriage={(results) => {
          new TriageSummaryModal(this.app, folder, results).open();
        }}
      />,
      container
    );
  }
}

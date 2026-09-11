import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import * as React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import { CharacterCarousel } from '../../shaders/character-carousel/CharacterCarousel';
import { TriageResultItem, TriageSummaryModal } from './TriageSummaryModal';

export type DeckOrientation = 'horizontal' | 'vertical';
export type TriageMode = 'view' | 'edit';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp']);

export class ImageTriageModal extends Modal {
  private folder: TFolder;
  private mode: TriageMode;
  private orientation: DeckOrientation;

  constructor(app: App, folder: TFolder, mode: TriageMode = 'edit', orientation: DeckOrientation = 'horizontal') {
    super(app);
    this.folder = folder;
    this.mode = mode;
    this.orientation = orientation;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('image-triage-modal');

    // Collect all image files in folder
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
    collectImages(this.folder);

    if (imageFiles.length === 0) {
      new Notice(`No image files found in folder "${this.folder.name}".`);
      this.close();
      return;
    }

    render(
      <ImageTriageView
        app={this.app}
        folder={this.folder}
        imageFiles={imageFiles}
        initialMode={this.mode}
        initialOrientation={this.orientation}
        onClose={() => this.close()}
        onFinishTriage={(results) => {
          this.close();
          new TriageSummaryModal(this.app, this.folder, results).open();
        }}
      />,
      contentEl
    );
  }

  onClose() {
    const { contentEl } = this;
    unmountComponentAtNode(contentEl);
    contentEl.empty();
  }
}

export interface ImageTriageViewProps {
  app: App;
  folder: TFolder;
  imageFiles: TFile[];
  initialMode: TriageMode;
  initialOrientation: DeckOrientation;
  sideCards?: number;
  direction?: 'left-right' | 'left' | 'right' | string;
  curve?: 'linear' | 'exponential' | string;
  switchDuration?: number | string;
  holdDuration?: number | string;
  autoPlay?: boolean;
  onClose: () => void;
  onFinishTriage: (results: TriageResultItem[]) => void;
}

function normalizeDirection(val?: string): 'left-right' | 'left' | 'right' {
  const s = String(val || 'left-right').toLowerCase().replace(/\s+/g, '-');
  if (s.includes('right') && !s.includes('left')) return 'right';
  if (s.includes('left') && !s.includes('right')) return 'left';
  return 'left-right';
}

function normalizeCurve(val?: string): 'linear' | 'exponential' {
  const s = String(val || 'exponential').toLowerCase();
  return s.includes('linear') ? 'linear' : 'exponential';
}

async function getFileDataUrl(app: App, file: TFile): Promise<string> {
  try {
    const buffer = await app.vault.readBinary(file);
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    const base64 = btoa(binary);
    const ext = file.extension.toLowerCase();
    const mime = ext === 'png' ? 'image/png'
      : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : ext === 'svg' ? 'image/svg+xml'
      : 'image/png';
    return `data:${mime};base64,${base64}`;
  } catch {
    return app.vault.getResourcePath(file);
  }
}

export const ImageTriageView: React.FC<ImageTriageViewProps> = ({
  app,
  folder,
  imageFiles,
  initialMode,
  initialOrientation,
  sideCards = 5,
  direction = 'left-right',
  curve = 'exponential',
  switchDuration = 0.5,
  holdDuration = 1.0,
  autoPlay = true,
  onClose,
  onFinishTriage,
}) => {
  const [mode, setMode] = React.useState<TriageMode>(initialMode);
  const [orientation, setOrientation] = React.useState<DeckOrientation>(initialOrientation);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [triageHistory, setTriageHistory] = React.useState<TriageResultItem[]>([]);
  const [dataUrls, setDataUrls] = React.useState<Record<string, string>>({});
  const [isPlaying, setIsPlaying] = React.useState(autoPlay);
  const [animSpeed, setAnimSpeed] = React.useState(1.0);
  const animDirection = normalizeDirection(direction);
  const animCurve = normalizeCurve(curve);
  const switchSec = typeof switchDuration === 'number' ? switchDuration : (parseFloat(String(switchDuration)) || 0.5);
  const holdSec = typeof holdDuration === 'number' ? holdDuration : (parseFloat(String(holdDuration)) ?? 1.0);
  const [lightbox, setLightbox] = React.useState<{ src: string; name: string } | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [focusIndex, setFocusIndex] = React.useState<number | undefined>(undefined);

  React.useEffect(() => {
    let active = true;
    const loadUrls = async () => {
      const map: Record<string, string> = {};
      for (const file of imageFiles) {
        map[file.path] = await getFileDataUrl(app, file);
      }
      if (active) {
        setDataUrls(map);
      }
    };
    loadUrls();
    return () => { active = false; };
  }, [app, imageFiles]);

  // Drag state
  const [dragOffset, setDragOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStartRef = React.useRef<{ x: number; y: number } | null>(null);

  const total = imageFiles.length;
  const currentFile = imageFiles[currentIndex];

  const getResourcePath = (file: TFile) => app.vault.getResourcePath(file);

  const handleSwipe = React.useCallback(
    (action: 'keep' | 'trash') => {
      if (currentIndex >= total) return;
      const item: TriageResultItem = {
        file: imageFiles[currentIndex],
        originalName: imageFiles[currentIndex].name,
        newName: imageFiles[currentIndex].name,
        action,
        resourcePath: getResourcePath(imageFiles[currentIndex]),
      };

      setTriageHistory(prev => [...prev, item]);
      setCurrentIndex(prev => prev + 1);
      setDragOffset({ x: 0, y: 0 });
    },
    [currentIndex, total, imageFiles, app]
  );

  const handleUndo = () => {
    if (triageHistory.length === 0) return;
    setTriageHistory(prev => prev.slice(0, prev.length - 1));
    setCurrentIndex(prev => Math.max(0, prev - 1));
    setDragOffset({ x: 0, y: 0 });
  };

  // Keyboard navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Close lightbox on Escape
      if (e.key === 'Escape') {
        setLightbox(null);
        return;
      }
      if (mode !== 'edit' || currentIndex >= total) return;

      if (e.key === 'ArrowLeft' || (orientation === 'vertical' && e.key === 'ArrowUp')) {
        e.preventDefault();
        handleSwipe('trash');
      } else if (e.key === 'ArrowRight' || (orientation === 'vertical' && e.key === 'ArrowDown')) {
        e.preventDefault();
        handleSwipe('keep');
      } else if (e.key === 'Backspace' || (e.ctrlKey && e.key === 'z')) {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, currentIndex, total, orientation, handleSwipe, lightbox]);

  // Pointer event handlers for touch / mouse dragging
  const onPointerDown = (e: React.PointerEvent) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setDragOffset({ x: dx, y: dy });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    setIsDragging(false);

    const threshold = 70;
    const { x, y } = dragOffset;

    if (orientation === 'horizontal') {
      if (x < -threshold) {
        handleSwipe('trash');
      } else if (x > threshold) {
        handleSwipe('keep');
      } else {
        setDragOffset({ x: 0, y: 0 });
      }
    } else {
      // vertical layout
      if (y < -threshold) {
        handleSwipe('trash');
      } else if (y > threshold) {
        handleSwipe('keep');
      } else {
        setDragOffset({ x: 0, y: 0 });
      }
    }
    dragStartRef.current = null;
  };

  // Check if triage finished
  const isFinished = currentIndex >= total;

  return (<>
    <div className={`triage-view-container orientation-${orientation}`}>
      {/* Header Toolbar */}
      <div className="triage-toolbar">
        <div className="triage-title">
          <h3>Folder: {folder.name}</h3>
          <span className="triage-counter">
            {isFinished ? 'Complete' : `${currentIndex + 1} / ${total}`}
          </span>
        </div>

        <div className="triage-toolbar-actions">
          {/* Play / Pause */}
          <button
            type="button"
            className="triage-tool-btn"
            title={isPlaying ? 'Pause autoplay' : 'Play autoplay'}
            onClick={() => setIsPlaying(p => !p)}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          {/* Speed dropdown */}
          <select
            className="triage-speed-select"
            value={animSpeed}
            onChange={e => setAnimSpeed(Number(e.target.value))}
            title="Animation speed multiplier"
          >
            <option value={0.25}>0.25×</option>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>

          <button
            type="button"
            className="triage-tool-btn"
            title="Toggle Mode"
            onClick={() => setMode(m => (m === 'view' ? 'edit' : 'view'))}
          >
            {mode === 'view' ? '✏️ Edit / Triage Mode' : '🖼️ View Mode'}
          </button>

          <button
            type="button"
            className="triage-tool-btn"
            title="Toggle Orientation"
            onClick={() => setOrientation(o => (o === 'horizontal' ? 'vertical' : 'horizontal'))}
          >
            {orientation === 'horizontal' ? '📱 Vertical Deck' : '💻 Horizontal Deck'}
          </button>

          <button type="button" className="triage-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {/* Main View Area (Both View and Edit modes use the 3D CharacterCarousel stage) */}
      {isFinished && mode === 'edit' ? (
        <div className="triage-complete-prompt">
          <h3>🎉 All images triaged!</h3>
          <p>Click below to review keep/trash selections and apply file renames.</p>
          <button
            type="button"
            className="triage-btn primary large"
            onClick={() => onFinishTriage(triageHistory)}
          >
            Review & Apply Triage ({triageHistory.length} items)
          </button>
        </div>
      ) : (
        <div
          className="triage-carousel-stage"
          style={{ position: 'relative', width: '100%', height: '100%' }}
        >
          <CharacterCarousel
            variant="filmstrip"
            items={imageFiles.map((file, idx) => ({
              id: file.path,
              src: dataUrls[file.path] || getResourcePath(file),
              name: file.name,
              role: `${idx + 1} / ${total} • ${file.extension.toUpperCase()}`,
            }))}
            sideCards={sideCards ?? 5}
            orientation={orientation}
            focusIndex={mode === 'edit' ? currentIndex : focusIndex}
            autoPlay={isPlaying}
            direction={animDirection}
            curve={animCurve}
            switchDuration={switchSec}
            holdDuration={holdSec}
            speed={animSpeed}
            scale={1.0}
            onCardDoubleClick={(_idx, src, name) => {
              setLightbox({ src, name });
              setZoom(1);
            }}
          />

          {/* Interactive Drag & Triage Overlay when in Edit Mode */}
          {mode === 'edit' && (
            <div
              className="triage-gesture-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 10,
                display: 'flex',
                flexDirection: 'column',
                justify: 'space-between',
                pointerEvents: 'auto',
                touchAction: 'none',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* Gesture Overlay Badge */}
              <div style={{ pointerEvents: 'none', position: 'absolute', inset: 0, zIndex: 12 }}>
                {orientation === 'horizontal' && dragOffset.x < -30 && (
                  <div className="triage-badge trash-badge">TRASH</div>
                )}
                {orientation === 'horizontal' && dragOffset.x > 30 && (
                  <div className="triage-badge keep-badge">KEEP</div>
                )}
                {orientation === 'vertical' && dragOffset.y < -30 && (
                  <div className="triage-badge trash-badge">TRASH</div>
                )}
                {orientation === 'vertical' && dragOffset.y > 30 && (
                  <div className="triage-badge keep-badge">KEEP</div>
                )}
              </div>

              <div style={{ flex: 1 }} />

              {/* Action buttons overlay at bottom */}
              <div
                className="triage-deck-controls-overlay"
                style={{
                  position: 'relative',
                  zIndex: 20,
                  pointerEvents: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  paddingBottom: '16px',
                }}
              >
                <div className="triage-deck-controls">
                  <button
                    type="button"
                    className="deck-btn trash"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSwipe('trash');
                    }}
                    title={orientation === 'horizontal' ? 'Swipe Left (Trash)' : 'Swipe Up (Trash)'}
                  >
                    ‹ TRASH
                  </button>

                  <button
                    type="button"
                    className="deck-btn undo"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUndo();
                    }}
                    disabled={triageHistory.length === 0}
                    title="Undo last swipe"
                  >
                    ↩ UNDO
                  </button>

                  <button
                    type="button"
                    className="deck-btn keep"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSwipe('keep');
                    }}
                    title={orientation === 'horizontal' ? 'Swipe Right (Keep)' : 'Swipe Down (Keep)'}
                  >
                    KEEP ›
                  </button>
                </div>

                {triageHistory.length > 0 && (
                  <div className="triage-finish-early">
                    <button
                      type="button"
                      className="triage-btn secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFinishTriage(triageHistory);
                      }}
                    >
                      Finish & Review Current Triage ({triageHistory.length})
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>

    {/* Fullscreen lightbox */}
    {lightbox && (
      <div
        className="carousel-lightbox-backdrop"
        onClick={() => setLightbox(null)}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.88)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div
          style={{ position: 'relative', maxWidth: '96vw', maxHeight: '92vh', overflow: 'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: 'absolute', top: 8, right: 8, zIndex: 10,
              background: 'rgba(0,0,0,0.6)', color: '#fff',
              border: 'none', borderRadius: '50%', width: 32, height: 32,
              fontSize: 16, cursor: 'pointer', lineHeight: '32px', textAlign: 'center',
            }}
          >✕</button>

          {/* Zoom controls */}
          <div style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, display: 'flex', gap: 8, alignItems: 'center',
            background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '4px 12px',
          }}>
            <button
              onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}
            >−</button>
            <span style={{ color: '#fff', fontSize: 13, minWidth: 36, textAlign: 'center' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(6, z + 0.25))}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}
            >+</button>
            <button
              onClick={() => setZoom(1)}
              style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 11, cursor: 'pointer', marginLeft: 4 }}
            >Reset</button>
          </div>

          {/* Image with scroll-to-zoom */}
          <div
            style={{ overflow: 'auto', maxWidth: '96vw', maxHeight: '92vh', cursor: zoom > 1 ? 'grab' : 'zoom-in' }}
            onWheel={e => {
              e.preventDefault();
              setZoom(z => Math.min(6, Math.max(0.25, z - e.deltaY * 0.001)));
            }}
          >
            <img
              src={lightbox.src}
              alt={lightbox.name}
              draggable={false}
              style={{
                display: 'block',
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                transition: 'transform 0.12s ease',
                maxWidth: 'none',
                userSelect: 'none',
              }}
            />
          </div>
        </div>
      </div>
    )}
  </>);
};

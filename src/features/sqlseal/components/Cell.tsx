import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import type { RefObject } from "preact";
import { Fragment } from "preact";
import { Notice } from "obsidian";
import { resolveWikiLink } from "../utils/wiki";
import { GenericTextSuggest } from "../utils/suggesters";
import { extractYouTubeVideoId, getOrDownloadYtThumbnail } from "../utils/youtubeThumbnail";

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch (err) {
    console.error("Failed to copy to clipboard:", err);
    return false;
  }
}

interface CellProps {
  value: string;
  rowIndex: number;
  colIndex: number;
  searchQueryRef: RefObject<string>;
  onUpdate: (rowIndex: number, colIndex: number, value: string) => void;
  isAutocomplete?: boolean;
  values?: string[];
  filePath?: string;
  columnName?: string;
  isEasyCopy?: boolean;
  isEditing?: boolean;
  initialEditValue?: string;
  onStartEdit?: (rowIndex: number, colIndex: number, initialValue?: string) => void;
  onStopEdit?: () => void;
  onNavigateAfterEdit?: (direction: "down" | "up" | "right" | "left") => void;
}

export function Cell({
  value,
  rowIndex,
  colIndex,
  searchQueryRef,
  onUpdate,
  isAutocomplete = false,
  values = [],
  filePath,
  columnName,
  isEasyCopy = false,
  isEditing,
  initialEditValue,
  onStartEdit,
  onStopEdit,
  onNavigateAfterEdit,
}: CellProps) {
  const [localEditing, setLocalEditing] = useState(false);
  const isEditingActive = isEditing !== undefined ? isEditing : localEditing;
  const [editValue, setEditValue] = useState(() => (initialEditValue !== undefined ? initialEditValue : value));
  const [justCopied, setJustCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestValRef = useRef(editValue);
  const committedRef = useRef(false);
  const clickCountRef = useRef<number>(0);
  const lastClickTimeRef = useRef<number>(0);

  // When edit mode is toggled or initial value changed
  useEffect(() => {
    if (isEditingActive) {
      committedRef.current = false;
      const initial = initialEditValue !== undefined ? initialEditValue : value;
      setEditValue(initial);
      latestValRef.current = initial;
      if (inputRef.current) {
        inputRef.current.focus();
        const len = (initial ?? "").length;
        inputRef.current.setSelectionRange(len, len);
      }
    } else {
      setLocalEditing(false);
      setEditValue(value);
      latestValRef.current = value;
      clickCountRef.current = 0;
    }
  }, [isEditingActive, initialEditValue, value]);

  // Focus & cursor placement at end when input renders (editable without full selection)
  useEffect(() => {
    if (isEditingActive && inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [isEditingActive]);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    const finalVal = latestValRef.current;
    if (finalVal !== value) {
      onUpdate(rowIndex, colIndex, finalVal);
    }
    setLocalEditing(false);
    onStopEdit?.();
  }, [value, rowIndex, colIndex, onUpdate, onStopEdit]);

  const cancel = useCallback(() => {
    committedRef.current = true;
    setEditValue(value);
    latestValRef.current = value;
    setLocalEditing(false);
    onStopEdit?.();
  }, [value, onStopEdit]);

  // Cleanup on unmount while editing
  useEffect(() => {
    return () => {
      if (isEditingActive && !committedRef.current) {
        commit();
      }
    };
  }, [isEditingActive, commit]);

  const suggestRef = useRef<GenericTextSuggest | null>(null);

  useEffect(() => {
    if (isEditingActive && inputRef.current && isAutocomplete) {
      const el = inputRef.current;
      const globalApp = window.app;
      if (globalApp) {
        try {
          suggestRef.current = new GenericTextSuggest(globalApp, el, values || []);
        } catch (e) {
          console.error("Error creating cell suggest:", e);
        }
      }
    }
    return () => {
      suggestRef.current = null;
    };
  }, [isEditingActive, isAutocomplete]);

  useEffect(() => {
    if (suggestRef.current) {
      suggestRef.current.setItems(values || []);
    }
  }, [values]);

  if (isEditingActive) {
    return (
      <Fragment>
        <input
          ref={inputRef}
          class="tablite-cell-input"
          value={editValue}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const now = Date.now();
            // Third click detection: if clicked shortly after double-click into edit mode (triple click sequence)
            if (clickCountRef.current === 2 && now - lastClickTimeRef.current < 750) {
              inputRef.current?.select();
              clickCountRef.current = 3;
            } else {
              clickCountRef.current = 1;
            }
            lastClickTimeRef.current = now;
          }}
          onDblClick={(e) => {
            e.stopPropagation();
            // Double click on already active input also selects the entire cell text
            inputRef.current?.select();
            clickCountRef.current = 3;
          }}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setEditValue(v);
            latestValRef.current = v;
          }}
          onBlur={() => {
            if (isAutocomplete) {
              window.setTimeout(() => {
                commit();
              }, 150);
            } else {
              commit();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              commit();
              onNavigateAfterEdit?.(e.shiftKey ? "up" : "down");
            } else if (e.key === "Tab") {
              e.preventDefault();
              e.stopPropagation();
              commit();
              onNavigateAfterEdit?.(e.shiftKey ? "left" : "right");
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
        />
      </Fragment>
    );
  }

  const sq = searchQueryRef.current ?? "";
  const isMatch = sq.length > 0 && value.toLowerCase().includes(sq.toLowerCase());

  const isImagePathColumn = columnName === "original_image_path" || columnName === "redacted_image_path";

  const handleCellClick = (e: MouseEvent) => {
    if (isAutocomplete && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      const globalApp = window.app;
      if (globalApp && value && typeof value === 'string' && value.trim()) {
        const resolvedLink = resolveWikiLink(globalApp, value.trim(), columnName || "");
        globalApp.workspace.openLinkText(resolvedLink, filePath || "", true);
      }
    } else if (isImagePathColumn && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      const globalApp = window.app;
      if (globalApp && value && typeof value === 'string' && value.trim()) {
        const paths = value.split(";").map(p => p.trim()).filter(Boolean);
        for (const p of paths) {
          const file = globalApp.vault.getFileByPath(p);
          if (file) {
            globalApp.workspace.getLeaf("tab").openFile(file);
          }
        }
      }
    } else if (isEasyCopy && !isEditingActive) {
      e.stopPropagation();
      copyTextToClipboard(value ?? "");
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 800);
      const preview = (value && value.length > 30) ? `${value.slice(0, 30)}...` : (value || "(empty)");
      new Notice(`📋 Copied: ${preview}`, 1500);
    }
  };

  const handleCellMouseOver = (e: MouseEvent) => {
    if (isAutocomplete && (e.ctrlKey || e.metaKey)) {
      const globalApp = window.app;
      if (globalApp && value && typeof value === 'string' && value.trim()) {
        const resolvedLink = resolveWikiLink(globalApp, value.trim(), columnName || "");
        if (resolvedLink) {
          globalApp.workspace.trigger("hover-link", {
            event: e,
            source: "tablite-csv-view",
            hoverParent: e.currentTarget as HTMLElement,
            targetEl: e.target as HTMLElement,
            linktext: resolvedLink,
            sourcePath: filePath || "",
          });
        }
      }
    } else if (isImagePathColumn && (e.ctrlKey || e.metaKey)) {
      const globalApp = window.app;
      if (globalApp && value && typeof value === 'string' && value.trim()) {
        const paths = value.split(";").map(p => p.trim()).filter(Boolean);
        const firstPath = paths[0];
        if (firstPath) {
          globalApp.workspace.trigger("hover-link", {
            event: e,
            source: "tablite-csv-view",
            hoverParent: e.currentTarget as HTMLElement,
            targetEl: e.target as HTMLElement,
            linktext: firstPath,
            sourcePath: filePath || "",
          });
        }
      }
    }
  };

  const ytVideoId = extractYouTubeVideoId(value);
  const [thumbSrc, setThumbSrc] = useState<string | null>(() =>
    ytVideoId ? `https://img.youtube.com/vi/${ytVideoId}/hqdefault.jpg` : null,
  );

  useEffect(() => {
    if (ytVideoId) {
      const globalApp = window.app;
      if (globalApp) {
        getOrDownloadYtThumbnail(globalApp, ytVideoId).then((cachedPath) => {
          if (cachedPath) setThumbSrc(cachedPath);
        });
      }
    }
  }, [ytVideoId]);

  if (ytVideoId) {
    return (
      <div
        class={`tablite-cell tablite-yt-cell ${isMatch ? "tablite-cell-match" : ""} ${
          isEasyCopy ? "tablite-cell-easy-copy" : ""
        } ${justCopied ? "tablite-cell-just-copied" : ""}`}
        title={isEasyCopy ? `Click to copy: ${value || "(empty)"}` : undefined}
        onDblClick={(e) => {
          e.stopPropagation();
          clickCountRef.current = 2;
          lastClickTimeRef.current = Date.now();
          if (onStartEdit) {
            onStartEdit(rowIndex, colIndex);
          } else {
            setLocalEditing(true);
          }
        }}
        onClick={(e) => {
          if (isEasyCopy && !isEditingActive && !e.ctrlKey && !e.metaKey) {
            e.stopPropagation();
            copyTextToClipboard(value ?? "");
            setJustCopied(true);
            window.setTimeout(() => setJustCopied(false), 800);
            const preview = (value && value.length > 30) ? `${value.slice(0, 30)}...` : (value || "(empty)");
            new Notice(`📋 Copied: ${preview}`, 1500);
          }
        }}
      >
        <img
          class="tablite-yt-thumb"
          src={thumbSrc || `https://img.youtube.com/vi/${ytVideoId}/hqdefault.jpg`}
          alt="YouTube Thumbnail"
          loading="lazy"
          title={`Click to open YouTube video (${ytVideoId})`}
          onClick={(e) => {
            if (!isEditingActive) {
              e.stopPropagation();
              window.open(value, "_blank");
            }
          }}
        />
        <a
          class="tablite-yt-link"
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (isEditingActive) e.preventDefault();
          }}
        >
          {value}
        </a>
      </div>
    );
  }

  return (
    <div
      class={`tablite-cell ${isMatch ? "tablite-cell-match" : ""} ${
        isAutocomplete ? "sqlseal-wikilink-cell" : ""
      } ${isImagePathColumn ? "tablite-image-path-cell" : ""} ${
        isEasyCopy ? "tablite-cell-easy-copy" : ""
      } ${justCopied ? "tablite-cell-just-copied" : ""}`}
      title={isEasyCopy ? `Click to copy: ${value || "(empty)"}` : undefined}
      onDblClick={(e) => {
        e.stopPropagation();
        clickCountRef.current = 2;
        lastClickTimeRef.current = Date.now();
        if (onStartEdit) {
          onStartEdit(rowIndex, colIndex);
        } else {
          setLocalEditing(true);
        }
      }}
      onClick={handleCellClick}
      onMouseOver={handleCellMouseOver}
    >
      {value || "\u00A0"}
    </div>
  );
}

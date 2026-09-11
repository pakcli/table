import { useState, useRef, useCallback, useEffect, useMemo } from "preact/hooks";
import type { Column } from "@tanstack/react-table";

import { ConfirmReorderModal } from "../utils/confirmModal";
import type TablitePlugin from "../../../main";
import type { CalcPreset } from "../types";
import {
  computeColumnMetrics,
  parseTextQuery,
  evaluateCalculationPresetOrFormula,
  type CalculationOutputRow,
} from "../utils/calcEngine";
import { CustomCalcModal } from "./CustomCalcModal";
import { TextQueryModal } from "./TextQueryModal";

export function getColumnLetter(colIndex: number): string {
  if (colIndex < 0) return "";
  let letter = "";
  let temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

const STANDARD_FUNCTIONS = [
  { id: "SUM", label: "SUM" },
  { id: "MID", label: "MID" },
  { id: "AVG", label: "AVG" },
  { id: "MAX", label: "MAX" },
  { id: "MIN", label: "MIN" },
  { id: "COUNT", label: "COUNT" },
];

interface HeaderCellProps {
  name: string;
  displayName: string;
  colIndex: number;
  column: Column<string[], unknown>;
  onUpdateHeader: (colIndex: number, value: string) => void;
  onResize: (colIndex: number, width: number) => void;
  onMoveColumn: (sourceIndex: number, targetIndex: number) => void;
  isEasyCopy?: boolean;
  onToggleEasyCopy?: (colIndex: number) => void;
  onSelectColumn?: (colIndex: number, isShift: boolean) => void;
  data?: string[][];
  plugin?: TablitePlugin;
  columnCalcs?: Record<string, string>;
  onColumnCalcChange?: (colIndex: number, calcType: string) => void;
  calcPresets?: CalcPreset[];
  calcPosition?: "below" | "above" | "both" | "none";
  uniqueValues?: string[];
  isOnlySorted?: boolean;
  onForceOnlySort?: () => void;
}

export function HeaderCell({
  name,
  displayName,
  colIndex,
  column,
  onUpdateHeader,
  onResize,
  onMoveColumn,
  isEasyCopy = false,
  onToggleEasyCopy,
  onSelectColumn,
  data,
  plugin,
  columnCalcs,
  onColumnCalcChange,
  calcPresets,
  calcPosition = "above",
  uniqueValues,
  isOnlySorted: propIsOnlySorted,
  onForceOnlySort,
}: HeaderCellProps) {
  const [selectOpen, setSelectOpen] = useState(false);
  const [filterSearchQuery, setFilterSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const isOnlySorted = useMemo(() => {
    if (typeof propIsOnlySorted === "boolean") return propIsOnlySorted;
    const tableInstance = (column as any).table;
    if (tableInstance) {
      const currentSorting = (tableInstance.getState()?.sorting ?? []) as Array<{ id: string; desc: boolean }>;
      return currentSorting.length === 1 && currentSorting[0]?.id === column.id;
    }
    return false;
  }, [propIsOnlySorted, column]);

  const handleForceOnlySort = useCallback(() => {
    if (onForceOnlySort) {
      onForceOnlySort();
      return;
    }
    const tableInstance = (column as any).table;
    if (tableInstance) {
      const currentSorting = (tableInstance.getState()?.sorting ?? []) as Array<{ id: string; desc: boolean }>;
      const isCurrentlyOnly = currentSorting.length === 1 && currentSorting[0]?.id === column.id;
      if (isCurrentlyOnly) {
        tableInstance.setSorting([]);
      } else {
        const desc = column.getIsSorted() === "desc";
        tableInstance.setSorting([{ id: column.id, desc }]);
      }
    } else {
      if (column.getIsSorted()) {
        column.clearSorting();
      } else {
        column.toggleSorting(false, false);
      }
    }
  }, [onForceOnlySort, column]);

  useEffect(() => {
    if (!selectOpen) return;
    const onClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setSelectOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick, true);
    return () => document.removeEventListener("mousedown", onClick, true);
  }, [selectOpen]);

  const sortDir = column.getIsSorted();
  const meta = (column.columnDef.meta as {
    dataType?: string;
    filterVariant?: "text" | "select" | "numberRange" | "dateRange";
  } | undefined) ?? { dataType: "string", filterVariant: "text" };
  const dataType = String(meta.dataType ?? "string");

  const onMouseDown = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      resizing.current = true;
      startX.current = event.clientX;
      startWidth.current = column.getSize();

      const onMouseMove = (nextEvent: MouseEvent) => {
        if (!resizing.current) return;
        const diff = nextEvent.clientX - startX.current;
        onResize(colIndex, Math.max(50, startWidth.current + diff));
      };

      const onMouseUp = () => {
        resizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [colIndex, column, onResize],
  );

  const rawFilterValue = column.getFilterValue();
  const filterValue = typeof rawFilterValue === "string" ? rawFilterValue : "";
  const selectValues = Array.isArray(rawFilterValue) ? (rawFilterValue as string[]) : [];
  const rangeValue = (typeof rawFilterValue === "object" && rawFilterValue != null && !Array.isArray(rawFilterValue)
    ? rawFilterValue
    : {}) as { min?: string; max?: string };

  const allUnique = useMemo(() => {
    if (uniqueValues && uniqueValues.length > 0) {
      return [...uniqueValues].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    }
    if (data) {
      const set = new Set<string>();
      for (let r = 0; r < data.length; r++) {
        const v = (data[r]?.[colIndex] ?? "").trim();
        if (v) set.add(v);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    }
    return [];
  }, [uniqueValues, data, colIndex]);

  const filterPillLabel = useMemo(() => {
    if (selectValues.length > 0) {
      if (selectValues.length === 1) return selectValues[0];
      return `${selectValues.length} sel`;
    }
    if (typeof rawFilterValue === "string" && rawFilterValue.trim()) {
      return rawFilterValue.trim();
    }
    if (rangeValue.min || rangeValue.max) {
      return `${rangeValue.min || "min"}-${rangeValue.max || "max"}`;
    }
    return "All";
  }, [selectValues, rawFilterValue, rangeValue]);

  const toggleSelectValue = useCallback(
    (val: string) => {
      let next: string[];
      if (selectValues.length === 0) {
        next = allUnique.filter((v) => v !== val);
      } else if (selectValues.includes(val)) {
        next = selectValues.filter((v) => v !== val);
      } else {
        next = [...selectValues, val];
      }
      if (next.length >= allUnique.length || next.length === 0) {
        column.setFilterValue(undefined);
      } else {
        column.setFilterValue(next);
      }
    },
    [allUnique, column, selectValues],
  );

  const [isDragOver, setIsDragOver] = useState(false);

  // Column calculations evaluation
  const colName = displayName || name || `Column ${colIndex + 1}`;
  const currentCalc = columnCalcs ? columnCalcs[String(colIndex)] || "" : "";

  const metrics = useMemo(() => {
    if (!data || !currentCalc) return null;
    const values: string[] = [];
    for (let r = 0; r < data.length; r++) {
      values.push(data[r]?.[colIndex] ?? "");
    }
    return computeColumnMetrics(values);
  }, [data, colIndex, currentCalc]);

  const outputRows: CalculationOutputRow[] = useMemo(() => {
    if (!currentCalc || !metrics) return [];
    return evaluateCalculationPresetOrFormula(currentCalc, metrics, calcPresets || []);
  }, [currentCalc, metrics, calcPresets]);

  const openAddPresetModal = (targetColIdx: number) => {
    if (!plugin) return;
    const globalApp = window.app;
    if (!globalApp) return;

    new CustomCalcModal(globalApp, plugin, undefined, (newPreset) => {
      onColumnCalcChange?.(targetColIdx, newPreset.name);
    }).open();
  };

  const openTextQueryModal = (targetColIdx: number, colNameStr: string) => {
    if (!plugin || !data) return;
    const globalApp = window.app;
    if (!globalApp) return;

    const values = data.map((row) => row[targetColIdx] ?? "");
    const initialQuery = currentCalc || "";

    new TextQueryModal(globalApp, values, colNameStr, initialQuery, plugin, (queryStr, isPreset, presetName) => {
      if (isPreset && presetName) {
        onColumnCalcChange?.(targetColIdx, presetName);
      } else {
        onColumnCalcChange?.(targetColIdx, queryStr);
      }
    }).open();
  };

  const letter = getColumnLetter(colIndex);

  return (
    <div
      class={`tablite-header-cell ${isDragOver ? "tablite-col-drag-over" : ""}`}
      data-col-index={colIndex}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setIsDragOver(true);
      }}
      onDragLeave={() => {
        setIsDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragOver(false);
        const sourceIndex = Number(event.dataTransfer?.getData("text/tablite-column"));
        if (!Number.isNaN(sourceIndex) && sourceIndex !== colIndex) {
          const globalApp = window.app;
          if (globalApp) {
            new ConfirmReorderModal(
              globalApp,
              "Move Column",
              `Are you sure you want to move column "${displayName}" to column position ${colIndex + 1}?`,
              () => onMoveColumn(sourceIndex, colIndex),
            ).open();
          } else {
            onMoveColumn(sourceIndex, colIndex);
          }
        }
      }}
    >
      {/* 1- row 1 (thin) = a,b,c,d dst */}
      <div
        class="tablite-header-row-1 tablite-header-row-letter"
        title={`Column ${letter} — Click to select (Shift+Click to extend)`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelectColumn?.(colIndex, e.shiftKey);
        }}
      >
        <span class="tablite-col-letter">{letter}</span>
      </div>

      {/* 2- row 2 = nama , type data. toggle clipboard */}
      <div class="tablite-header-row-2 tablite-header-row-meta">
        <span
          class="tablite-col-drag-dots tablite-drag-dots"
          draggable
          title="Drag grip to reorder column"
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(event) => {
            event.dataTransfer?.setData("text/tablite-column", String(colIndex));
            event.dataTransfer?.setData("text/plain", displayName || String(colIndex));
            event.dataTransfer.effectAllowed = "move";
          }}
        >
          ⋮⋮
        </span>
        <span
          class="tablite-header-name"
          title={`Column "${displayName}" — Click to select (Shift+Click to extend)`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectColumn?.(colIndex, e.shiftKey);
          }}
        >
          {displayName}
        </span>
        <span class="tablite-header-type" title={`Type: ${dataType}`}>
          {dataType}
        </span>
        {onToggleEasyCopy && (
          <button
            type="button"
            class={`tablite-copy-toggle ${isEasyCopy ? "is-active" : ""}`}
            title={
              isEasyCopy
                ? `Click-to-copy ACTIVE for "${displayName}". Click any cell to copy. (Click to disable)`
                : `Enable click-to-copy for "${displayName}"`
            }
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleEasyCopy(colIndex);
            }}
            aria-label="Toggle easy clipboard"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        )}
        <div class="tablite-resize-handle" onMouseDown={onMouseDown} />
      </div>

      {/* 3- row 3 = split (dropdown filter, dropdown sort, toggle sort) */}
      <div class="tablite-header-row-3 tablite-header-row-filter-sort">
        {/* 1. Dropdown filter */}
        <div ref={dropdownRef} class="tablite-filter-dropdown-wrap" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            class={`tablite-filter-pill-btn ${selectValues.length > 0 || (typeof rawFilterValue === "string" && rawFilterValue.trim()) || rangeValue.min || rangeValue.max ? "is-filtered" : ""}`}
            title={`Filter column (${filterPillLabel})`}
            onClick={() => setSelectOpen(!selectOpen)}
          >
            <span class="tablite-filter-pill-text">{filterPillLabel}</span>
          </button>
          {selectOpen && (
            <div class="tablite-filter-popup">
              <input
                class="tablite-filter-search-input"
                type="text"
                placeholder="Search values..."
                value={filterSearchQuery}
                onInput={(event) => setFilterSearchQuery((event.target as HTMLInputElement).value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (filterSearchQuery.trim()) {
                      column.setFilterValue(filterSearchQuery.trim());
                      setSelectOpen(false);
                    }
                  }
                }}
              />
              <div class="tablite-filter-popup-actions">
                <button
                  type="button"
                  class="tablite-filter-action-btn"
                  onClick={() => {
                    column.setFilterValue(undefined);
                    setFilterSearchQuery("");
                  }}
                >
                  Clear (All)
                </button>
                {filterSearchQuery.trim() && (
                  <button
                    type="button"
                    class="tablite-filter-action-btn"
                    onClick={() => {
                      column.setFilterValue(filterSearchQuery.trim());
                      setSelectOpen(false);
                    }}
                  >
                    Apply search
                  </button>
                )}
              </div>

              {(dataType === "number" || dataType === "date") && (
                <div class="tablite-filter-popup-range" onClick={(event) => event.stopPropagation()}>
                  <input
                    class="tablite-filter-range-input"
                    type={dataType === "number" ? "number" : "text"}
                    placeholder="Min"
                    value={rangeValue.min ?? ""}
                    onInput={(event) => {
                      column.setFilterValue({
                        min: (event.target as HTMLInputElement).value || undefined,
                        max: rangeValue.max || undefined,
                      });
                    }}
                  />
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>-</span>
                  <input
                    class="tablite-filter-range-input"
                    type={dataType === "number" ? "number" : "text"}
                    placeholder="Max"
                    value={rangeValue.max ?? ""}
                    onInput={(event) => {
                      column.setFilterValue({
                        min: rangeValue.min || undefined,
                        max: (event.target as HTMLInputElement).value || undefined,
                      });
                    }}
                  />
                </div>
              )}

              <div class="tablite-filter-item-list">
                {allUnique
                  .filter((val) => !filterSearchQuery.trim() || val.toLowerCase().includes(filterSearchQuery.toLowerCase()))
                  .map((val) => (
                    <label key={val} class="tablite-multiselect-item">
                      <input
                        type="checkbox"
                        checked={selectValues.length === 0 || selectValues.includes(val)}
                        onChange={() => toggleSelectValue(val)}
                      />
                      <span>{val}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* 2. Cycle toggle (existing) */}
        <div class="tablite-sort-toggle-group" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            class={`tablite-sort-circle-btn ${sortDir ? "is-active" : ""}`}
            title={
              sortDir === "asc"
                ? "Sorted Ascending (A-Z). Click to sort Descending"
                : sortDir === "desc"
                  ? "Sorted Descending (Z-A). Click to clear sort"
                  : "Cycle sort column (click for Ascending)"
            }
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!sortDir) {
                column.toggleSorting(false, true);
              } else if (sortDir === "asc") {
                column.toggleSorting(true, true);
              } else {
                column.clearSorting();
              }
            }}
          >
            {sortDir === "asc" ? "▲" : sortDir === "desc" ? "▼" : "⇅"}
          </button>
        </div>

        {/* 3. Force this as the ONLY sort column checkbox toggle */}
        <div class="tablite-sort-force-wrap" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            role="checkbox"
            aria-checked={isOnlySorted}
            class={`tablite-sort-force-btn ${isOnlySorted ? "is-active" : ""}`}
            title={
              isOnlySorted
                ? `Force sort is ON for "${displayName}" (ONLY this column sorted). Click to clear sort`
                : `Force "${displayName}" as the ONLY sort column (clears other column sorts)`
            }
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleForceOnlySort();
            }}
          >
            {isOnlySorted ? (
              <span class="tablite-sort-check-icon">✓</span>
            ) : (
              <span class="tablite-sort-check-placeholder" />
            )}
          </button>
        </div>
      </div>

      {/* 4- row 4 = calc dropdown */}
      {calcPosition !== "none" && onColumnCalcChange && (
        <div class="tablite-header-row-4 tablite-header-row-calc" onClick={(e) => e.stopPropagation()}>
          <select
            class="tablite-calc-select"
            value={currentCalc}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val === "__action_add_preset") {
                openAddPresetModal(colIndex);
                (e.target as HTMLSelectElement).value = currentCalc;
              } else if (val === "__action_text_query") {
                openTextQueryModal(colIndex, colName);
                (e.target as HTMLSelectElement).value = currentCalc;
              } else {
                onColumnCalcChange(colIndex, val);
              }
            }}
          >
            <option value="">∑ (None)</option>
            <optgroup label="Standard">
              {STANDARD_FUNCTIONS.map((fn) => (
                <option key={fn.id} value={fn.id}>
                  {fn.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Text Query">
              <option value="__action_text_query">🔍 Text Query...</option>
              {currentCalc && (parseTextQuery(currentCalc) || currentCalc.includes("\n") || currentCalc.includes(";")) && (
                <option value={currentCalc}>
                  {currentCalc.replace(/[\r\n]+/g, " | ").slice(0, 22)}..
                </option>
              )}
            </optgroup>
            {calcPresets && calcPresets.length > 0 && (
              <optgroup label="Presets">
                {calcPresets.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="__action_add_preset">➕ + Add Preset...</option>
          </select>

          {currentCalc && outputRows.length > 0 && (
            <div class="tablite-calc-badge-group">
              {outputRows.map((row, rIdx) => (
                <div
                  key={rIdx}
                  class={`tablite-calc-badge ${row.isError ? "tablite-calc-badge-error" : ""}`}
                  title={`${row.label ? `${row.label}: ` : ""}${row.display}`}
                >
                  {row.isTextQuery ? (
                    <span class="tablite-calc-badge-val">{row.display}</span>
                  ) : (
                    <>
                      {row.label && <span class="tablite-calc-badge-prefix">{row.label}:</span>}
                      <span class="tablite-calc-badge-val">{row.display}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

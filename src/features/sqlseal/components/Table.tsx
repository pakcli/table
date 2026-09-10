import { useMemo, useRef, useCallback, useState, useEffect } from "preact/hooks";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type FilterFn,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Cell } from "./Cell";
import { HeaderCell } from "./HeaderCell";
import { parseAutocompleteSettings, resolveHeaderName } from "../utils/views";
import { ConfirmReorderModal } from "../utils/confirmModal";
import { serializeCSV } from "../parser/csv-engine";
import { downloadAllYtThumbnails } from "../utils/youtubeThumbnail";
import { Notice } from "obsidian";
import { CalculationRow } from "./CalculationRow";
import type { CalcPreset } from "../types";
import type TablitePlugin from "../../../main";

interface ActiveCell {
  row: number;
  col: number;
}

interface SelectionRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

interface TableProps {
  headers: string[];
  data: string[][];
  searchQuery: string;
  crossHighlight: boolean;
  activeCell: ActiveCell | null;
  selection: SelectionRange | null;
  columnOrder: number[];
  hiddenColumns: number[];
  columnSizing: Record<string, number>;
  frozenCount: number;
  sortedRowIndicesRef?: { current: number[] | null };
  onActiveCellChange: (cell: ActiveCell | null) => void;
  onSelectionChange: (selection: SelectionRange | null) => void;
  onCopy: () => void;
  onPaste?: () => void;
  onColumnOrderChange: (sourceIndex: number, targetIndex: number) => void;
  onColumnSizingChange: (sizing: Record<string, number>) => void;
  onUpdateCell: (rowIndex: number, colIndex: number, value: string) => void;
  onUpdateHeader: (colIndex: number, value: string) => void;
  onInsertRow: (afterIndex: number) => void;
  onDeleteRow: (index: number) => void;
  onMoveRow?: (sourceIndex: number, targetIndex: number) => void;
  onMoveRows?: (sourceIndices: number[], targetIndex: number) => void;
  onDeleteRows?: (indices: number[]) => void;
  onInsertColumn: (afterIndex: number) => void;
  onDeleteColumn: (index: number) => void;
  autocompleteColumns?: string;
  filePath?: string;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  onSortingChange: (updater: unknown) => void;
  onColumnFiltersChange: (updater: unknown) => void;
  plugin?: TablitePlugin;
  calcPosition?: "below" | "above" | "both" | "none";
  calcFreeze?: boolean;
  columnCalcs?: Record<string, string>;
  calcPresets?: CalcPreset[];
  onColumnCalcChange?: (colIndex: number, calcType: string) => void;
  textWrap?: boolean;
  editingCell?: { row: number; col: number; initialValue?: string } | null;
  onStartEdit?: (rowIndex: number, colIndex: number, initialValue?: string) => void;
  onStopEdit?: () => void;
  onNavigateAfterEdit?: (direction: "down" | "up" | "right" | "left") => void;
  hiddenRows?: Set<number>;
  onToggleRowVisibility?: (rowIndex: number) => void;
  onToggleColumnVisibility?: (colIndex: number) => void;
  onShowAllVisibility?: () => void;
}

interface RangeFilterValue {
  min?: string;
  max?: string;
}

/** Max rows to sample for column type / filter variant inference */
const TYPE_SAMPLE_SIZE = 100;

/** Infer column type by sampling first N rows directly — avoids extracting the full column array */
function inferColumnType(data: string[][], colIndex: number): "number" | "date" | "string" {
  const sampleSize = Math.min(data.length, TYPE_SAMPLE_SIZE);
  const nonEmpty: string[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const v = (data[i]?.[colIndex] ?? "").trim();
    if (v) nonEmpty.push(v);
  }
  if (nonEmpty.length === 0) return "string";

  const numberCount = nonEmpty.filter((value) => {
    if (Number.isNaN(Number(value))) return false;
    // Exclude long pure-digit strings (e.g. phone numbers, IDs) — cap at 10 digits
    const stripped = value.replace(/[-+.,\s]/g, "");
    if (/^\d+$/.test(stripped) && stripped.length > 10) return false;
    return true;
  }).length;
  if (numberCount / nonEmpty.length >= 0.9) return "number";

  const dateCount = nonEmpty.filter((value) => !Number.isNaN(Date.parse(value))).length;
  if (dateCount / nonEmpty.length >= 0.9) return "date";

  return "string";
}

/** Determine filter UI variant by sampling first N rows directly */
function getFilterVariant(data: string[][], colIndex: number, dataType: "number" | "date" | "string"): "text" | "select" | "numberRange" | "dateRange" {
  if (dataType === "number") return "numberRange";
  if (dataType === "date") return "dateRange";

  const sampleSize = Math.min(data.length, TYPE_SAMPLE_SIZE);
  const normalized: string[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const v = (data[i]?.[colIndex] ?? "").trim();
    if (v.length > 0) normalized.push(v);
  }

  if (normalized.length === 0) return "text";

  // If items look like URLs, paths, or long sentences, default to text search filter
  const hasLongOrUrl = normalized.some((v) => v.length > 25 || v.startsWith("http://") || v.startsWith("https://"));
  if (hasLongOrUrl) return "text";

  const uniqueCount = new Set(normalized).size;
  if (uniqueCount >= 2 && uniqueCount <= 8) {
    return "select";
  }

  return "text";
}

const textFilter: FilterFn<string[]> = (row, columnId, filterValue) => {
  const query = String(filterValue ?? "").trim().toLowerCase();
  if (!query) return true;
  const value = String(row.getValue(columnId) ?? "").toLowerCase();
  return value.includes(query);
};

const selectFilter: FilterFn<string[]> = (row, columnId, filterValue) => {
  const selected = filterValue as string[] | undefined;
  if (!selected || selected.length === 0) return true;
  const value = String(row.getValue(columnId) ?? "").trim();
  return selected.includes(value);
};

const numberRangeFilter: FilterFn<string[]> = (row, columnId, filterValue) => {
  const range = (filterValue as RangeFilterValue | undefined) ?? {};
  if (!range.min && !range.max) return true;

  const raw = String(row.getValue(columnId) ?? "").trim();
  if (!raw) return false;

  const value = Number(raw);
  if (Number.isNaN(value)) return false;

  const min = range.min != null && range.min !== "" ? Number(range.min) : undefined;
  const max = range.max != null && range.max !== "" ? Number(range.max) : undefined;

  if (min != null && Number.isNaN(min)) return true;
  if (max != null && Number.isNaN(max)) return true;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
};

const dateRangeFilter: FilterFn<string[]> = (row, columnId, filterValue) => {
  const range = (filterValue as RangeFilterValue | undefined) ?? {};
  if (!range.min && !range.max) return true;

  const raw = String(row.getValue(columnId) ?? "").trim();
  if (!raw) return false;

  const value = Date.parse(raw);
  if (Number.isNaN(value)) return false;

  const min = range.min ? Date.parse(range.min) : undefined;
  const max = range.max ? Date.parse(range.max) : undefined;

  if (min != null && Number.isNaN(min)) return true;
  if (max != null && Number.isNaN(max)) return true;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
};

const universalFilter: FilterFn<string[]> = (row, columnId, filterValue) => {
  if (filterValue === undefined || filterValue === null || filterValue === "") return true;
  const raw = String(row.getValue(columnId) ?? "").trim();

  // Array of values (multiselect)
  if (Array.isArray(filterValue)) {
    if (filterValue.length === 0) return true;
    return filterValue.includes(raw);
  }

  // Range { min, max }
  if (typeof filterValue === "object") {
    const range = filterValue as RangeFilterValue;
    if (!range.min && !range.max) return true;
    if (!raw) return false;
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      const min = range.min != null && range.min !== "" ? Number(range.min) : undefined;
      const max = range.max != null && range.max !== "" ? Number(range.max) : undefined;
      if (min != null && !Number.isNaN(min) && num < min) return false;
      if (max != null && !Number.isNaN(max) && num > max) return false;
      return true;
    }
    const dt = Date.parse(raw);
    if (!Number.isNaN(dt)) {
      const min = range.min ? Date.parse(range.min) : undefined;
      const max = range.max ? Date.parse(range.max) : undefined;
      if (min && !Number.isNaN(min) && dt < min) return false;
      if (max && !Number.isNaN(max) && dt > max) return false;
      return true;
    }
    return true;
  }

  // Text search
  const query = String(filterValue).trim().toLowerCase();
  if (!query) return true;
  return raw.toLowerCase().includes(query);
};

export function Table({
  headers,
  data,
  searchQuery,
  crossHighlight,
  activeCell,
  selection,
  columnOrder,
  hiddenColumns,
  columnSizing,
  frozenCount,
  onActiveCellChange,
  onSelectionChange,
  onCopy,
  onPaste,
  onColumnOrderChange,
  onColumnSizingChange,
  onUpdateCell,
  onUpdateHeader,
  onInsertRow,
  onDeleteRow,
  onMoveRow,
  onMoveRows,
  onDeleteRows,
  onInsertColumn,
  onDeleteColumn,
  sortedRowIndicesRef,
  autocompleteColumns,
  filePath,
  sorting,
  columnFilters,
  onSortingChange,
  onColumnFiltersChange,
  plugin,
  calcPosition = "above",
  calcFreeze = true,
  columnCalcs = {},
  calcPresets = [],
  onColumnCalcChange,
  textWrap = false,
  editingCell,
  onStartEdit,
  onStopEdit,
  onNavigateAfterEdit,
  hiddenRows,
  onToggleRowVisibility,
  onToggleColumnVisibility,
  onShowAllVisibility,
}: TableProps) {
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const lastSelectedRowRef = useRef<number | null>(null);
  const [dragOverRow, setDragOverRow] = useState<number | null>(null);
  const [easyCopyCols, setEasyCopyCols] = useState<Set<number>>(new Set());

  const handleToggleEasyCopy = useCallback((colIndex: number) => {
    setEasyCopyCols((prev) => {
      const next = new Set(prev);
      const colName = resolveHeaderName(headers[colIndex] || `Column ${colIndex + 1}`, autocompleteColumns || "");
      if (next.has(colIndex)) {
        next.delete(colIndex);
        new Notice(`Click-to-copy disabled for "${colName}"`);
      } else {
        next.add(colIndex);
        new Notice(`📋 Click-to-copy ENABLED for "${colName}". Click any cell to copy!`);
      }
      return next;
    });
  }, [headers, autocompleteColumns]);

  const handleColumnSelect = useCallback(
    (colIndex: number, isShift: boolean) => {
      if (colIndex < 0) return;
      const maxRow = Math.max(0, data.length - 1);
      if (isShift && (selection || activeCell)) {
        const startCol = selection ? selection.startCol : (activeCell?.col ?? colIndex);
        onSelectionChange({
          startRow: 0,
          startCol: startCol,
          endRow: maxRow,
          endCol: colIndex,
        });
      } else {
        onActiveCellChange({ row: 0, col: colIndex });
        onSelectionChange({
          startRow: 0,
          startCol: colIndex,
          endRow: maxRow,
          endCol: colIndex,
        });
      }
    },
    [data.length, selection, activeCell, onSelectionChange, onActiveCellChange],
  );

  const autocompleteCols = useMemo(() => {
    const setting = autocompleteColumns || "";
    const { columns } = parseAutocompleteSettings(setting);
    return columns;
  }, [autocompleteColumns]);

  const uniqueValues = useMemo(() => {
    const colValuesMap: Record<number, string[]> = {};
    headers.forEach((_, colIndex) => {
      colValuesMap[colIndex] = Array.from(
        new Set(data.map((row) => row[colIndex]).filter((v) => v !== undefined && v !== null && v !== "")),
      );
    });
    return colValuesMap;
  }, [data, headers]);

  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  const onUpdateCellRef = useRef(onUpdateCell);
  onUpdateCellRef.current = onUpdateCell;

  const onUpdateHeaderRef = useRef(onUpdateHeader);
  onUpdateHeaderRef.current = onUpdateHeader;

  const visibleColumnOrder = useMemo(() => {
    const orderSet = new Set(columnOrder);
    const completeOrder = [
      ...columnOrder.filter((idx) => idx < headers.length),
      ...headers.map((_, idx) => idx).filter((idx) => !orderSet.has(idx)),
    ];
    return completeOrder.filter((index) => !hiddenColumns.includes(index));
  }, [columnOrder, headers, hiddenColumns]);

  const columnTypes = useMemo(
    () => Object.fromEntries(headers.map((_, index) => [index, inferColumnType(data, index)])),
    [data, headers],
  );

  const columnFilterVariants = useMemo(
    () =>
      Object.fromEntries(
        headers.map((_, index) => [index, getFilterVariant(data, index, columnTypes[index])]),
      ),
    [columnTypes, data, headers],
  );

  const columns = useMemo<ColumnDef<string[], string>[]>(
    () => [
      {
        id: "__select",
        enableSorting: false,
        enableColumnFilter: false,
        size: 34,
        minSize: 34,
        header: () => {
          const allSelected = data.length > 0 && selectedRows.size === data.length;
          return (
            <div class="tablite-header-cell tablite-select-header-cell" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <div
                class="tablite-header-row-1 tablite-header-row-letter"
                style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
                title="Select / Deselect All Rows"
              >
                <input
                  type="checkbox"
                  class="tablite-row-checkbox"
                  checked={allSelected}
                  indeterminate={selectedRows.size > 0 && selectedRows.size < data.length}
                  onChange={(e) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    if (checked) {
                      setSelectedRows(new Set(data.map((_, i) => i)));
                    } else {
                      setSelectedRows(new Set());
                    }
                  }}
                />
              </div>
              <div class="tablite-header-row-2 tablite-header-row-meta" />
              <div class="tablite-header-row-3 tablite-header-row-filter-sort" />
              {calcPosition !== "none" && (
                <div class="tablite-header-row-4 tablite-header-row-calc" />
              )}
            </div>
          );
        },
        cell: ({ row }) => (
          <div class="tablite-row-select-cell" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              class="tablite-row-checkbox"
              checked={selectedRows.has(row.index)}
              onClick={(e) => {
                e.stopPropagation();
                const mouseEvent = e as unknown as MouseEvent;
                const isShift = mouseEvent.shiftKey;
                const targetIndex = row.index;

                setSelectedRows((prev) => {
                  const next = new Set(prev);
                  if (isShift && lastSelectedRowRef.current !== null) {
                    const start = Math.min(lastSelectedRowRef.current, targetIndex);
                    const end = Math.max(lastSelectedRowRef.current, targetIndex);
                    for (let i = start; i <= end; i++) {
                      next.add(i);
                    }
                  } else {
                    if (next.has(targetIndex)) {
                      next.delete(targetIndex);
                    } else {
                      next.add(targetIndex);
                    }
                  }
                  return next;
                });
                lastSelectedRowRef.current = targetIndex;
              }}
            />
          </div>
        ),
      },
      {
        id: "__row_num",
        accessorFn: (_, index) => index,
        enableSorting: true,
        enableColumnFilter: false,
        sortingFn: (rowA, rowB) => rowA.index - rowB.index,
        header: ({ column }) => {
          const sortDir = column.getIsSorted();
          return (
            <div class="tablite-header-cell tablite-row-num-header-cell" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <div
                class="tablite-header-row-1 tablite-header-row-letter tablite-row-num-letter"
                title="Click to select all cells"
                onClick={() => {
                  onActiveCellChange({ row: 0, col: 0 });
                  onSelectionChange({
                    startRow: 0,
                    startCol: 0,
                    endRow: Math.max(0, data.length - 1),
                    endCol: Math.max(0, headers.length - 1),
                  });
                }}
              >
                #
              </div>
              <div class="tablite-header-row-2 tablite-header-row-meta" style={{ justifyContent: "center" }}>
                <span class="tablite-header-name" style={{ textAlign: "center", width: "100%", fontSize: "11px" }}>
                  Row
                </span>
              </div>
              <div class="tablite-header-row-3 tablite-header-row-filter-sort" style={{ justifyContent: "center", gap: "3px" }}>
                <div class="tablite-sort-toggle-group">
                  <button
                    type="button"
                    class={`tablite-sort-circle-btn ${sortDir ? "is-active" : ""}`}
                    title={
                      sortDir === "asc"
                        ? "Sorted Ascending. Click for Descending"
                        : sortDir === "desc"
                          ? "Sorted Descending. Click to clear sort"
                          : "Sort row numbers (click for Ascending)"
                    }
                    onClick={() => {
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
                <div class="tablite-sort-force-wrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={sorting.length === 1 && sorting[0]?.id === "__row_num"}
                    class={`tablite-sort-force-btn ${sorting.length === 1 && sorting[0]?.id === "__row_num" ? "is-active" : ""}`}
                    title={
                      sorting.length === 1 && sorting[0]?.id === "__row_num"
                        ? "Row number is the ONLY sort column. Click to clear"
                        : "Force row number as the ONLY sort column"
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (sorting.length === 1 && sorting[0]?.id === "__row_num") {
                        onSortingChange([]);
                      } else {
                        const existing = sorting.find((s) => s.id === "__row_num");
                        const desc = existing ? existing.desc : false;
                        onSortingChange([{ id: "__row_num", desc }]);
                      }
                    }}
                  >
                    <span class="tablite-sort-radio-inner" />
                  </button>
                </div>
              </div>
              {calcPosition !== "none" && (
                <div class="tablite-header-row-4 tablite-header-row-calc" style={{ alignItems: "center", justifyContent: "center" }}>
                  <span class="tablite-calc-label" title="Column Calculations">∑ Calc</span>
                </div>
              )}
            </div>
          );
        },
        size: 50,
        minSize: 45,
        cell: ({ row }) => {
          const isSelected = selectedRows.has(row.index);
          return (
            <div
              class="tablite-row-num tablite-row-num-drag"
              data-row-index={row.index}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "3px", width: "100%", height: "100%", userSelect: "none", cursor: "pointer" }}
              title="Click to select row, Shift+Click to extend, or drag to multi-select"
              onMouseDown={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest(".tablite-drag-dots")) return;
                handleCellMouseDown(e as unknown as MouseEvent, row.index, -1);
              }}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest(".tablite-drag-dots")) return;
                const mouseEvent = e as unknown as MouseEvent;
                if (mouseEvent.shiftKey && (selection || activeCell)) {
                  const startRow = selection ? selection.startRow : (activeCell?.row ?? row.index);
                  onSelectionChange({
                    startRow: startRow,
                    startCol: 0,
                    endRow: row.index,
                    endCol: headers.length - 1,
                  });
                } else {
                  onActiveCellChange({ row: row.index, col: 0 });
                  onSelectionChange({
                    startRow: row.index,
                    startCol: 0,
                    endRow: row.index,
                    endCol: headers.length - 1,
                  });
                }
              }}
            >
              <span
                class="tablite-drag-dots"
                draggable
                title="Drag grip to reorder row"
                style={{ cursor: "grab" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                onDragStart={(e) => {
                  const indicesToDrag =
                    isSelected && selectedRows.size > 1
                      ? Array.from(selectedRows).sort((a, b) => a - b)
                      : [row.index];
                  e.dataTransfer?.setData("text/tablite-rows", JSON.stringify(indicesToDrag));
                  e.dataTransfer?.setData("text/tablite-row", String(row.index));
                  e.dataTransfer?.setData("text/plain", `[Row ${row.index + 1}]`);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverRow(row.index);
                }}
                onDragLeave={() => {
                  setDragOverRow(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverRow(null);
                  let sourceIndices: number[] = [];
                  const rowsJson = e.dataTransfer?.getData("text/tablite-rows");
                  if (rowsJson) {
                    try {
                      sourceIndices = JSON.parse(rowsJson);
                    } catch {}
                  }
                  if (sourceIndices.length === 0) {
                    const single = Number(e.dataTransfer?.getData("text/tablite-row"));
                    if (!Number.isNaN(single)) sourceIndices = [single];
                  }

                  if (sourceIndices.length > 0) {
                    if (sourceIndices.length === 1 && sourceIndices[0] === row.index) return;
                    const count = sourceIndices.length;
                    const targetPos = row.index + 1;
                    const msg =
                      count === 1
                        ? `Are you sure you want to move Row #${sourceIndices[0] + 1} to position #${targetPos}?`
                        : `Are you sure you want to move ${count} selected rows to position #${targetPos}?`;

                    const globalApp = window.app;
                    const executeMove = () => {
                      if (onMoveRows) {
                        onMoveRows(sourceIndices, row.index);
                      } else if (onMoveRow && sourceIndices.length === 1) {
                        onMoveRow(sourceIndices[0], row.index);
                      }
                    };

                    if (globalApp) {
                      new ConfirmReorderModal(
                        globalApp,
                        count === 1 ? "Move Row" : "Move Selected Rows",
                        msg,
                        executeMove,
                      ).open();
                    } else {
                      executeMove();
                    }
                  }
                }}
              >
                ⋮⋮
              </span>
              <span style={{ cursor: "pointer" }}>{row.index + 1}</span>
            </div>
          );
        },
      },
      ...visibleColumnOrder.map(
        (sourceIndex): ColumnDef<string[], string> => ({
          id: `col_${sourceIndex}`,
          accessorFn: (row) => row[sourceIndex] ?? "",
          size: columnSizing[String(sourceIndex)] ?? 150,
          minSize: 50,
          filterFn: universalFilter,
          sortingFn: (rowA, rowB, columnId) => {
            const a = String(rowA.getValue(columnId) ?? "").trim();
            const b = String(rowB.getValue(columnId) ?? "").trim();
            const type = columnTypes[sourceIndex];
            let diff = 0;
            if (type === "number") {
              const numA = Number(a);
              const numB = Number(b);
              if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
                diff = numA - numB;
              } else {
                diff = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
              }
            } else if (type === "date") {
              const dateA = Date.parse(a);
              const dateB = Date.parse(b);
              if (!Number.isNaN(dateA) && !Number.isNaN(dateB)) {
                diff = dateA - dateB;
              } else {
                diff = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
              }
            } else {
              diff = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
            }

            // Stable priority: Fall back to original row index (Column 1 / # priority)
            if (diff === 0) {
              return rowA.index - rowB.index;
            }
            return diff;
          },
          meta: {
            sourceIndex,
            dataType: columnTypes[sourceIndex],
            filterVariant: columnFilterVariants[sourceIndex],
          },
          header: ({ column }) => {
            const colId = `col_${sourceIndex}`;
            const isOnlySorted = sorting.length === 1 && sorting[0].id === colId;
            return (
              <HeaderCell
                name={headers[sourceIndex]}
                displayName={resolveHeaderName(headers[sourceIndex], autocompleteColumns || "")}
                colIndex={sourceIndex}
                column={column}
                onUpdateHeader={(colIndex, value) => onUpdateHeaderRef.current(colIndex, value)}
                onResize={(colIndex, width) => {
                  onColumnSizingChange({
                    ...columnSizing,
                    [String(colIndex)]: width,
                  });
                }}
                onMoveColumn={onColumnOrderChange}
                isEasyCopy={easyCopyCols.has(sourceIndex)}
                onToggleEasyCopy={handleToggleEasyCopy}
                onSelectColumn={handleColumnSelect}
                data={data}
                plugin={plugin}
                columnCalcs={columnCalcs}
                onColumnCalcChange={onColumnCalcChange}
                calcPresets={calcPresets}
                calcPosition={calcPosition}
                uniqueValues={uniqueValues[sourceIndex] || []}
                isOnlySorted={isOnlySorted}
                onForceOnlySort={() => {
                  if (sorting.length === 1 && sorting[0].id === colId) {
                    onSortingChange([]);
                  } else {
                    const existing = sorting.find((s) => s.id === colId);
                    const desc = existing ? existing.desc : false;
                    onSortingChange([{ id: colId, desc }]);
                  }
                }}
              />
            );
          },
          cell: ({ row }) => {
            const isAutocomplete = autocompleteCols.includes(headers[sourceIndex].toLowerCase());
            const isEditing = editingCell?.row === row.index && editingCell?.col === sourceIndex;
            return (
              <Cell
                value={row.original[sourceIndex] ?? ""}
                rowIndex={row.index}
                colIndex={sourceIndex}
                searchQueryRef={searchQueryRef}
                onUpdate={(rowIndex, colIndex, value) => onUpdateCellRef.current(rowIndex, colIndex, value)}
                isAutocomplete={isAutocomplete}
                values={uniqueValues[sourceIndex]}
                filePath={filePath}
                columnName={headers[sourceIndex]}
                isEasyCopy={easyCopyCols.has(sourceIndex)}
                isEditing={isEditing}
                initialEditValue={isEditing ? editingCell?.initialValue : undefined}
                onStartEdit={onStartEdit}
                onStopEdit={onStopEdit}
                onNavigateAfterEdit={onNavigateAfterEdit}
              />
            );
          },
        }),
      ),
    ],
    [
      visibleColumnOrder,
      columnSizing,
      headers,
      columnFilterVariants,
      columnTypes,
      onColumnOrderChange,
      onColumnSizingChange,
      autocompleteCols,
      uniqueValues,
      data,
      selectedRows,
      onMoveRow,
      onMoveRows,
      onActiveCellChange,
      onSelectionChange,
      easyCopyCols,
      handleToggleEasyCopy,
      handleColumnSelect,
      editingCell,
      onStartEdit,
      onStopEdit,
      onNavigateAfterEdit,
      plugin,
      columnCalcs,
      onColumnCalcChange,
      calcPresets,
      calcPosition,
    ],
  );

  const [, forceUpdate] = useState(0);
  useEffect(() => {
    forceUpdate((value) => value + 1);
  }, [searchQuery]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: onSortingChange,
    onColumnFiltersChange: onColumnFiltersChange,
    enableMultiSort: true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();

  // Build original-index → display-position map for activeCell/selection lookups
  const originalToDisplay = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i < rows.length; i++) {
      map.set(rows[i].index, i);
    }
    return map;
  }, [rows]);

  // Expose sorted row indices (original data index in display order) to parent
  if (sortedRowIndicesRef) {
    sortedRowIndicesRef.current = rows.map((r) => r.index);
  }

  const totalWidth = table.getHeaderGroups()[0]?.headers.reduce(
    (sum, header) => sum + header.getSize(),
    0,
  ) ?? 0;

  const frozenOffsets = useMemo(() => {
    let offset = 0;
    const offsets: Record<string, number> = {};
    const headerGroup = table.getHeaderGroups()[0];
    for (const header of headerGroup?.headers ?? []) {
      offsets[header.column.id] = offset;
      offset += header.getSize();
    }
    return offsets;
  }, [table, totalWidth]);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<ActiveCell | null>(null);

  const isCellSelected = useCallback(
    (row: number, col: number) => {
      if (!selection) return false;
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      const minCol = Math.min(selection.startCol, selection.endCol);
      const maxCol = Math.max(selection.startCol, selection.endCol);
      return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
    },
    [selection],
  );

  const handleColumnMouseDown = useCallback(
    (event: MouseEvent, colIndex: number) => {
      if (event.button !== 0 || colIndex < 0) return;
      const maxRow = Math.max(0, data.length - 1);

      if (event.shiftKey && (selection || activeCell)) {
        const startCol = selection ? selection.startCol : (activeCell?.col ?? colIndex);
        onSelectionChange({
          startRow: 0,
          startCol: startCol,
          endRow: maxRow,
          endCol: colIndex,
        });
        return;
      }

      isDraggingRef.current = true;
      dragStartRef.current = { row: -1, col: colIndex };
      onActiveCellChange({ row: 0, col: colIndex });
      onSelectionChange({
        startRow: 0,
        startCol: colIndex,
        endRow: maxRow,
        endCol: colIndex,
      });
    },
    [data.length, selection, activeCell, onSelectionChange, onActiveCellChange],
  );

  const handleCellMouseDown = useCallback(
    (event: MouseEvent, rowIndex: number, colIndex: number) => {
      if (event.button !== 0) return; // left click only

      if (colIndex < 0) {
        if (event.shiftKey && (selection || activeCell)) {
          const startRow = selection ? selection.startRow : (activeCell?.row ?? rowIndex);
          onSelectionChange({
            startRow: startRow,
            startCol: 0,
            endRow: rowIndex,
            endCol: headers.length - 1,
          });
          return;
        }
        // Row selection mode (clicked on row number column)
        isDraggingRef.current = true;
        dragStartRef.current = { row: rowIndex, col: -1 };
        onActiveCellChange({ row: rowIndex, col: 0 });
        onSelectionChange({
          startRow: rowIndex,
          startCol: 0,
          endRow: rowIndex,
          endCol: headers.length - 1,
        });
        return;
      }

      if (event.shiftKey && activeCell) {
        // Shift+click: extend selection from activeCell
        onSelectionChange({
          startRow: activeCell.row,
          startCol: activeCell.col,
          endRow: rowIndex,
          endCol: colIndex,
        });
        return;
      }

      // Start drag
      isDraggingRef.current = true;
      dragStartRef.current = { row: rowIndex, col: colIndex };
      onActiveCellChange({ row: rowIndex, col: colIndex });
      onSelectionChange(null);
    },
    [activeCell, selection, headers.length, onActiveCellChange, onSelectionChange],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) return;
      const container = tableContainerRef.current;
      if (!container) return;

      window.getSelection()?.removeAllRanges();

      // Find cell under cursor
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      if (!target) return;

      const start = dragStartRef.current;
      if (start.col === -1) {
        // Row drag selection mode
        const td = target.closest<HTMLElement>("[data-row-index]");
        if (td) {
          const rowIndex = Number(td.dataset.rowIndex);
          if (!Number.isNaN(rowIndex)) {
            onSelectionChange({
              startRow: start.row,
              startCol: 0,
              endRow: rowIndex,
              endCol: headers.length - 1,
            });
          }
        }
      } else if (start.row === -1) {
        // Column drag selection mode
        const colEl = target.closest<HTMLElement>("[data-col-index]");
        if (colEl) {
          const colAttr = colEl.getAttribute("data-col-index");
          const targetCol = colAttr !== null && colAttr !== "" ? Number(colAttr) : -1;
          if (targetCol >= 0) {
            onSelectionChange({
              startRow: 0,
              startCol: start.col,
              endRow: Math.max(0, data.length - 1),
              endCol: targetCol,
            });
          }
        }
      } else {
        // Normal cell drag selection mode
        const td = target.closest<HTMLElement>("[data-row-index]");
        if (!td) return;
        const rowIndex = Number(td.dataset.rowIndex);
        const colIndexAttr = td.getAttribute("data-col-index");
        const colIndex = colIndexAttr !== null && colIndexAttr !== "" ? Number(colIndexAttr) : -1;
        if (Number.isNaN(rowIndex)) return;
        const targetCol = colIndex >= 0 ? colIndex : 0;
        if (rowIndex !== start.row || targetCol !== start.col) {
          onSelectionChange({
            startRow: start.row,
            startCol: start.col,
            endRow: rowIndex,
            endCol: targetCol,
          });
        }
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onSelectionChange, headers.length, data.length]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 32,
    overscan: 20,
  });

  // Re-measure virtual rows when text wrapping is toggled or column sizes change
  useEffect(() => {
    rowVirtualizer.measure();
  }, [textWrap, columnSizing, rowVirtualizer]);

  useEffect(() => {
    if (!activeCell) return;
    // activeCell.row is an original data index; convert to display position for virtualizer
    const displayIndex = originalToDisplay.get(activeCell.row);
    if (displayIndex == null) return;
    rowVirtualizer.scrollToIndex(displayIndex, { align: "auto" });

    const frame = window.requestAnimationFrame(() => {
      const container = tableContainerRef.current;
      if (!container) return;

      const cell = container.querySelector<HTMLElement>(
        `[data-row-index="${activeCell.row}"][data-col-index="${activeCell.col}"]`,
      );
      cell?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeCell, rowVirtualizer, originalToDisplay]);

  const onContextMenu = useCallback(
    (event: MouseEvent, rowIndex: number, colIndex: number) => {
      event.preventDefault();
      const menu = createDiv({ cls: "tablite-context-menu" });
      const menuItems: Array<{ action: string; label: string } | "hr"> = [
        { action: "copy", label: "Copy" },
        { action: "paste", label: "Paste" },
        "hr",
        { action: "insert-row-above", label: "Insert Row Above" },
        { action: "insert-row-below", label: "Insert Row Below" },
        { action: "delete-row", label: "Delete Row" },
        "hr",
        { action: "insert-col-left", label: "Insert Column Left" },
        { action: "insert-col-right", label: "Insert Column Right" },
        { action: "delete-col", label: "Delete Column" },
      ];
      for (const item of menuItems) {
        if (item === "hr") {
          menu.createEl("hr");
        } else {
          const div = menu.createDiv({ cls: "tablite-menu-item", text: item.label });
          div.dataset.action = item.action;
        }
      }
      menu.setCssProps({ "--tablite-menu-left": `${event.clientX}px`, "--tablite-menu-top": `${event.clientY}px` });

      const handleClick = (ev: Event) => {
        const target = ev.target as HTMLElement;
        switch (target.dataset.action) {
          case "copy":
            onCopy();
            break;
          case "paste":
            onPaste?.();
            break;
          case "insert-row-above":
            onInsertRow(rowIndex - 1);
            break;
          case "insert-row-below":
            onInsertRow(rowIndex);
            break;
          case "delete-row":
            onDeleteRow(rowIndex);
            break;
          case "insert-col-left":
            onInsertColumn(colIndex - 1);
            break;
          case "insert-col-right":
            onInsertColumn(colIndex);
            break;
          case "delete-col":
            onDeleteColumn(colIndex);
            break;
        }
        menu.remove();
      };

      menu.addEventListener("click", handleClick);
      document.body.appendChild(menu);

      const removeMenu = () => {
        menu.remove();
        document.removeEventListener("click", removeMenu);
      };
      window.requestAnimationFrame(() => {
        document.addEventListener("click", removeMenu);
      });
    },
    [onCopy, onPaste, onDeleteColumn, onDeleteRow, onInsertColumn, onInsertRow],
  );

  const getPinnedStyles = useCallback(
    (cellId: string, position: number, isHeader: boolean) => {
      const isPinned = position < frozenCount || cellId === "__select" || cellId === "__row_num";
      if (!isPinned) return {};
      return {
        position: "sticky",
        left: `${frozenOffsets[cellId] ?? 0}px`,
        zIndex: isHeader ? 5 : 3,
      } as const;
    },
    [frozenCount, frozenOffsets],
  );

  return (
    <div
      ref={tableContainerRef}
      class={`tablite-table-container ${textWrap ? "tablite-wrap-text" : ""}`}
      tabIndex={-1}
      style={{ outline: "none" }}
    >
      <table class="tablite-table" style={{ display: "grid" }}>
        <thead
          style={{
            display: "grid",
            position: "sticky",
            top: 0,
            zIndex: 4,
          }}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} style={{ display: "flex", width: `${totalWidth}px`, minWidth: "100%" }}>
              {headerGroup.headers.map((header, position) => {
                const isSpecialCol = header.column.id === "__select" || header.column.id === "__row_num";
                const colIdx = isSpecialCol ? -1 : Number(header.column.id.replace("col_", ""));
                const isColHL = crossHighlight && activeCell != null && colIdx === activeCell.col;
                const isColSelected = !isSpecialCol && (selection
                  ? (colIdx >= Math.min(selection.startCol, selection.endCol) && colIdx <= Math.max(selection.startCol, selection.endCol))
                  : (activeCell?.col === colIdx));

                let thClass = "tablite-th";
                if (header.column.id === "__select") thClass += " tablite-th-select";
                if (header.column.id === "__row_num") thClass += " tablite-th-row-num";
                if (isColHL) thClass += " tablite-col-highlight";
                if (position < frozenCount + 2) thClass += " tablite-frozen-cell";
                if (isColSelected) thClass += " tablite-col-selected";

                return (
                  <th
                    key={header.id}
                    data-col-index={colIdx >= 0 ? colIdx : undefined}
                    class={thClass}
                    style={{
                      display: "flex",
                      width: header.getSize(),
                      minWidth: header.column.columnDef.minSize,
                      flexShrink: 0,
                      ...getPinnedStyles(header.column.id, position, true),
                    }}
                    onMouseDown={(event) => {
                      const target = event.target as HTMLElement;
                      if (
                        !isSpecialCol &&
                        !target.closest("input, select, .tablite-multiselect, .tablite-copy-toggle, .tablite-resize-handle, .tablite-col-drag-dots")
                      ) {
                        handleColumnMouseDown(event as unknown as MouseEvent, colIdx);
                      }
                    }}
                    onClick={(event) => {
                      const target = event.target as HTMLElement;
                      if (
                        !isSpecialCol &&
                        !target.closest("input, select, .tablite-multiselect, .tablite-copy-toggle, .tablite-resize-handle, .tablite-col-drag-dots")
                      ) {
                        handleColumnSelect(colIdx, event.shiftKey);
                      }
                    }}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody
          style={{
            display: "grid",
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const isHiddenRow = hiddenRows?.has(row.index) ?? false;
            const isRowRangeSelected = selection != null &&
              selection.startCol === 0 &&
              selection.endCol >= headers.length - 1 &&
              row.index >= Math.min(selection.startRow, selection.endRow) &&
              row.index <= Math.max(selection.startRow, selection.endRow);
            const isChecked = selectedRows.has(row.index) || isRowRangeSelected;
            const isDragTarget = dragOverRow === row.index;
            let trClass = "tablite-tr";
            if (isChecked) trClass += " tablite-tr-checked";
            if (isDragTarget) trClass += " tablite-tr-drag-over";
            if (isHiddenRow) trClass += " tablite-tr-hidden";

            if (isHiddenRow) {
              return (
                <tr
                  key={row.id}
                  data-index={virtualRow.index}
                  data-row-index={row.index}
                  class={trClass}
                  ref={(element) => {
                    if (element) rowVirtualizer.measureElement(element);
                  }}
                  style={{
                    display: "flex",
                    position: "absolute",
                    transform: `translateY(${virtualRow.start}px)`,
                    width: `${totalWidth}px`,
                    minWidth: "100%",
                    height: 0,
                    overflow: "hidden",
                    visibility: "hidden",
                    pointerEvents: "none",
                    minHeight: 0,
                    padding: 0,
                    border: "none",
                  }}
                />
              );
            }

            return (
              <tr
                key={row.id}
                data-index={virtualRow.index}
                data-row-index={row.index}
                class={trClass}
                ref={(element) => {
                  if (element) rowVirtualizer.measureElement(element);
                }}
                style={{
                  display: "flex",
                  position: "absolute",
                  transform: `translateY(${virtualRow.start}px)`,
                  width: `${totalWidth}px`,
                  minWidth: "100%",
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverRow(row.index);
                }}
                onDragLeave={() => {
                  setDragOverRow((current) => (current === row.index ? null : current));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverRow(null);
                  let sourceIndices: number[] = [];
                  const rowsJson = e.dataTransfer?.getData("text/tablite-rows");
                  if (rowsJson) {
                    try {
                      sourceIndices = JSON.parse(rowsJson);
                    } catch {}
                  }
                  if (sourceIndices.length === 0) {
                    const single = Number(e.dataTransfer?.getData("text/tablite-row"));
                    if (!Number.isNaN(single)) sourceIndices = [single];
                  }

                  if (sourceIndices.length > 0) {
                    if (sourceIndices.length === 1 && sourceIndices[0] === row.index) return;
                    const count = sourceIndices.length;
                    const targetPos = row.index + 1;
                    const msg =
                      count === 1
                        ? `Are you sure you want to move Row #${sourceIndices[0] + 1} to position #${targetPos}?`
                        : `Are you sure you want to move ${count} selected rows to position #${targetPos}?`;

                    const globalApp = window.app;
                    const executeMove = () => {
                      if (onMoveRows) {
                        onMoveRows(sourceIndices, row.index);
                      } else if (onMoveRow && sourceIndices.length === 1) {
                        onMoveRow(sourceIndices[0], row.index);
                      }
                    };

                    if (globalApp) {
                      new ConfirmReorderModal(
                        globalApp,
                        count === 1 ? "Move Row" : "Move Selected Rows",
                        msg,
                        executeMove,
                      ).open();
                    } else {
                      executeMove();
                    }
                  }
                }}
              >
                {row.getVisibleCells().map((cell, position) => {
                   const isSelect = cell.column.id === "__select";
                   const isRowNum = cell.column.id === "__row_num";
                   const colIdx = isSelect || isRowNum ? -1 : Number(cell.column.id.replace("col_", ""));
                   const isActive = !isSelect && !isRowNum && activeCell?.row === row.index && activeCell?.col === colIdx;
                   const isSelected = !isSelect && !isRowNum && !isActive && isCellSelected(row.index, colIdx);
                   const isRowHL = crossHighlight && !isSelect && !isRowNum && activeCell != null && activeCell.row === row.index;
                   const isColHL = crossHighlight && !isSelect && !isRowNum && activeCell != null && activeCell.col === colIdx;
 
                   const isRowSelected = selection
                     ? (row.index >= Math.min(selection.startRow, selection.endRow) && row.index <= Math.max(selection.startRow, selection.endRow))
                     : (activeCell?.row === row.index);
 
                   const isEditing = !isSelect && !isRowNum && editingCell?.row === row.index && editingCell?.col === colIdx;

                   let className = "tablite-td";
                   if (isSelect) {
                     className += " tablite-td-select";
                   } else if (isRowNum) {
                     if (isRowSelected) className += " tablite-row-num-selected";
                   } else {
                     if (isEditing) className += " tablite-td-editing";
                     else if (isActive && !selection) className += " tablite-td-active";
                     else if (isActive || isSelected) className += " tablite-td-selected";
                     else if (isRowHL || isColHL) className += " tablite-td-cross";
                   }
                   if (position < frozenCount + 2) className += " tablite-frozen-cell";

                  return (
                    <td
                      key={cell.id}
                      data-row-index={row.index}
                      data-col-index={colIdx >= 0 ? colIdx : undefined}
                      class={className}
                      style={{
                        display: "flex",
                        width: cell.column.getSize(),
                        minWidth: cell.column.columnDef.minSize,
                        flexShrink: 0,
                        userSelect: isEditing ? "text" : "none",
                        ...getPinnedStyles(cell.column.id, position, false),
                      }}
                      onMouseDown={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.closest("input, textarea, select")) {
                          return;
                        }
                        tableContainerRef.current?.focus();
                        if (!isSelect) {
                          handleCellMouseDown(event as unknown as MouseEvent, row.index, isRowNum ? -1 : colIdx);
                        }
                      }}
                      onDblClick={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.closest("input, textarea, select")) {
                          return;
                        }
                        if (!isSelect && !isRowNum && colIdx >= 0) {
                          onStartEdit?.(row.index, colIdx);
                        }
                      }}
                      onContextMenu={(event) => onContextMenu(event as unknown as MouseEvent, row.index, colIdx)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {(calcPosition === "below" || calcPosition === "both") && table.getHeaderGroups()[0] && (
          <tfoot
            class="tablite-tfoot"
            style={{
              display: "grid",
              position: (calcFreeze ? "sticky" : "relative"),
              bottom: 0,
              zIndex: 4,
            }}
          >
            <CalculationRow
              headers={table.getHeaderGroups()[0].headers}
              data={data}
              plugin={plugin}
              columnCalcs={columnCalcs}
              onColumnCalcChange={onColumnCalcChange || (() => {})}
              calcPresets={calcPresets}
              frozenCount={frozenCount}
              frozenOffsets={frozenOffsets}
              totalWidth={totalWidth}
              position="below"
              calcFreeze={calcFreeze}
            />
          </tfoot>
        )}
      </table>
      {(selectedRows.size > 0 || (onShowAllVisibility && hiddenRows && hiddenRows.size > 0)) && (
        <div class="tablite-floating-actions">
          {/* Show All — always visible at top when anything is hidden */}
          {onShowAllVisibility && hiddenRows && hiddenRows.size > 0 && (
            <button
              type="button"
              class="tablite-fa-btn tablite-fa-show-all"
              title={`Show all ${hiddenRows.size} hidden row(s)`}
              onClick={onShowAllVisibility}
            >
              👁 Show All ({hiddenRows.size})
            </button>
          )}

          {selectedRows.size > 0 && (
            <>
              <div class="tablite-fa-info">
                <span class="tablite-fa-badge">{selectedRows.size}</span>
                <span>row{selectedRows.size === 1 ? "" : "s"} selected</span>
              </div>
              <button
                type="button"
                class="tablite-fa-btn"
                title="Copy selected rows as CSV to clipboard"
                onClick={() => {
                  const selectedIndices = Array.from(selectedRows).sort((a, b) => a - b);
                  const selectedData = selectedIndices.map((i) => data[i]);
                  const csv = serializeCSV(headers, selectedData, ",", false);
                  navigator.clipboard?.writeText(csv);
                  new Notice(`✓ Copied ${selectedIndices.length} rows to clipboard!`);
                }}
              >
                📋 Copy CSV
              </button>
              <button
                type="button"
                class="tablite-fa-btn"
                title="Cache YouTube thumbnails for selected rows"
                onClick={() => {
                  const selectedIndices = Array.from(selectedRows);
                  const selectedData = selectedIndices.map((i) => data[i]);
                  const globalApp = window.app;
                  if (globalApp) {
                    downloadAllYtThumbnails(globalApp, selectedData);
                  }
                }}
              >
                🎬 Cache YT
              </button>
              {/* Hide / Show selected rows */}
              {onToggleRowVisibility && (() => {
                const selectedArr = Array.from(selectedRows);
                const allHidden = selectedArr.length > 0 && selectedArr.every((i) => hiddenRows?.has(i));
                return (
                  <button
                    type="button"
                    class={`tablite-fa-btn ${allHidden ? "tablite-fa-show" : ""}`}
                    title={allHidden ? "Show selected rows" : "Hide selected rows"}
                    onClick={() => {
                      selectedArr.forEach((i) => onToggleRowVisibility(i));
                    }}
                  >
                    {allHidden ? "👁 Show Rows" : "🚫 Hide Rows"}
                  </button>
                );
              })()}
              <button
                type="button"
                class="tablite-fa-btn tablite-fa-danger"
                title="Delete selected rows"
                onClick={() => {
                  const globalApp = window.app;
                  const count = selectedRows.size;
                  const doDelete = () => {
                    if (onDeleteRows) onDeleteRows(Array.from(selectedRows));
                    setSelectedRows(new Set());
                    new Notice(`Deleted ${count} rows.`);
                  };

                  if (globalApp) {
                    new ConfirmReorderModal(
                      globalApp,
                      "Delete Selected Rows",
                      `Are you sure you want to delete ${count} selected row${count === 1 ? "" : "s"}? You can undo this with Ctrl+Z.`,
                      doDelete,
                    ).open();
                  } else {
                    doDelete();
                  }
                }}
              >
                🗑️ Delete ({selectedRows.size})
              </button>
              <button
                type="button"
                class="tablite-fa-close"
                title="Clear selection"
                onClick={() => setSelectedRows(new Set())}
              >
                ✕
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}


import { useMemo } from "preact/hooks";
import type { Header } from "@tanstack/react-table";
import type TablitePlugin from "../../../main";
import type { CalcPreset } from "../types";
import {
  computeColumnMetrics,
  evaluateFormula,
  formatCalculationResult,
  parseTextQuery,
  executeTextQuery,
  evaluateCalculationPresetOrFormula,
  type CalculationOutputRow,
} from "../utils/calcEngine";
import { CustomCalcModal } from "./CustomCalcModal";
import { TextQueryModal } from "./TextQueryModal";

interface CalculationRowProps {
  headers: Header<string[], unknown>[];
  data: string[][];
  plugin?: TablitePlugin;
  columnCalcs: Record<string, string>;
  onColumnCalcChange: (colIndex: number, calcType: string) => void;
  calcPresets: CalcPreset[];
  frozenCount: number;
  frozenOffsets: Record<string, number>;
  totalWidth: number;
  position: "above" | "below";
  calcFreeze: boolean;
}

const STANDARD_FUNCTIONS = [
  { id: "SUM", label: "SUM" },
  { id: "MID", label: "MID" },
  { id: "AVG", label: "AVG" },
  { id: "MAX", label: "MAX" },
  { id: "MIN", label: "MIN" },
  { id: "COUNT", label: "COUNT" },
];

export function CalculationRow({
  headers,
  data,
  plugin,
  columnCalcs,
  onColumnCalcChange,
  calcPresets,
  frozenCount,
  frozenOffsets,
  totalWidth,
  position,
  calcFreeze,
}: CalculationRowProps) {
  // Precompute metrics for all columns sampled/extracted from data
  const colMetricsMap = useMemo(() => {
    const metrics: Record<number, ReturnType<typeof computeColumnMetrics>> = {};
    for (const header of headers) {
      const isSpecial = header.column.id === "__select" || header.column.id === "__row_num";
      if (isSpecial) continue;
      const colIdx = Number(header.column.id.replace("col_", ""));
      if (Number.isNaN(colIdx)) continue;

      const values: string[] = [];
      for (let r = 0; r < data.length; r++) {
        values.push(data[r]?.[colIdx] ?? "");
      }
      metrics[colIdx] = computeColumnMetrics(values);
    }
    return metrics;
  }, [headers, data]);

  const getPinnedStyle = (cellId: string, colPos: number) => {
    const isPinned = colPos < frozenCount || cellId === "__select" || cellId === "__row_num";
    if (!isPinned) return {};
    return {
      position: "sticky" as const,
      left: `${frozenOffsets[cellId] ?? 0}px`,
      zIndex: 6,
    };
  };

  const rowStyle = {
    display: "flex",
    width: `${totalWidth}px`,
    minWidth: "100%",
  };

  const isSticky = calcFreeze;
  const containerStyle = {
    display: "grid",
    position: (isSticky ? "sticky" : "relative"),
    ...(position === "above" ? { top: "36px", zIndex: 4 } : { bottom: 0, zIndex: 4 }),
  };

  const openAddPresetModal = (targetColIdx: number) => {
    if (!plugin) return;
    const globalApp = window.app;
    if (!globalApp) return;

    new CustomCalcModal(
      globalApp,
      plugin,
      undefined,
      (newPreset) => {
        onColumnCalcChange(targetColIdx, newPreset.name);
      }
    ).open();
  };

  const openTextQueryModal = (targetColIdx: number, colName: string) => {
    const globalApp = window.app;
    if (!globalApp) return;

    const values = data.map((row) => row[targetColIdx] ?? "");
    const initialQuery = columnCalcs[String(targetColIdx)] || "";

    new TextQueryModal(
      globalApp,
      values,
      colName,
      initialQuery,
      plugin,
      (queryStr, isPreset, presetName) => {
        if (isPreset && presetName) {
          onColumnCalcChange(targetColIdx, presetName);
        } else {
          onColumnCalcChange(targetColIdx, queryStr);
        }
      }
    ).open();
  };

  return (
    <tr
      class={`tablite-tr tablite-calc-row tablite-calc-row-${position} ${isSticky ? "tablite-calc-frozen" : ""}`}
      style={rowStyle}
    >
      {headers.map((header, colPos) => {
        const isSpecialCol = header.column.id === "__select" || header.column.id === "__row_num";
        const colIdx = isSpecialCol ? -1 : Number(header.column.id.replace("col_", ""));
        const currentCalc = !isSpecialCol ? (columnCalcs[String(colIdx)] || "") : "";

        const pinned = getPinnedStyle(header.column.id, colPos);
        let cellClass = "tablite-th tablite-calc-cell";
        if (header.column.id === "__select") cellClass += " tablite-th-select";
        if (header.column.id === "__row_num") cellClass += " tablite-th-row-num";
        if (colPos < frozenCount + 2) cellClass += " tablite-frozen-cell";

        const widthStyle = {
          display: "flex",
          flexDirection: "column" as const,
          justifyContent: "center",
          width: header.getSize(),
          minWidth: header.column.columnDef.minSize,
          flexShrink: 0,
          boxSizing: "border-box" as const,
          ...pinned,
        };

        if (isSpecialCol) {
          return (
            <th key={header.id} class={cellClass} style={widthStyle}>
              {header.column.id === "__row_num" && (
                <span class="tablite-calc-label" title="Column Calculations">
                  ∑ Calc
                </span>
              )}
            </th>
          );
        }

        // Calculate results for active function/preset/text query (supports multiple output rows)
        const metrics = colMetricsMap[colIdx];
        const outputRows: CalculationOutputRow[] =
          currentCalc && metrics
            ? evaluateCalculationPresetOrFormula(currentCalc, metrics, calcPresets)
            : [];

        const colName = String(header.column.columnDef.header || `Column ${colIdx + 1}`);

        return (
          <th key={header.id} class={cellClass} style={widthStyle}>
            <div class="tablite-calc-container">
              <select
                class="tablite-calc-select"
                value={currentCalc}
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  if (val === "__action_add_preset") {
                    openAddPresetModal(colIdx);
                    (e.target as HTMLSelectElement).value = currentCalc;
                  } else if (val === "__action_text_query") {
                    openTextQueryModal(colIdx, colName);
                    (e.target as HTMLSelectElement).value = currentCalc;
                  } else {
                    onColumnCalcChange(colIdx, val);
                  }
                }}
              >
                <option value="">(None)</option>
                <optgroup label="Standard">
                  {STANDARD_FUNCTIONS.map((fn) => (
                    <option key={fn.id} value={fn.id}>
                      {fn.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Text Query (Word / Regex / Match)">
                  <option value="__action_text_query">🔍 Text Query (Word / Regex / Match)...</option>
                  {currentCalc && (parseTextQuery(currentCalc) || currentCalc.includes("\n") || currentCalc.includes(";")) && (
                    <option value={currentCalc}>
                      {currentCalc.replace(/[\r\n]+/g, " | ").length > 32
                        ? currentCalc.replace(/[\r\n]+/g, " | ").slice(0, 30) + ".."
                        : currentCalc.replace(/[\r\n]+/g, " | ")}
                    </option>
                  )}
                </optgroup>
                {calcPresets.length > 0 && (
                  <optgroup label="Presets">
                    {calcPresets.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="__action_add_preset">➕ + Add Calc Preset...</option>
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
          </th>
        );
      })}
    </tr>
  );
}

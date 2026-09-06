let prepareSimpleSearchFn: ((query: string) => (text: string) => unknown) | null = null;
try {
   
  const obs = require("obsidian");
  if (obs && typeof obs.prepareSimpleSearch === "function") {
    prepareSimpleSearchFn = obs.prepareSimpleSearch;
  }
} catch {
  // Running outside Obsidian environment (e.g. unit tests)
}

export interface ColumnMetrics {
  sum: number;
  mid: number;
  avg: number;
  max: number;
  min: number;
  count: number;
  numCount: number;
  rawValues: string[];
}

/**
 * Clean a string cell value into a numeric value, if possible.
 * Handles currency symbols ($ € £ Rp ¥), percentages, thousand commas, and whitespace.
 */
export function parseNumericValue(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const raw = String(value).trim();
  if (!raw) return null;

  // Check if it's already a clean number
  const directNum = Number(raw);
  if (!Number.isNaN(directNum) && Number.isFinite(directNum)) {
    return directNum;
  }

  // Remove common currency symbols, prefixes, and thousand separators
  // e.g., "$ 1,234.50", "Rp 50.000", "12.5%"
  let cleaned = raw
    .replace(/[$€£¥₹\s]/g, "")
    .replace(/^Rp\.?/i, "")
    .replace(/^IDR\.?/i, "")
    .replace(/%$/, "");

  // Handle thousand commas vs decimal dots
  // If format like "1,234.56", remove commas
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    // European format like "1.234,56"
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // General cleanup of commas
    cleaned = cleaned.replace(/,/g, "");
  }

  const num = Number(cleaned);
  return !Number.isNaN(num) && Number.isFinite(num) ? num : null;
}

/**
 * Compute aggregate metrics (SUM, MID, AVG, MAX, MIN, COUNT) for an array of row values in a column.
 */
export function computeColumnMetrics(values: (string | number | null | undefined)[]): ColumnMetrics {
  const numbers: number[] = [];
  const rawValues: string[] = [];
  let nonEmptyCount = 0;

  for (const val of values) {
    const s = val !== null && val !== undefined ? String(val) : "";
    rawValues.push(s);
    const str = s.trim();
    if (str.length > 0) {
      nonEmptyCount++;
    }
    const num = parseNumericValue(val);
    if (num !== null) {
      numbers.push(num);
    }
  }

  const numCount = numbers.length;
  const count = nonEmptyCount;

  if (numCount === 0) {
    return {
      sum: 0,
      mid: 0,
      avg: 0,
      max: 0,
      min: 0,
      count,
      numCount: 0,
      rawValues,
    };
  }

  const sum = numbers.reduce((acc, curr) => acc + curr, 0);
  const avg = sum / numCount;

  // For min & max
  let min = numbers[0];
  let max = numbers[0];
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] < min) min = numbers[i];
    if (numbers[i] > max) max = numbers[i];
  }

  // Median (MID)
  const sorted = [...numbers].sort((a, b) => a - b);
  const midIdx = Math.floor(sorted.length / 2);
  const mid =
    sorted.length % 2 !== 0
      ? sorted[midIdx]
      : (sorted[midIdx - 1] + sorted[midIdx]) / 2;

  return {
    sum,
    mid,
    avg,
    max,
    min,
    count,
    numCount,
    rawValues,
  };
}

/**
 * Safe arithmetic expression evaluator using recursive descent parser.
 * Supports: +, -, *, /, %, ^, unary minus/plus, parentheses, and numbers.
 */
export class ExpressionEvaluator {
  private pos = 0;
  private expr = "";

  constructor(expression: string) {
    this.expr = expression.replace(/\s+/g, "");
    this.pos = 0;
  }

  public evaluate(): number {
    this.pos = 0;
    const result = this.parseExpression();
    if (this.pos < this.expr.length) {
      throw new Error(`Unexpected character '${this.expr[this.pos]}' at position ${this.pos}`);
    }
    return result;
  }

  private parseExpression(): number {
    let result = this.parseTerm();
    while (this.pos < this.expr.length) {
      const char = this.expr[this.pos];
      if (char === "+") {
        this.pos++;
        result += this.parseTerm();
      } else if (char === "-") {
        this.pos++;
        result -= this.parseTerm();
      } else {
        break;
      }
    }
    return result;
  }

  private parseTerm(): number {
    let result = this.parsePower();
    while (this.pos < this.expr.length) {
      const char = this.expr[this.pos];
      if (char === "*") {
        this.pos++;
        result *= this.parsePower();
      } else if (char === "/") {
        this.pos++;
        const divisor = this.parsePower();
        if (divisor === 0) {
          throw new Error("Division by zero");
        }
        result /= divisor;
      } else if (char === "%") {
        this.pos++;
        const divisor = this.parsePower();
        result = result % divisor;
      } else {
        break;
      }
    }
    return result;
  }

  private parsePower(): number {
    let base = this.parseFactor();
    if (this.pos < this.expr.length && this.expr[this.pos] === "^") {
      this.pos++;
      const exponent = this.parsePower(); // Right-associative
      base = Math.pow(base, exponent);
    }
    return base;
  }

  private parseFactor(): number {
    if (this.pos >= this.expr.length) {
      throw new Error("Unexpected end of expression");
    }

    // Unary plus or minus
    if (this.expr[this.pos] === "+") {
      this.pos++;
      return this.parseFactor();
    }
    if (this.expr[this.pos] === "-") {
      this.pos++;
      return -this.parseFactor();
    }

    // Parenthesized expression
    if (this.expr[this.pos] === "(") {
      this.pos++;
      const val = this.parseExpression();
      if (this.pos >= this.expr.length || this.expr[this.pos] !== ")") {
        throw new Error("Missing closing parenthesis");
      }
      this.pos++;
      return val;
    }

    // Parse number (integer or decimal, optional scientific notation)
    const start = this.pos;
    while (
      this.pos < this.expr.length &&
      ((this.expr[this.pos] >= "0" && this.expr[this.pos] <= "9") ||
        this.expr[this.pos] === "." ||
        this.expr[this.pos] === "e" ||
        this.expr[this.pos] === "E")
    ) {
      this.pos++;
    }

    if (start === this.pos) {
      throw new Error(`Unexpected token at '${this.expr.substring(this.pos, this.pos + 5)}'`);
    }

    const numStr = this.expr.substring(start, this.pos);
    const num = Number(numStr);
    if (Number.isNaN(num)) {
      throw new Error(`Invalid number '${numStr}'`);
    }

    return num;
  }
}

export type TextQueryMode = "word" | "regex" | "match" | "contains";

export interface TextQueryParseResult {
  mode: TextQueryMode;
  term: string;
}

export interface TextQueryResult {
  mode: TextQueryMode;
  term: string;
  foundCount: number;
  display: string; // e.g. "laptop found: 4"
}

/**
 * Parse a text query string such as:
 * - "count - word - laptop" or "cunt - word - laptop"
 * - "count - regex - ^lap"
 * - "count - match - laptop"
 * - "word: laptop"
 * - "regex: /laptop/i"
 * - "match: laptop"
 * - COUNT_WORD("laptop")
 */
export function parseTextQuery(query: string): TextQueryParseResult | null {
  if (!query || typeof query !== "string") return null;
  const trimmed = query.trim();

  // Pattern 1: "count - word - laptop" or "cunt - word - laptop"
  const dashMatch = trimmed.match(/^(?:count|cunt)\s*-\s*(word|regex|match|contains)\s*-\s*(.+)$/i);
  if (dashMatch && dashMatch[1] && dashMatch[2]) {
    return {
      mode: dashMatch[1].toLowerCase() as TextQueryMode,
      term: dashMatch[2].trim(),
    };
  }

  // Pattern 2: "word: laptop", "regex: /pattern/", "match: laptop"
  const colonMatch = trimmed.match(/^(word|regex|match|contains)\s*:\s*(.+)$/i);
  if (colonMatch && colonMatch[1] && colonMatch[2]) {
    return {
      mode: colonMatch[1].toLowerCase() as TextQueryMode,
      term: colonMatch[2].trim(),
    };
  }

  // Pattern 3: COUNT_WORD("laptop"), COUNT_REGEX("pattern"), COUNT_MATCH("laptop")
  const funcMatch = trimmed.match(/^COUNT_(WORD|REGEX|MATCH|CONTAINS)\(["']?([^"']+)["']?\)$/i);
  if (funcMatch && funcMatch[1] && funcMatch[2]) {
    return {
      mode: funcMatch[1].toLowerCase() as TextQueryMode,
      term: funcMatch[2].trim(),
    };
  }

  return null;
}

/**
 * Execute a parsed text query against a list of cell string values.
 * Uses Obsidian's official `prepareSimpleSearch` API for exact phrase/simple token matching.
 */
export function executeTextQuery(
  parsed: TextQueryParseResult,
  values: (string | number | null | undefined)[]
): TextQueryResult {
  const { mode, term } = parsed;
  let foundCount = 0;

  if (mode === "word") {
    // Exact whole word matching (case-insensitive)
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordRegex = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "iu");
    for (const val of values) {
      if (val === null || val === undefined) continue;
      const str = String(val);
      if (wordRegex.test(str)) {
        foundCount++;
      }
    }
  } else if (mode === "regex") {
    // Regex pattern matching
    let regex: RegExp;
    try {
      if (term.startsWith("/") && term.lastIndexOf("/") > 0) {
        const lastSlash = term.lastIndexOf("/");
        const pattern = term.substring(1, lastSlash);
        const flags = term.substring(lastSlash + 1) || "i";
        regex = new RegExp(pattern, flags);
      } else {
        regex = new RegExp(term, "i");
      }
    } catch {
      regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }

    for (const val of values) {
      if (val === null || val === undefined) continue;
      const str = String(val);
      if (regex.test(str)) {
        foundCount++;
      }
    }
  } else {
    // "match" or "contains" using Obsidian Base API `prepareSimpleSearch`
    let searchFn: ((text: string) => unknown) | null = null;
    if (prepareSimpleSearchFn) {
      searchFn = prepareSimpleSearchFn(term) as ((text: string) => unknown);
    }

    if (searchFn) {
      for (const val of values) {
        if (val === null || val === undefined) continue;
        const str = String(val);
        if (searchFn(str)) {
          foundCount++;
        }
      }
    } else {
      // Fallback substring matching
      const lowerTerm = term.toLowerCase();
      for (const val of values) {
        if (val === null || val === undefined) continue;
        const str = String(val).toLowerCase();
        if (str.includes(lowerTerm)) {
          foundCount++;
        }
      }
    }
  }

  return {
    mode,
    term,
    foundCount,
    display: `${term} found: ${foundCount}`,
  };
}

/**
 * Evaluate a formula string (e.g. "SUM * 1.1", "MAX - MIN", or text query like "count - word - laptop")
 * using computed column metrics.
 */
export function evaluateFormula(formula: string, metrics: ColumnMetrics): number {
  if (!formula || !formula.trim()) return 0;

  // If the entire formula is a text query (e.g. "count - word - laptop")
  const textQuery = parseTextQuery(formula);
  if (textQuery) {
    const res = executeTextQuery(textQuery, metrics.rawValues || []);
    return res.foundCount;
  }

  // Replace any embedded text query functions: COUNT_WORD("laptop"), COUNT_MATCH("..."), COUNT_REGEX("...")
  let replaced = formula.replace(
    /COUNT_(WORD|REGEX|MATCH|CONTAINS)\(["']?([^"']+)["']?\)/gi,
    (_, mode, term) => {
      const q = { mode: mode.toLowerCase() as TextQueryMode, term };
      const res = executeTextQuery(q, metrics.rawValues || []);
      return String(res.foundCount);
    }
  );

  // Replace standard metric tokens
  // Word boundaries or token matching: SUM, MID, AVG, MAX, MIN, COUNT
  replaced = replaced
    .replace(/\bSUM\b/gi, String(metrics.sum))
    .replace(/\bMID\b/gi, String(metrics.mid))
    .replace(/\bAVG\b/gi, String(metrics.avg))
    .replace(/\bMAX\b/gi, String(metrics.max))
    .replace(/\bMIN\b/gi, String(metrics.min))
    .replace(/\bCOUNT\b/gi, String(metrics.count));

  const evaluator = new ExpressionEvaluator(replaced);
  return evaluator.evaluate();
}

/**
 * Format a calculation result nicely for display.
 * E.g., numbers with clean decimal precision or integers, with locale grouping.
 */
export function formatCalculationResult(
  calcType: string,
  result: number,
  decimals: number = 2
): string {
  if (!Number.isFinite(result)) return "NaN";

  if (calcType.toUpperCase() === "COUNT") {
    return result.toLocaleString();
  }

  // If number is an integer
  if (Math.abs(result - Math.round(result)) < 1e-9) {
    return result.toLocaleString();
  }

  // Format with specified decimals
  return Number(result.toFixed(decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Output row for calculations (supports multiple rows per cell/preset)
 */
export interface CalculationOutputRow {
  label?: string;
  display: string;
  isError?: boolean;
  isTextQuery?: boolean;
  value?: number;
}

export interface PresetItemLike {
  id: string;
  name: string;
  formula: string;
  description?: string;
}

/**
 * Evaluates a preset name, multi-line formula, or text query for a column,
 * supporting multiple counts or output rows in a single preset.
 */
export function evaluateCalculationPresetOrFormula(
  inputStr: string,
  metrics: ColumnMetrics,
  calcPresets: PresetItemLike[] = []
): CalculationOutputRow[] {
  if (!inputStr || !inputStr.trim()) return [];

  const trimmed = inputStr.trim();
  const foundPreset = calcPresets.find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase() || p.id === trimmed
  );

  const formulaToEvaluate = foundPreset ? foundPreset.formula : inputStr;
  const presetName = foundPreset ? foundPreset.name : "";

  // Split into lines/clauses by newline or semicolon
  const rawClauses = formulaToEvaluate
    .split(/\r?\n|;/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (rawClauses.length === 0) return [];

  const results: CalculationOutputRow[] = [];

  for (const clause of rawClauses) {
    let label: string | undefined;
    let expr = clause;

    // Check if clause matches "Label: Expression", ignoring search prefixes like "word:" or "match:"
    const isKeywordPrefix = /^(?:word|regex|match|contains)\s*:/i.test(clause);
    if (!isKeywordPrefix) {
      const labelMatch = clause.match(/^([^:]+):\s*(.+)$/);
      if (labelMatch) {
        label = labelMatch[1].trim();
        expr = labelMatch[2].trim();
      }
    }

    // 1. Text Query (e.g. "count - word - laptop", "word: laptop", "COUNT_WORD('laptop')")
    const parsedQuery = parseTextQuery(expr);
    if (parsedQuery) {
      try {
        const textRes = executeTextQuery(parsedQuery, metrics.rawValues || []);
        results.push({
          label,
          display: label ? `${label}: ${textRes.foundCount}` : textRes.display,
          isTextQuery: !label,
          value: textRes.foundCount,
        });
      } catch {
        results.push({
          label,
          display: label ? `${label}: Err` : "Err",
          isError: true,
          isTextQuery: !label,
        });
      }
      continue;
    }

    // 2. Standard Metric
    const upper = expr.toUpperCase();
    if (upper === "SUM") {
      results.push({
        label: label || "SUM",
        display: formatCalculationResult("SUM", metrics.sum),
        value: metrics.sum,
      });
      continue;
    }
    if (upper === "MID") {
      results.push({
        label: label || "MID",
        display: formatCalculationResult("MID", metrics.mid),
        value: metrics.mid,
      });
      continue;
    }
    if (upper === "AVG") {
      results.push({
        label: label || "AVG",
        display: formatCalculationResult("AVG", metrics.avg),
        value: metrics.avg,
      });
      continue;
    }
    if (upper === "MAX") {
      results.push({
        label: label || "MAX",
        display: formatCalculationResult("MAX", metrics.max),
        value: metrics.max,
      });
      continue;
    }
    if (upper === "MIN") {
      results.push({
        label: label || "MIN",
        display: formatCalculationResult("MIN", metrics.min),
        value: metrics.min,
      });
      continue;
    }
    if (upper === "COUNT") {
      results.push({
        label: label || "COUNT",
        display: formatCalculationResult("COUNT", metrics.count),
        value: metrics.count,
      });
      continue;
    }

    // 3. Math Expression / Formula
    try {
      const val = evaluateFormula(expr, metrics);
      const defaultLabel = label || (rawClauses.length === 1 && presetName ? presetName : expr);
      results.push({
        label: defaultLabel,
        display: formatCalculationResult(defaultLabel, val),
        value: val,
      });
    } catch {
      results.push({
        label: label || expr,
        display: "Err",
        isError: true,
      });
    }
  }

  return results;
}


export interface BlueprintField {
  type: "toggle" | "text" | "dropdown";
  name: string;
  desc: string;
  defaultVal: string | boolean;
  options?: string[];
}

export interface BlueprintSection {
  id: string;
  category: "table" | "agent";
  title: string;
  storeId: string;
  repoUrl: string;
  description: string;
  fields: BlueprintField[];
}

export const PREVIEW_BLUEPRINTS: BlueprintSection[] = [
  // 🌸 TABLE MODULES
  {
    id: "table-csv",
    category: "table",
    title: "CSV & Tablite Table Editor",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/pakcli-table",
    description: "Fast in-vault spreadsheet and database grid for CSV, TSV and JSON files.",
    fields: [
      { type: "toggle", name: "Enable CSV Table Editor", desc: "Open CSV files in interactive spreadsheet editor", defaultVal: true },
      { type: "dropdown", name: "Default Grid Theme", desc: "Visual styling for table cells", defaultVal: "Obsidian Dark", options: ["Obsidian Dark", "Nord", "Cyberpunk", "Minimal"] },
    ],
  },
  {
    id: "table-tree",
    category: "table",
    title: "Tree Diagram & Hierarchy Explorer",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/pakcli-table",
    description: "Visual folder structure diagrams and tree view generators for markdown.",
    fields: [
      { type: "toggle", name: "Enable Tree Post-processor", desc: "Render ```tree codeblocks as interactive diagrams", defaultVal: true },
      { type: "dropdown", name: "Default Tree Layout", desc: "Layout orientation", defaultVal: "Left-to-Right", options: ["Left-to-Right", "Top-to-Bottom", "Folder Box"] },
    ],
  },
  {
    id: "table-codeblock",
    category: "table",
    title: "Codeblock Scaler & Themes",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/pakcli-table",
    description: "Syntax highlighter, auto-scaler, copy buttons, and sleek header themes.",
    fields: [
      { type: "toggle", name: "Enable Codeblock Header", desc: "Show language badge and copy action button", defaultVal: true },
      { type: "dropdown", name: "Header Style", desc: "Appearance of codeblock headers", defaultVal: "Glassmorphic Pill", options: ["Glassmorphic Pill", "Clean Minimal", "Terminal Chrome"] },
    ],
  },
  {
    id: "table-ascii",
    category: "table",
    title: "ASCII Motion & Canvas Studio",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/pakcli-table",
    description: "Interactive drawing canvas for ASCII art, architecture diagrams, and frame animations.",
    fields: [
      { type: "toggle", name: "Enable ASCII Codeblock Canvas", desc: "Render editable ASCII drawing canvas in notes", defaultVal: true },
      { type: "text", name: "Default Snapping Grid", desc: "Grid snap size in pixels", defaultVal: "8" },
    ],
  },
  {
    id: "table-leaflet",
    category: "table",
    title: "Leaflet Map Bases",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/pakcli-table",
    description: "Embed interactive map coordinate bases with custom markers and overlays.",
    fields: [
      { type: "toggle", name: "Enable Leaflet Views", desc: "Render map views inside markdown notes", defaultVal: true },
      { type: "dropdown", name: "Default Map Provider", desc: "Tile server", defaultVal: "OpenStreetMap", options: ["OpenStreetMap", "CartoDB Dark", "Stamen Toner"] },
    ],
  },

  // 🤖 AGENT MODULES
  {
    id: "agent-antigravity",
    category: "agent",
    title: "Antigravity AI Proxy & Models",
    storeId: "pakcli-agent",
    repoUrl: "https://github.com/pakcli/pakcli-agent",
    description: "Intelligent AI assistant, Antigravity AI proxy, local Ollama integration, and smart actions.",
    fields: [
      { type: "text", name: "Antigravity Proxy Endpoint", desc: "Local or remote AI proxy server URL", defaultVal: "http://localhost:8080" },
      { type: "dropdown", name: "Default Model", desc: "Active LLM engine", defaultVal: "Gemini Flash (Fast)", options: ["Gemini Flash (Fast)", "Gemini Pro (Smart)", "Local Ollama"] },
    ],
  },
  {
    id: "agent-ocr",
    category: "agent",
    title: "Receipt & Document OCR Vision",
    storeId: "pakcli-agent",
    repoUrl: "https://github.com/pakcli/pakcli-agent",
    description: "Extract structured data, total prices, tax, and item tables from images automatically.",
    fields: [
      { type: "toggle", name: "Enable Auto-Receipt Scanner", desc: "Detect receipt images and extract tables to markdown", defaultVal: true },
      { type: "text", name: "Target Data Table Path", desc: "Folder path for structured output", defaultVal: "PakCLI Data/Receipts" },
    ],
  },
];

export interface BlueprintField {
  type: "toggle" | "text" | "dropdown";
  key: string;
  name: string;
  desc: string;
  defaultVal: string | boolean;
  options?: string[];
}

export interface BlueprintSection {
  id: string;
  category: "local" | "table" | "agent";
  title: string;
  icon: string;
  storeId: string;
  repoUrl: string;
  description: string;
  fields: BlueprintField[];
}

export const ECOSYSTEM_MODULES: BlueprintSection[] = [
  // ⚙️ LOCAL MODULES
  {
    id: "local-wizard",
    category: "local",
    title: "System & Ecosystem Diagnostics",
    icon: "activity",
    storeId: "pakcli-local",
    repoUrl: "https://github.com/pakcli/local",
    description: "Scan your environment for PowerShell engine, symlink privileges, yt-dlp media binaries, and active suite modules.",
    fields: [],
  },
  {
    id: "local-symlink",
    category: "local",
    title: "Symlink & Junction Manager",
    icon: "link",
    storeId: "pakcli-local",
    repoUrl: "https://github.com/pakcli/local",
    description: "Manage Windows NTFS symlinks, directory junctions, and auto-badge file explorer folders.",
    fields: [
      { key: "showBadges", type: "toggle", name: "Show Status Badges in File Explorer", desc: "Color folders with symlink/junction status indicators (green = junction, orange = symlink).", defaultVal: true },
      { key: "confirmDisconnect", type: "toggle", name: "Confirm Before Disconnect", desc: "Show confirmation dialog before unlinking or disconnecting a junction.", defaultVal: true },
    ],
  },
  {
    id: "local-scriptsync",
    category: "local",
    title: "ScriptSync (PowerShell & Shell Runner)",
    icon: "terminal",
    storeId: "pakcli-local",
    repoUrl: "https://github.com/pakcli/local",
    description: "Two-way synchronization between Markdown note codeblocks and external script files on disk.",
    fields: [
      { key: "managerRootFolder", type: "text", name: "Markdown Notes Folder (Manager Root)", desc: "Vault folder to scan and track (leave empty for entire vault root).", defaultVal: "" },
      { key: "cliRootFolder", type: "text", name: "External Scripts Directory (CLI Root)", desc: "Absolute folder path on disk where raw script files are exported.", defaultVal: "" },
      { key: "autoWatchCliFolder", type: "toggle", name: "Auto-Watch External CLI Directory", desc: "Automatically detect changes to script files on disk and prompt to sync.", defaultVal: true },
    ],
  },
  {
    id: "local-ytd",
    category: "local",
    title: "YTD (YouTube Downloader Engine)",
    icon: "video",
    storeId: "pakcli-local",
    repoUrl: "https://github.com/pakcli/local",
    description: "Download YouTube videos, audio clips, and video snippets directly into vault notes.",
    fields: [
      { key: "downloadFolder", type: "text", name: "Default Download Folder", desc: "Target vault folder for media downloads.", defaultVal: "media" },
      { key: "defaultQuality", type: "dropdown", name: "Default Quality", desc: "Video resolution preference.", defaultVal: "1080p", options: ["1080p", "720p", "480p", "Best Audio Only"] },
    ],
  },

  // ☐ TABLE MODULES
  {
    id: "table-bubble-graph",
    category: "table",
    title: "Graph Topology & Bubble View",
    icon: "circle-dot",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/table",
    description: "Venn-cluster topology, organic contour hulls, smart 3-tier link hierarchy, and interactive graph inspector.",
    fields: [
      { key: "bubbleGraphMode", type: "dropdown", name: "Integration Mode", desc: "Choose whether to deactivate, replace vanilla graph, or add as a second graph view.", defaultVal: "second", options: ["second", "replace", "deactivate"] },
      { key: "bubbleRibbonIcon", type: "dropdown", name: "Ribbon Icon", desc: "Select icon to display in the left ribbon bar.", defaultVal: "circle-dot", options: ["circle-dot", "bubbles", "dot-network", "git-fork", "network", "sparkles", "share-2", "boxes", "compass", "orbit"] },
      { key: "bubbleMaxDragDepth", type: "dropdown", name: "Max Drag Depth", desc: "Depth constraint for dragging nodes and clusters.", defaultVal: "2", options: ["0", "1", "2", "3"] },
      { key: "bubbleDefaultLayout", type: "dropdown", name: "Default Layout", desc: "Initial view mode.", defaultVal: "bubble", options: ["bubble", "default"] },
    ],
  },
  {
    id: "table-csv",
    category: "table",
    title: "CSV & Tablite Table Editor",
    icon: "table",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/table",
    description: "Fast in-vault spreadsheet and database grid for CSV, TSV and JSON files.",
    fields: [
      { key: "enableCsvEditor", type: "toggle", name: "Enable CSV Table Editor", desc: "Open CSV and TSV files in interactive grid editor.", defaultVal: true },
      { key: "gridTheme", type: "dropdown", name: "Default Grid Theme", desc: "Visual styling for table cells and header chrome.", defaultVal: "ag-theme-quartz", options: ["ag-theme-quartz", "ag-theme-alpine", "ag-theme-balham"] },
    ],
  },
  {
    id: "table-tree",
    category: "table",
    title: "Tree Diagram & Hierarchy Explorer",
    icon: "folder-tree",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/table",
    description: "Visual folder structure diagrams and tree view generators for markdown.",
    fields: [
      { key: "enableTreeProcessor", type: "toggle", name: "Enable Tree Post-processor", desc: "Render tree codeblocks as interactive folder diagrams.", defaultVal: true },
      { key: "defaultTreeLayout", type: "dropdown", name: "Default Tree Layout", desc: "Layout orientation.", defaultVal: "Left-to-Right", options: ["Left-to-Right", "Top-to-Bottom", "Folder Box"] },
      { key: "centralAssetFolder", type: "text", name: "Central Asset Folder", desc: "Folder where routed media and attachments are stored.", defaultVal: "assets" },
    ],
  },
  {
    id: "table-codeblock",
    category: "table",
    title: "Codeblock Scaler & Themes",
    icon: "code",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/table",
    description: "Syntax highlighter, auto-scaler, copy buttons, and responsive codeblock wrapping.",
    fields: [
      { key: "codeblockWrapMode", type: "dropdown", name: "Codeblock Wrap & Flow Mode", desc: "Choose how long code lines are handled in Live Preview and Reading views.", defaultVal: "flowclip", options: ["flowclip", "wrap", "scalefit"] },
      { key: "enableAssetDrag", type: "toggle", name: "Enable Native Asset Drag & Drop", desc: "Allow dragging images, PDFs, and media directly out of rendered codeblocks.", defaultVal: true },
    ],
  },
  {
    id: "table-ascii",
    category: "table",
    title: "ASCII Motion & Canvas Studio",
    icon: "sparkles",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/table",
    description: "Interactive canvas for ASCII diagrams, architecture drawings, and frame animations.",
    fields: [
      { key: "enableAsciiRenderer", type: "toggle", name: "Enable ASCII Canvas Renderer", desc: "Render ASCII diagrams with interactive playback controls and copy buttons.", defaultVal: true },
      { key: "asciiTheme", type: "dropdown", name: "Default ASCII Canvas Theme", desc: "Color theme for ASCII diagrams.", defaultVal: "Monochrome Matrix", options: ["Monochrome Matrix", "Cyberpunk Amber", "Chalkboard White", "Dracula Neon"] },
    ],
  },
  {
    id: "table-sqlseal",
    category: "table",
    title: "SQLSeal & Database Explorer",
    icon: "database",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/table",
    description: "Embedded SQLite engine, relational queries, and in-vault database inspector.",
    fields: [
      { key: "enableSqlSeal", type: "toggle", name: "Enable SQL Codeblock Processor", desc: "Execute embedded SQL blocks against SQLite database.", defaultVal: true },
      { key: "sqlBackend", type: "dropdown", name: "SQL Query Backend", desc: "Database engine mode.", defaultVal: "WA-SQLite WASM", options: ["WA-SQLite WASM", "SQLocal Worker", "In-Memory Temporary"] },
    ],
  },
  {
    id: "table-leaflet",
    category: "table",
    title: "Leaflet Map Bases",
    icon: "map-pin",
    storeId: "pakcli-table",
    repoUrl: "https://github.com/pakcli/table",
    description: "Embed interactive map coordinate bases with custom markers and overlays.",
    fields: [
      { key: "enableMeasureTool", type: "toggle", name: "Enable Measure Tool", desc: "Allow measuring distance on maps.", defaultVal: true },
      { key: "defaultOsm", type: "dropdown", name: "Default Tile Server", desc: "Map tile provider.", defaultVal: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", options: ["https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", "CartoDB Dark", "Stamen Toner"] },
    ],
  },

  // 🤖 AGENT MODULES
      {
    id: "agent-antigravity",
    category: "agent",
    title: "Antigravity AI Agent & CLI",
    icon: "bot",
    storeId: "pakcli-agent",
    repoUrl: "https://github.com/pakcli/agent",
    description: "Antigravity Agent companion for Obsidian with AI Chat, Vault context (Ctrl+L), Media Explorer, Diff Apply, and interactive Terminal.",
    fields: [
      { key: "command", type: "text", name: "Antigravity Command / Path", desc: "Path or command to run Google Antigravity CLI.", defaultVal: "agy" },
      { key: "args", type: "text", name: "Default Arguments", desc: "Default CLI arguments passed on execution.", defaultVal: "--dangerously-skip-permissions --continue" },
    ],
  },
  {
    id: "agent-ocr",
    category: "agent",
    title: "Receipt & Document OCR Vision",
    icon: "scan",
    storeId: "pakcli-agent",
    repoUrl: "https://github.com/pakcli/agent",
    description: "Extract structured data, total prices, tax, and item tables from images automatically.",
    fields: [
      { key: "enableOcrScanner", type: "toggle", name: "Enable Auto-Receipt Scanner", desc: "Detect receipt images and extract tables to markdown.", defaultVal: true },
      { key: "receiptOutputPath", type: "text", name: "Target Data Table Path", desc: "Folder path for structured output.", defaultVal: "PakCLI Data/Receipts" },
    ],
  },
];

export const PREVIEW_BLUEPRINTS = ECOSYSTEM_MODULES;

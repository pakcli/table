# PakCLI Table (Obsidian Plugin)

> 🌸 **PakCLI Table** is an all-in-one UI, data manipulation, and visual creativity plugin for [Obsidian](https://obsidian.md).

## Features

- 📊 **CSV & Tablite Grid Editor**:
  - **Multi-Cell Selection & Drag**: Click and drag across cells or `Shift+Click` to select rectangular ranges. Click row numbers or column headers (with `Shift+Click` extension) to select entire rows or columns.
  - **Copy & Paste (Excel / TSV / CSV Compatible)**: Full clipboard support (`Ctrl+C` / `Ctrl+V`, context menu). Copy single or multiple cells, rows, or columns.
  - **Exact-Cell Starting Paste**: Selecting any target cell and pasting immediately places clipboard data starting from that exact cell (expanding table rows automatically if needed) with full undo support (`Ctrl+Z`).
  - **Easy Clipboard / Click-to-Copy Toggle**: Click the clipboard icon in any column header to toggle click-to-copy mode for that column. Clicking any cell immediately copies its content to your clipboard with toast notification and visual flash feedback.
  - **Text Wrap Toggle**: Easily toggle text wrapping on or off from the toolbar (`Wrap` toggle) with state persisted per view and artifact, allowing multi-line cell content to wrap cleanly without truncating.
  - **Virtual Scrolling & High Performance**: Effortlessly handle large CSV/TSV datasets with row virtualization and lazy loading.
  - **Inline Cell Editing & Selection**: Single click to select, double click to edit, crosshair highlight, and range selection.
  - **Smart Filtering & Sorting**: Text filters, multi-select dropdowns, number/date range filters, and multi-column sorting.
  - **Column Management**: Reorder columns via drag & drop, resize column widths, hide/show columns, and freeze columns.
  - **Custom View Artifacts Folder**: Configure a custom vault folder path in Settings for storing CSV view states, column widths, filters, views, and calculation formulas (default: `csv_view_artifacts`). Automatically syncs on file rename with legacy backward compatibility.
  - **Summary & Calculation Rows**: Configurable summary row (Sum, Average, Min, Max, Count, and custom formulas).
- 🌳 **Tree & Folder Diagram Visualizer**: Render interactive folder and outline tree diagrams directly inside codeblocks with configurable node styles.
- 🗃️ **SQLite Database Explorer & SQLSeal**: Full in-memory and file-backed SQLite querying, schema visualizer, and custom SQL codeblocks powered by WebAssembly SQLite.
- 🎨 **ASCII Draw & Motion Studio**: Visual ASCII canvas drawing studio with multi-layering, themes, animated playback, live Undo/Redo (`Ctrl+Z` / `Ctrl+Y`), and canvas dimension retention.
- 📏 **Responsive Codeblock Scaler**: Auto-scale codeblocks and ASCII diagrams to fit note margins, with customizable per-language rules (e.g. `asci`, `python`, `markdown`).
- 🗺️ **Interactive Leaflet Maps**: Embedded OpenStreetMap views, custom geolocations, and marker presets.
- 📂 **Explorer Additions & Split View**: Multi-pane split view for Obsidian's File Explorer featuring a header split toggle button, recent files pane with folder-qualified `index.md` naming (e.g. `folder/index.md`), draggable divider, and customizable vertical section ordering (`Header Controls`, `Recent Files`, `Original File Explorer`).
- 🎛️ **Master-Detail Settings Hub & Direct Commands**: 2-Column responsive settings with instant search, deep linking, and dedicated commands to open settings tabs directly (`Asset Router`, `Codeblock Scaler`, `ASCII Studio`, `Tree Explorer`, `CSV Editor`, `Explorer Additions`).
- ⚡ **PakCLI Event Bus**: Decoupled inter-plugin communication (`window.PakCliEventBus`).
- 💾 **Vault Config Persistence**: Survives uninstalls and restores configurations automatically via `pakcli-vault-config`.

## Installation

1. Open Obsidian **Settings -> Community plugins**.
2. Turn on Community plugins and search for **PakCLI Table**.
3. Click **Install**, then **Enable**.

## Disclosures & Permissions

To maintain complete transparency and align with the official Obsidian Community Plugin Guidelines:

- **Vault Access & File Modification**: Reads and writes vault files strictly via the official Obsidian API (`vault.read`, `vault.cachedRead`, `vault.modify`, `vault.create`) for CSV editing, SQL file storage, and diagram rendering.
- **Vault Enumeration**: Discovers files and folder structures (`vault.getFiles`) to build tree diagrams and detect local SQLite databases within the vault.
- **Local SQLite WASM Engine**: Packages an in-memory/OPFS WebAssembly SQLite engine (`wa-sqlite`). The WASM binary exports its linear memory to perform fast in-process query execution locally without any external binary dependencies.
- **Clipboard Access**: Allows users to quickly copy tabular data, SQL query results, and ASCII artwork to the system clipboard upon explicit user action.
- **Network Requests**: The Leaflet map component loads public OpenStreetMap tile images over HTTPS only when an interactive map block is rendered. No personal data, telemetry, or vault content is ever transmitted over the network.

## License

[MIT License](LICENSE) © PakCLI Team

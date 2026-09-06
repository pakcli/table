# PakCLI Table (Obsidian Plugin)

> 🌸 **PakCLI Table** is an all-in-one UI, data manipulation, and visual creativity plugin for [Obsidian](https://obsidian.md).

## Features

- 🌳 **Tree & Folder Diagram Visualizer**: Render interactive folder and outline tree diagrams directly inside codeblocks.
- 🗃️ **SQLite Database Explorer & SQLSeal**: Full in-memory/file-backed SQLite querying, schema visualizer, and custom SQL codeblocks.
- 📊 **CSV & Tablite Grid Editor**: Rich tabular data editing with AG-Grid and TanStack Table features.
- 🗺️ **Interactive Leaflet Maps**: Embedded OpenStreetMap views, custom geolocations, and marker presets.
- 🎨 **ASCII Draw & Motion Studio**: Visual ASCII canvas drawing tool with multi-layering, themes, and animated playback.
- 📏 **Responsive Codeblock Scaler**: Auto-scale codeblocks and ASCII diagrams to fit note margins.
- 🎛️ **Master-Detail Settings Hub**: 2-Column responsive settings with instant search and transparent Grayscale preview for uninstalled ecosystem modules.
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

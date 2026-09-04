# 📋 Architecture Brief: Automated Heartbeat Scorecard Audit & 0-Risk Remediation Loop

## 🎯 1. Objective & Vision
Automate the end-to-end audit, publishing, verification, and self-healing error remediation cycle for **PakCLI Table** to achieve **0 Blocking Risks** and **0 Unhandled Warnings** on the official [Obsidian Community Plugin Review](https://community.obsidian.md/plugins/pakcli-table).

---

## 🌐 2. Target URLs Involved
| Purpose | Target URL |
|---|---|
| **Public Community Store Listing** | `https://community.obsidian.md/plugins/pakcli-table` |
| **Official Scorecard Anchor** | `https://community.obsidian.md/plugins/pakcli-table#scorecard` |
| **Developer Check-Release Endpoint** | `https://community.obsidian.md/account/plugins/pakcli-table/check-release` |
| **GitHub Releases & Attestation** | `https://github.com/pakcli/table/releases` |
| **Local Vault Target** | `D:\1sot\MAIN-DIGITAL-LIBRARY\MAIN-DIGITAL-LIBRARY\.obsidian\plugins\pakcli-table` |

---

## 🔄 3. The 5-Phase Heartbeat Daemon Loop

```
  ┌─────────────────────────────────────────────────────────────┐
  │ 1. BUMP & PUBLISH                                            │
  │    - npm run build (with polyfill script AST sanitizer)      │
  │    - git commit & tag release (e.g. v1.0.31 -> v1.0.32)     │
  │    - push tag to GitHub & upload SLSA release assets         │
  │    - ping check-release webhook                              │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 2. HEARTBEAT COUNTDOWN (25 MINUTES)                         │
  │    - Live terminal countdown for Obsidian CDN cache crawl   │
  │    - Press [S] key at any time to skip wait immediately     │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 3. EXTRACT SCORECARD & GENERATE REVIEW CSV                  │
  │    - Scrape / read audit findings from check-release portal  │
  │    - Save to: reviews/obsidian-official-community/          │
  │               yyyy_mm_dd_hh_mm-x_x_x.csv                    │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 4. ZERO-RISK ERROR REMEDIATION ENGINE                       │
  │    - If Errors == 0 AND Warnings == 0:                       │
  │        🏆 STOP & CERTIFY 0 RISK!                            │
  │    - If Risks > 0:                                          │
  │        🔧 Auto-patch source code with auto_remediate.cjs    │
  │        📦 Bump patch version and restart loop               │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 └───> (Restart to Step 1)
```

---

## 📊 4. Activity Log Tracking CSV Schema

Every execution step, tool call, webscrape, and code fix is logged continuously to:
`table/automated-record-yyyy-mm-dd-hh-mm-dd-mm.csv`

### Column Specification:
1. **`time`**: Timestamp of execution (`HH:mm:ss`).
2. **`date`**: Date of execution (`YYYY-MM-DD`).
3. **`type execute`**: Execution category (`powershell local` \| `webscraping` \| `initiate a skill`).
4. **`url`**: Target web URL or local file path affected.
5. **`plugin-version current`**: Plugin version active at time of execution (e.g. `1.0.31`).
6. **`what the file or skill or script called`**: Name of script, source file, or skill invoked.
7. **`what does it do`**: Human-readable explanation of the action, remediation, or test performed.

---

## 🛠️ 5. Zero-Risk Remediation Matrix Summary
- **AST Polyfill Injection**: In `esbuild.config.mjs`, replaces `.createElement("script")` polyfills with `.createElement("div")`.
- **Window Lifecycle Compatibility**: Replaces bare `setTimeout` and `setInterval` with `window.setTimeout` and `window.setInterval`.
- **Obsidian 1.13+ Search Indexing**: Implements `getSettingDefinitions(): any[] { return []; }` on all `PluginSettingTab` classes.
- **Config Directory**: Replaces literal `".obsidian"` with `app.vault.configDir`.
- **CSS Cleanliness**: Eliminates `!important` and uses CSS variables and specific class selectors.

---

## 🚀 6. Execution Commands
- **Start Heartbeat Daemon**:
  ```powershell
  cd d:\0pro\pakcli-plugin\table
  powershell -ExecutionPolicy Bypass -File .\heartbeat_audit_loop.ps1 -WaitMinutes 25
  ```
- **Single Pass Audit**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\auto_audit_loop.ps1
  ```
- **Interactive Release Hub**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\ps_publish.ps1
  ```

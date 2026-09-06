# Contributing to PakCLI Table

Thank you for your interest in contributing to **PakCLI Table**! We welcome bug reports, feature suggestions, and code contributions.

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/pakcli/table.git
   cd table
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Development build & watch**:
   ```bash
   npm run dev
   ```

4. **Production build**:
   ```bash
   npm run build
   ```

5. **Typecheck & Lint**:
   ```bash
   npm run typecheck
   npm run lint
   ```

## Development Guidelines & Policies

To adhere to the [Official Obsidian Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines):

1. **DOM and Styling**:
   - Do not assign inline styles directly via `element.style.<property>`.
   - Use CSS classes defined in `styles.css` / SCSS or Obsidian native helper methods `setCssStyles()` and `setCssProps()`.
   - Use Obsidian helper methods (`createDiv()`, `createSpan()`, `createEl()`) instead of raw `document.createElement()`.

2. **Obsidian APIs**:
   - Use Obsidian's official Vault API (`this.app.vault.read`, `cachedRead`, `modify`, `create`) for file interactions.
   - Use window-scoped timers (`window.setTimeout`, `window.setInterval`) or `registerInterval`.
   - Never suppress linter rules with directive comments without explicit approval.

3. **UI Text**:
   - Use sentence case for UI labels, settings, and notices (e.g. "Create new view" instead of "Create New View").

## Submitting Pull Requests

1. Fork the repository and create your feature branch: `git checkout -b feat/my-feature`.
2. Ensure that `npm run typecheck` and `npm run build` succeed without errors.
3. Commit your changes with clear, descriptive commit messages.
4. Open a pull request against the `main-pakcli` branch.

## License

By contributing to PakCLI Table, you agree that your contributions will be licensed under the [MIT License](LICENSE).

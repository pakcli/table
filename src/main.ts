import { App, Plugin, Notice, TFile } from 'obsidian';
import { PakCLITableSettings, DEFAULT_TABLE_SETTINGS } from './settings';

// Hub Imports
import { MasterDetailSettingsTab } from './features/hub/settingsHub';
import { eventBus } from './features/hub/eventBus';
import { saveVaultConfig, loadVaultConfig } from './features/hub/vaultConfig';

// Tree & Asset Router Imports
import { AssetRouter } from './features/tree/router';
import { DiagramRenderer } from './features/tree/renderers/DiagramRenderer';
import { registerTreeCommands } from './features/tree/commands';

// SQLSeal & Database Imports
import { initSQLSeal } from './features/sqlseal/modules/main/init';
import { SQLSealSettingsTab } from './features/sqlseal/modules/settings/SQLSealSettingsTab';

// Leaflet Imports
import { BasesLeafletPlugin } from './features/leaflet/plugin';
import { BasesLeafletViewSettingsTab } from './features/leaflet/settings/basesLeafletViewSettingsTab';

// ASCII Draw Imports
import { registerAsciiDrawFeature } from './features/asciidraw';

// Codeblock Auto-Scaler
import { CodeblockScaler } from './features/codeblock/scaler';

export default class PakCLITablePlugin extends Plugin {
	settings!: PakCLITableSettings;
	router!: AssetRouter;
	codeblockScaler!: CodeblockScaler;
	leafletPlugin!: BasesLeafletPlugin;
	sqlsealTabInstance: SQLSealSettingsTab | null = null;
	leafletTabInstance: any = null;
	vaultRoot: string = '';

	async onload() {
		console.log('[PakCLI Table] Loading plugin...');

		// 1. Resolve Vault Root Path
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		if (typeof adapter.getBasePath === 'function') {
			this.vaultRoot = adapter.getBasePath();
		}

		// 2. Load Settings (with Vault Config fallback)
		await this.loadSettings();

		// 3. Initialize Event Bus
		eventBus.emit('table:loaded', { version: this.manifest.version });

		// 4. Initialize Codeblock Scaler
		this.codeblockScaler = new CodeblockScaler(this);
		this.codeblockScaler.registerEvents();
		this.applyCodeblockStyle();

		// 5. Initialize Tree Diagrams & Asset Router
		this.router = new AssetRouter(this.app, () => this.settings);
		this.router.registerEvents(this);

		this.registerMarkdownCodeBlockProcessor("tree", async (source, el, ctx) => {
			ctx.addChild(new DiagramRenderer(this as any, source, el, ctx));
		});

		registerTreeCommands(this as any);

		// 6. Initialize SQLSeal & Database Explorer
		try {
			const sqlsealInitResult = await initSQLSeal(this as any);
			this.sqlsealTabInstance = sqlsealInitResult?.settingsTab || null;
		} catch (err) {
			console.error('[PakCLI Table] Failed to initialize SQLSeal:', err);
		}

		// 7. Initialize Leaflet Mapping Engine
		try {
			this.leafletPlugin = new BasesLeafletPlugin(this.app, this as any);
			await this.leafletPlugin.onload();
			this.leafletTabInstance = new BasesLeafletViewSettingsTab(this.app, this as any);
		} catch (err) {
			console.error('[PakCLI Table] Failed to initialize Leaflet:', err);
		}

		// 8. Initialize ASCII Draw & Motion Studio
		registerAsciiDrawFeature(this as any);

		// 9. Register Master-Detail Settings Tab
		this.registerSettingsHub();

		console.log('[PakCLI Table] Loaded successfully.');
	}

	onunload() {
		console.log('[PakCLI Table] Unloading plugin...');
		if (this.leafletPlugin) {
			this.leafletPlugin.onunload();
		}
		eventBus.emit('table:unloaded', { version: this.manifest.version });
	}

	async loadSettings() {
		const stored = await this.loadData();
		const fallback = await loadVaultConfig(this.app, 'pakcli-table');
		this.settings = Object.assign({}, DEFAULT_TABLE_SETTINGS, fallback, stored);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await saveVaultConfig(this.app, 'pakcli-table', this.settings);
	}

	applyCodeblockStyle() {
		document.body.classList.remove('pakcli-flowclip', 'pakcli-wrap', 'pakcli-scalefit');
		document.body.classList.add(`pakcli-${this.settings.codeblockWrapMode || 'flowclip'}`);
	}

	private registerSettingsHub() {
		const settingsTab = new MasterDetailSettingsTab(this.app, this);

		// 1. Tree & Asset Router Handler
		settingsTab.registerLocalSection({
			id: 'table-tree',
			category: 'table',
			title: 'Tree & Asset Router',
			icon: 'folder-tree',
			isInstalled: true,
			render: (containerEl) => {
				const info = containerEl.createDiv({ cls: 'setting-item-description' });
				info.createEl('p', {
					text: 'Tree Diagram visualizer generates interactive folder and outline diagrams in codeblocks.'
				});
			}
		});

		// 2. SQLSeal & SQLite Handler
		if (this.sqlsealTabInstance) {
			settingsTab.registerLocalSection({
				id: 'table-sqlseal',
				category: 'table',
				title: 'SQLSeal & Database Explorer',
				icon: 'database',
				isInstalled: true,
				render: (containerEl) => {
					(this.sqlsealTabInstance as any)?.display(containerEl);
				}
			});
		}

		// 3. Leaflet Mapping Handler
		if (this.leafletTabInstance) {
			settingsTab.registerLocalSection({
				id: 'table-leaflet',
				category: 'table',
				title: 'Leaflet Map View',
				icon: 'map-pin',
				isInstalled: true,
				render: (containerEl) => {
					(this.leafletTabInstance as any)?.display(containerEl);
				}
			});
		}

		this.addSettingTab(settingsTab);
	}
}

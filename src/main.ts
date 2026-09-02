import { App, Plugin, Notice, TFile, Setting } from 'obsidian';
import { PakCLITableSettings, DEFAULT_TABLE_SETTINGS } from './settings';

// Hub Imports
import { MasterDetailSettingsTab } from './features/hub/settingsHub';
import { eventBus } from './features/hub/eventBus';
import { saveVaultConfig, loadVaultConfig } from './features/hub/vaultConfig';

// Tree & Asset Router Imports
import { AssetRouter } from './features/tree/router';
import { DiagramRenderer } from './features/tree/renderers/DiagramRenderer';
import { registerCommands as registerTreeCommands } from './features/tree/commands/index';

// SQLSeal & Database Imports
import { mainModule } from './features/sqlseal/modules/main/module';
import { SQLSealSettingsTab } from './features/sqlseal/modules/settings/SQLSealSettingsTab';
import { ColumnConfig } from './features/sqlseal/types';
import { CsvView, CSV_VIEW_TYPE } from './features/sqlseal/csv-view';

// Leaflet Imports
import { BasesLeafletViewPlugin } from './features/leaflet/plugin';
import { BasesLeafletViewSettingsTab } from './features/leaflet/settings/basesLeafletViewSettingsTab';

// ASCII Draw Imports
import { registerAsciiDrawFeature } from './features/asciidraw';

// Codeblock Auto-Scaler
import { CodeblockScaler } from './features/codeblock/scaler';

export default class PakCLITablePlugin extends Plugin {
	declare settings: PakCLITableSettings;
	router!: AssetRouter;
	codeblockScaler!: CodeblockScaler;
	leafletPlugin!: BasesLeafletViewPlugin;
	sqlsealTabInstance: SQLSealSettingsTab | null = null;
	leafletTabInstance: any = null;
	settingsPanelStates: Map<string, boolean> = new Map();
	vaultRoot: string = '';

	async onload(): Promise<void> {
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
		this.codeblockScaler.init();
		this.applyCodeblockStyle();

		// 5. Initialize Tree Diagrams & Asset Router
		this.router = new AssetRouter(this.app, () => this.settings);
		this.router.registerEvents(this);

		this.registerMarkdownCodeBlockProcessor('tree', async (source, el, ctx) => {
			ctx.addChild(new DiagramRenderer(this as any, source, el, ctx));
		});

		registerTreeCommands(this as any);

		// 6. Initialize SQLSeal & Database Explorer
		try {
			const container = mainModule.build({
				'obsidian.app': (d: { value: (v: unknown) => unknown }) => d.value(this.app),
				'obsidian.plugin': (d: { value: (v: unknown) => unknown }) => d.value(this),
				'obsidian.vault': (d: { value: (v: unknown) => unknown }) => d.value(this.app.vault)
			} as unknown as Parameters<typeof mainModule.build>[0]);

			const init = await container.get('init');
			init();

			this.sqlsealTabInstance = await container.get('settings.settingsTab');
		} catch (err) {
			console.error('[PakCLI Table] Failed to initialize SQLSeal:', err);
		}

		// Register CSV View
		this.registerView(CSV_VIEW_TYPE, (leaf) => new CsvView(leaf, this as any));
		this.registerExtensions(['csv'], CSV_VIEW_TYPE);

		// 7. Initialize Leaflet Mapping Engine
		try {
			this.leafletPlugin = new BasesLeafletViewPlugin(this.app, this.manifest);
			await this.leafletPlugin.onload();
			if (this.leafletPlugin.settingsManager) {
				this.leafletTabInstance = new BasesLeafletViewSettingsTab(this.leafletPlugin, this.leafletPlugin.settingsManager);
			}
		} catch (err) {
			console.error('[PakCLI Table] Failed to initialize Leaflet:', err);
		}

		// 8. Initialize ASCII Draw & Motion Studio
		registerAsciiDrawFeature(this as any);

		// 9. Register Master-Detail Settings Tab
		this.registerSettingsHub();

		console.log('[PakCLI Table] Loaded successfully.');
	}

	async onunload() {
		// 2. Persistent Snapshot on App Close / Unload
		try { await saveVaultConfig(this.app, 'pakcli-table', this.settings, 'session-close'); } catch {}
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

	getFileColumnConfig(filePath: string, columnCount: number): ColumnConfig {
		const fileConfigs = (this.settings as any).fileConfigs || {};
		const saved = fileConfigs[filePath];
		if (saved && !Array.isArray(saved)) {
			return saved;
		}
		return {
			order: Array.from({ length: columnCount }, (_, i) => i),
			hidden: [],
			sizing: {},
			frozenCount: 0
		};
	}

	async setFileColumnConfig(filePath: string, nextColumnCount: number, config: ColumnConfig): Promise<void> {
		if (!(this.settings as any).fileConfigs) {
			(this.settings as any).fileConfigs = {};
		}
		(this.settings as any).fileConfigs[filePath] = config;
		await this.saveSettings();
	}

	private registerSettingsHub() {
		const settingsTab = new MasterDetailSettingsTab(this.app, this);

		// 1. CSV & Tablite Editor Handler (table-csv)
		settingsTab.registerLocalSection({
			id: 'table-csv',
			category: 'table',
			title: 'CSV & Tablite Table Editor',
			icon: 'table',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('CSV & Tablite Grid Engine')
					.setDesc('Fast in-vault spreadsheet and database grid editor for CSV, TSV and JSON files.')
					.setHeading();

				new Setting(containerEl)
					.setName('Enable CSV Table Editor')
					.setDesc('Open .csv files in the interactive AG-Grid / Tablite spreadsheet viewer.')
					.addToggle((t) => {
						t.setValue((this.settings as any).enableCsvEditor !== false)
							.onChange(async (v) => {
								(this.settings as any).enableCsvEditor = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Default Grid Theme')
					.setDesc('Visual styling for table cells and header chrome.')
					.addDropdown((d) => {
						d.addOption('ag-theme-quartz', 'Obsidian Dark Quartz')
							.addOption('ag-theme-alpine', 'Alpine Crisp')
							.addOption('ag-theme-balham', 'Compact Balham')
							.setValue((this.settings as any).gridTheme || 'ag-theme-quartz')
							.onChange(async (v) => {
								(this.settings as any).gridTheme = v;
								await this.saveSettings();
							});
					});
			}
		});

		// 2. Tree Diagram & Hierarchy Explorer (table-tree)
		settingsTab.registerLocalSection({
			id: 'table-tree',
			category: 'table',
			title: 'Tree Diagram & Hierarchy Explorer',
			icon: 'folder-tree',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Tree Diagram & Asset Router')
					.setDesc('Visual folder structure diagrams and tree view generators for markdown codeblocks.')
					.setHeading();

				new Setting(containerEl)
					.setName('Enable Tree Post-processor')
					.setDesc('Render tree codeblocks as interactive diagrams and folder views.')
					.addToggle((t) => {
						t.setValue((this.settings as any).enableTreeProcessor !== false)
							.onChange(async (v) => {
								(this.settings as any).enableTreeProcessor = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Default Tree Layout')
					.setDesc('Default layout orientation for generated hierarchy diagrams.')
					.addDropdown((d) => {
						d.addOption('Left-to-Right', 'Left-to-Right (Horizontal)')
							.addOption('Top-to-Bottom', 'Top-to-Bottom (Vertical)')
							.addOption('Folder Box', 'Folder Box (Nested)')
							.setValue((this.settings as any).defaultTreeLayout || 'Left-to-Right')
							.onChange(async (v) => {
								(this.settings as any).defaultTreeLayout = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Central Asset Folder')
					.setDesc('Folder where routed media and attachments are stored.')
					.addText((t) => {
						t.setPlaceholder('assets')
							.setValue(this.settings.centralAssetFolder || 'assets')
							.onChange(async (v) => {
								this.settings.centralAssetFolder = v.trim();
								await this.saveSettings();
							});
					});
			}
		});

		// 3. Codeblock Scaler & Themes (table-codeblock)
		settingsTab.registerLocalSection({
			id: 'table-codeblock',
			category: 'table',
			title: 'Codeblock Scaler & Themes',
			icon: 'code',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Codeblock Scaler & Styling')
					.setDesc('Auto-scaler, syntax themes, flowclip viewer, and responsive codeblock wrapping.')
					.setHeading();

				new Setting(containerEl)
					.setName('Codeblock Wrap & Flow Mode')
					.setDesc('Choose how long code lines are handled in Live Preview and Reading views.')
					.addDropdown((d) => {
						d.addOption('flowclip', 'Flow Clip (Horizontal Scrollbar)')
							.addOption('wrap', 'Word Wrap (Wrap Lines)')
							.addOption('scalefit', 'Scale Fit (Auto Font Scaling)')
							.setValue(this.settings.codeblockWrapMode || 'flowclip')
							.onChange(async (v: any) => {
								this.settings.codeblockWrapMode = v;
								this.applyCodeblockStyle();
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Enable Native Asset Drag & Drop')
					.setDesc('Allow dragging images, PDFs, and media directly out of rendered codeblocks.')
					.addToggle((t) => {
						t.setValue(this.settings.enableAssetDrag !== false)
							.onChange(async (v) => {
								this.settings.enableAssetDrag = v;
								await this.saveSettings();
							});
					});
			}
		});

		// 4. ASCII Motion & Canvas Studio (table-ascii)
		settingsTab.registerLocalSection({
			id: 'table-ascii',
			category: 'table',
			title: 'ASCII Motion & Canvas Studio',
			icon: 'sparkles',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('ASCII Studio & Motion Canvas')
					.setDesc('Render ASCII and ASCI codeblocks as animated retro-futuristic canvas diagrams.')
					.setHeading();

				new Setting(containerEl)
					.setName('Enable ASCII Canvas Renderer')
					.setDesc('Render ASCII diagrams with interactive playback controls and copy buttons.')
					.addToggle((t) => {
						t.setValue(true)
							.onChange(async (v) => {
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Default ASCII Canvas Theme')
					.setDesc('Color theme for ASCII diagrams.')
					.addDropdown((d) => {
						d.addOption('Monochrome Matrix', 'Monochrome Matrix (Green/Black)')
							.addOption('Cyberpunk Amber', 'Cyberpunk Amber (Amber Glow)')
							.addOption('Chalkboard White', 'Chalkboard White (Classic)')
							.addOption('Dracula Neon', 'Dracula Neon (Purple/Cyan)')
							.setValue('Monochrome Matrix')
							.onChange(async (v) => {
								await this.saveSettings();
							});
					});
			}
		});

		// 5. SQLSeal & SQLite Database Handler (table-sqlseal)
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

		// 6. Leaflet Mapping Handler (table-leaflet)
		if (this.leafletTabInstance) {
			settingsTab.registerLocalSection({
				id: 'table-leaflet',
				category: 'table',
				title: 'Leaflet Map Bases',
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
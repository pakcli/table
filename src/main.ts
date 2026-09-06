import { App, Plugin, Notice, Setting, PluginSettingTab } from 'obsidian';
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
import { ColumnConfig, CalcPreset, normalizeColumnConfig, createDefaultColumnConfig } from './features/sqlseal/types';
import { CsvView, CSV_VIEW_TYPE } from './features/sqlseal/csv-view';
import { CustomCalcModal } from './features/sqlseal/components/CustomCalcModal';

// Leaflet Imports
import { BasesLeafletViewPlugin } from './features/leaflet/plugin';
import { BasesLeafletViewSettingsTab } from './features/leaflet/settings/basesLeafletViewSettingsTab';

// ASCII Draw Imports
import { registerAsciiDrawFeature } from './features/asciidraw';

// Codeblock Auto-Scaler
import { CodeblockScaler } from './features/codeblock/scaler';

// Bubble Graph View (Spec v18)
import { BUBBLE_GRAPH_VIEW_TYPE, BubbleGraphView } from './features/bubblegraph';

export default class PakCLITablePlugin extends Plugin {
	declare settings: PakCLITableSettings;
	router!: AssetRouter;
	codeblockScaler!: CodeblockScaler;
	leafletPlugin!: BasesLeafletViewPlugin;
	sqlsealTabInstance: SQLSealSettingsTab | null = null;
	leafletTabInstance: unknown = null;
	settingsPanelStates: Map<string, boolean> = new Map();
	vaultRoot: string = '';
	bubbleRibbonEl: HTMLElement | null = null;

	async openBubbleGraphView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: BUBBLE_GRAPH_VIEW_TYPE,
			active: true
		});
		this.app.workspace.revealLeaf(leaf);
	}

	updateBubbleRibbon(): void {
		if (this.bubbleRibbonEl) {
			this.bubbleRibbonEl.remove();
			this.bubbleRibbonEl = null;
		}

		if (this.settings.bubbleGraphMode === 'second') {
			const icon = this.settings.bubbleRibbonIcon || 'circle-dot';
			this.bubbleRibbonEl = this.addRibbonIcon(
				icon,
				'Open Bubble Graph View',
				() => { this.openBubbleGraphView(); }
			);
		}
	}

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
			ctx.addChild(new DiagramRenderer(this, source, el, ctx));
		});

		registerTreeCommands(this);

		// 6. Initialize SQLSeal & Database Explorer
		try {
			const container = (mainModule as any).build({
				'obsidian.app': (d: { value: (v: unknown) => unknown }) => d.value(this.app),
				'obsidian.plugin': (d: { value: (v: unknown) => unknown }) => d.value(this),
				'obsidian.vault': (d: { value: (v: unknown) => unknown }) => d.value(this.app.vault)
			});

			const init = await container.get('init');
			init();

			this.sqlsealTabInstance = await container.get('settings.settingsTab');
		} catch (err) {
			console.error('[PakCLI Table] Failed to initialize SQLSeal:', err);
		}

		// Register CSV View
		this.registerView(CSV_VIEW_TYPE, (leaf) => new CsvView(leaf, this));
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
		registerAsciiDrawFeature(this);

		// 9. Initialize Graph Topology & Bubble View (Spec v18)
		this.registerView(BUBBLE_GRAPH_VIEW_TYPE, (leaf) => new BubbleGraphView(leaf, this));

		this.addCommand({
			id: 'open-bubble-graph',
			name: 'Open Bubble Graph View (Spec v18)',
			callback: () => {
				this.openBubbleGraphView();
			}
		});

		this.updateBubbleRibbon();

		// Replace Vanilla GraphView listener if enabled
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				if (this.settings.bubbleGraphMode === 'replace') {
					const graphLeaves = this.app.workspace.getLeavesOfType('graph');
					for (const leaf of graphLeaves) {
						leaf.setViewState({
							type: BUBBLE_GRAPH_VIEW_TYPE,
							active: true
						});
					}
				}
			})
		);

		// 10. Register Master-Detail Settings Tab
		this.registerSettingsHub();

		console.log('[PakCLI Table] Loaded successfully.');
	}

	async onunload() {
		// 1. Remove ribbon icon if present
		if (this.bubbleRibbonEl) {
			this.bubbleRibbonEl.remove();
			this.bubbleRibbonEl = null;
		}

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
		const fileConfigs = (this.settings.fileConfigs as Record<string, ColumnConfig>) || {};
		const saved = fileConfigs[filePath];
		if (saved && !Array.isArray(saved)) {
			return normalizeColumnConfig(saved, columnCount);
		}
		return createDefaultColumnConfig(columnCount);
	}

	async setFileColumnConfig(filePath: string, nextColumnCount: number, config: ColumnConfig): Promise<void> {
		if (!this.settings.fileConfigs) {
			this.settings.fileConfigs = {};
		}
		(this.settings.fileConfigs as Record<string, ColumnConfig>)[filePath] = config;
		await this.saveSettings();
	}

	private registerSettingsHub() {
		const settingsTab = new MasterDetailSettingsTab(this.app, this);

		// 0. Bubble Graph & Venn Topology Handler (table-bubble-graph)
		settingsTab.registerLocalSection({
			id: 'table-bubble-graph',
			category: 'table',
			title: 'Graph Topology & Bubble View',
			icon: 'circle-dot',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Graph Topology & Bubble View (Spec v18)')
					.setDesc('Organized Venn-like cluster topology, organic contour hulls, smart 3-tier link hierarchy, and interactive graph inspector.')
					.setHeading();

				// Quick launch button
				new Setting(containerEl)
					.setName('Launch Bubble Graph View')
					.setDesc('Open the full-screen interactive Bubble Graph workspace.')
					.addButton((b) => {
						b.setButtonText('Open Bubble Graph ↗')
							.setCta()
							.onClick(() => {
								this.openBubbleGraphView();
							});
					});

				// Integration Mode Radio Cards (DEACTIVATE, REPLACE, SECOND)
				new Setting(containerEl)
					.setName('Bubble Graph Integration Mode')
					.setDesc('Choose how Bubble Graph View is integrated into your Obsidian workspace.')
					.setHeading();

				const radioContainer = containerEl.createDiv({ cls: 'pakcli-radio-cards-container' });

				const modes: Array<{
					id: 'deactivate' | 'replace' | 'second';
					title: string;
					desc: string;
				}> = [
					{
						id: 'deactivate',
						title: 'Deactivate',
						desc: 'Bubble Graph feature is completely disabled. No ribbon icons or view overrides.'
					},
					{
						id: 'replace',
						title: 'Replace Vanilla GraphView',
						desc: 'Automatically route and replace Obsidian standard graph view with Bubble Graph.'
					},
					{
						id: 'second',
						title: 'Add New as Second GraphView',
						desc: 'Keep vanilla graph intact and add a dedicated icon to the Obsidian ribbon bar.'
					}
				];

				const ribbonSettingContainer = containerEl.createDiv({ cls: 'pakcli-ribbon-setting-wrap' });

				const updateRibbonDropdownVisibility = () => {
					ribbonSettingContainer.empty();
					if (this.settings.bubbleGraphMode === 'second') {
						new Setting(ribbonSettingContainer)
							.setName('Ribbon Bar Icon')
							.setDesc('Choose which icon represents the Bubble Graph in the Obsidian ribbon.')
							.addDropdown((d) => {
								d.addOption('circle-dot', 'Circle Dot (Bubble Dot)')
									.addOption('bubbles', 'Bubbles (Cluster Bubbles)')
									.addOption('dot-network', 'Dot Network (Network Mesh)')
									.addOption('git-fork', 'Git Fork (Branching Fork)')
									.addOption('network', 'Network (Network Web)')
									.addOption('sparkles', 'Sparkles (Magic Glow)')
									.addOption('share-2', 'Share 2 (Connected Nodes)')
									.addOption('boxes', 'Boxes (Clustered Cells)')
									.addOption('compass', 'Compass (Atlas Compass)')
									.addOption('orbit', 'Orbit (Planetary Orbits)')
									.setValue(this.settings.bubbleRibbonIcon || 'circle-dot')
									.onChange(async (v) => {
										this.settings.bubbleRibbonIcon = v;
										await this.saveSettings();
										this.updateBubbleRibbon();
									});
							});
					}
				};

				const renderRadioCards = () => {
					radioContainer.empty();
					modes.forEach((m) => {
						const isSelected = (this.settings.bubbleGraphMode || 'second') === m.id;
						const card = radioContainer.createDiv({
							cls: `pakcli-radio-card ${isSelected ? 'is-selected' : ''}`
						});

						const cardHeader = card.createDiv({ cls: 'pakcli-radio-card-header' });
						cardHeader.createSpan({ cls: 'pakcli-radio-circle' });
						cardHeader.createSpan({ text: m.title, cls: 'pakcli-radio-card-title' });

						card.createDiv({ text: m.desc, cls: 'pakcli-radio-card-desc' });

						card.onclick = async () => {
							this.settings.bubbleGraphMode = m.id;
							await this.saveSettings();
							this.updateBubbleRibbon();
							renderRadioCards();
							updateRibbonDropdownVisibility();
						};
					});
				};

				renderRadioCards();
				updateRibbonDropdownVisibility();

				new Setting(containerEl)
					.setName('Topology & Physics Controls')
					.setHeading();

				new Setting(containerEl)
					.setName('Max Drag Depth Limit')
					.setDesc('Configure how dragging interacts with hierarchy (0 = Lock all, 1 = Folder only, 2 = Subfolder, 3 = Child node).')
					.addDropdown((d) => {
						d.addOption('0', '0: Lock all positions (Pure physics)')
							.addOption('1', '1: Folder only (Move parent cluster)')
							.addOption('2', '2: Subfolder (Default: Contained items)')
							.addOption('3', '3: Child (Deep note dragging)')
							.setValue(String(this.settings.bubbleMaxDragDepth ?? 2))
							.onChange(async (v) => {
								this.settings.bubbleMaxDragDepth = parseInt(v, 10);
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Default Layout Mode')
					.setDesc('Default layout view when opening graph.')
					.addDropdown((d) => {
						d.addOption('bubble', 'Venn-Cluster Bubble Topology')
							.addOption('default', 'Standard Force-Directed Graph')
							.setValue(this.settings.bubbleDefaultLayout || 'bubble')
							.onChange(async (v: string) => {
								this.settings.bubbleDefaultLayout = v as 'bubble' | 'default';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Show Inter-Folder Venn Bridges')
					.setDesc('Render high-contrast glowing neon bridge lines for links connecting different top-level folders.')
					.addToggle((t) => {
						t.setValue(this.settings.bubbleShowVennBridges !== false)
							.onChange(async (v) => {
								this.settings.bubbleShowVennBridges = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Inter-Folder Link Neon Glow')
					.setDesc('Apply luminous neon glow shader on inter-cluster cross links.')
					.addToggle((t) => {
						t.setValue(this.settings.bubbleInterLinkGlow !== false)
							.onChange(async (v) => {
								this.settings.bubbleInterLinkGlow = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Bubble Contour Hull Opacity')
					.setDesc('Adjust the glassmorphic background intensity for regional folder bubbles.')
					.addSlider((s) => {
						s.setLimits(0.04, 0.35, 0.02)
							.setValue(this.settings.bubbleHullOpacity || 0.12)
							.setDynamicTooltip()
							.onChange(async (v) => {
								this.settings.bubbleHullOpacity = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Timelapse Animation Mode')
					.setDesc('Choose between Date-based time interpolation and Vanilla sequential node spawn.')
					.addDropdown((d) => {
						d.addOption('date', 'Default: Date-based timeline interpolation')
							.addOption('vanilla', 'Vanilla: Sequential spawn (0.025s per node / folder in chronological order)')
							.setValue(this.settings.bubbleTimelapseMode || 'date')
							.onChange(async (v: string) => {
								this.settings.bubbleTimelapseMode = v as 'date' | 'vanilla';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Vanilla Timelapse Spawn Speed')
					.setDesc('Delay in seconds per node/folder in Vanilla sequential mode (Default: 0.025s / 25ms).')
					.addText((t) => {
						t.setValue((this.settings.bubbleTimelapseVanillaSpeed ?? 0.025).toString())
							.setPlaceholder('0.025')
							.onChange(async (v) => {
								const parsed = parseFloat(v);
								if (!isNaN(parsed) && parsed > 0) {
									this.settings.bubbleTimelapseVanillaSpeed = parsed;
									await this.saveSettings();
								}
							});
					});
			}
		});

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
						t.setValue(this.settings.enableCsvEditor !== false)
							.onChange(async (v) => {
								this.settings.enableCsvEditor = v;
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
							.setValue(this.settings.gridTheme || 'ag-theme-quartz')
							.onChange(async (v) => {
								this.settings.gridTheme = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Calculation Engine & Aggregate Dashboards')
					.setDesc('Configure standard aggregations (SUM, MID, AVG, MAX, MIN, COUNT) and custom math formulas.')
					.setHeading();

				new Setting(containerEl)
					.setName('Default Calculation Row Position')
					.setDesc('Default placement of the calculation row across CSV files.')
					.addDropdown((d) => {
						d.addOption('below', 'Below Last Row')
							.addOption('above', 'Above Header')
							.addOption('both', 'Both (Above & Below)')
							.addOption('none', 'Off / Hidden')
							.setValue(this.settings.defaultCalcPosition || 'above')
							.onChange(async (v: string) => {
								this.settings.defaultCalcPosition = v as 'below' | 'above' | 'both' | 'none';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Freeze Calculation Row')
					.setDesc('Pin calculation row to top or bottom while scrolling through table data.')
					.addToggle((t) => {
						t.setValue(this.settings.defaultCalcFreeze !== false)
							.onChange(async (v) => {
								this.settings.defaultCalcFreeze = v;
								await this.saveSettings();
							});
					});

				const renderPresetsList = (listContainer: HTMLElement) => {
					listContainer.empty();

					new Setting(listContainer)
						.setName('Custom Calculation Presets (*preset_name)')
						.setDesc('Formulas support arithmetic operators (+, -, *, /, %, ^) with tokens: SUM, MID, AVG, MAX, MIN, COUNT.')
						.addButton((btn) => {
							btn.setButtonText('+ Add Calc Preset')
								.setCta()
								.onClick(() => {
									new CustomCalcModal(this.app, this, undefined, () => {
										renderPresetsList(listContainer);
									}).open();
								});
						});

					const presets: CalcPreset[] = this.settings.calcPresets || [];
					if (presets.length === 0) {
						const emptyEl = listContainer.createEl('div', {
							text: 'No custom calculation presets configured. Click "+ Add Calc Preset" to create one.',
							cls: 'tablite-calc-empty-note'
						});
						emptyEl.style.fontSize = '0.85em';
						emptyEl.style.color = 'var(--text-muted)';
						emptyEl.style.padding = '8px 0';
						return;
					}

					for (const preset of presets) {
						const setting = new Setting(listContainer)
							.setName(preset.name)
							.setDesc(`Formula: ${preset.formula}${preset.description ? ` — ${preset.description}` : ''}`);

						setting.addExtraButton((btn) => {
							btn.setIcon('pencil')
								.setTooltip('Edit Preset Formula')
								.onClick(() => {
									new CustomCalcModal(this.app, this, preset, () => {
										renderPresetsList(listContainer);
									}).open();
								});
						});

						setting.addExtraButton((btn) => {
							btn.setIcon('trash')
								.setTooltip('Delete Preset')
								.onClick(async () => {
									this.settings.calcPresets = (this.settings.calcPresets || []).filter(p => p.id !== preset.id);
									await this.saveSettings();
									renderPresetsList(listContainer);
									new Notice(`Preset "${preset.name}" deleted.`);
								});
						});
					}
				};

				const presetsSectionEl = containerEl.createDiv({ cls: 'tablite-presets-settings-section' });
				renderPresetsList(presetsSectionEl);
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
						t.setValue(this.settings.enableTreeProcessor !== false)
							.onChange(async (v) => {
								this.settings.enableTreeProcessor = v;
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
							.setValue(this.settings.defaultTreeLayout || 'Left-to-Right')
							.onChange(async (v) => {
								this.settings.defaultTreeLayout = v;
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
							.onChange(async (v: string) => {
								this.settings.codeblockWrapMode = v as 'flowclip' | 'wrap' | 'scalefit';
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
					(this.sqlsealTabInstance as PluginSettingTab)?.display();
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
					(this.leafletTabInstance as PluginSettingTab)?.display();
				}
			});
		}

		this.addSettingTab(settingsTab);
	}
}
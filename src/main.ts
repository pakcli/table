import { Plugin, Notice, Setting, PluginSettingTab, ButtonComponent, TFile, TextComponent, setIcon } from 'obsidian';
import { PakCLITableSettings, DEFAULT_TABLE_SETTINGS } from './settings';
import { handleArtifactRename, moveArtifactsBetweenFolders } from './features/sqlseal/utils/views';
import { SplitViewManager } from './features/explorer/splitViewManager';
import { ExplorerSectionId, EXPLORER_SECTIONS_INFO, DEFAULT_EXPLORER_SECTION_ORDER } from './features/explorer/types';

// Hub Imports
import { MasterDetailSettingsTab } from './features/hub/settingsHub';
import { eventBus } from './features/hub/eventBus';
import { saveVaultConfig, loadVaultConfig } from './features/hub/vaultConfig';

// Tree & Asset Router Imports
import { AssetRouter } from './features/tree/router';
import { DiagramRenderer } from './features/tree/renderers/DiagramRenderer';
import { registerCommands as registerTreeCommands } from './features/tree/commands/index';
import { FolderSuggest } from './features/tree/ui/folder-suggest';
import { ConfirmModal } from './features/tree/ui/modals';
import { TitleOverrideOption } from './features/tree/types';

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
	settingsTabInstance: MasterDetailSettingsTab | null = null;
	settingsPanelStates: Map<string, boolean> = new Map();
	splitViewManager!: SplitViewManager;
	vaultRoot: string = '';
	bubbleRibbonEl: HTMLElement | null = null;

	openSettingsTab(sectionId?: string): void {
		const appWithPlugins = this.app as { setting?: { open?: () => void; openTabById?: (id: string) => void } };
		const setting = appWithPlugins.setting;
		if (setting && typeof setting.open === 'function') {
			setting.open();
			if (typeof setting.openTabById === 'function') {
				setting.openTabById(this.manifest.id);
			}
			if (sectionId && this.settingsTabInstance) {
				this.settingsTabInstance.openSection(sectionId);
			}
		}
	}

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

		// Settings Tab Navigation Commands
		this.addCommand({
			id: 'open-asset-router-settings',
			name: 'Open Settings: Asset Router & Attachments',
			callback: () => {
				this.openSettingsTab('table-asset-router');
			}
		});

		this.addCommand({
			id: 'open-codeblock-settings',
			name: 'Open Settings: Codeblock Scaler & Themes',
			callback: () => {
				this.openSettingsTab('table-codeblock');
			}
		});

		this.addCommand({
			id: 'open-ascii-settings',
			name: 'Open Settings: ASCII Motion & Canvas Studio',
			callback: () => {
				this.openSettingsTab('table-ascii');
			}
		});

		this.addCommand({
			id: 'open-tree-settings',
			name: 'Open Settings: Tree Hierarchy Explorer',
			callback: () => {
				this.openSettingsTab('table-tree');
			}
		});

		this.addCommand({
			id: 'open-csv-settings',
			name: 'Open Settings: CSV & Tablite Editor',
			callback: () => {
				this.openSettingsTab('table-csv');
			}
		});

		this.addCommand({
			id: 'open-explorer-settings',
			name: 'Open Settings: Explorer Additions & Split View',
			callback: () => {
				this.openSettingsTab('table-explorer');
			}
		});

		this.addCommand({
			id: 'toggle-explorer-split-view',
			name: 'Toggle File Explorer Split View (Recent Files)',
			callback: async () => {
				this.settings.explorerSplitEnabled = !this.settings.explorerSplitEnabled;
				await this.saveSettings();
				if (this.splitViewManager) {
					this.splitViewManager.applyLayout();
				}
				new Notice(`Explorer Split View: ${this.settings.explorerSplitEnabled ? 'Enabled' : 'Disabled'}`);
			}
		});

		this.updateBubbleRibbon();

		// Initialize Explorer Additions & Split View Manager
		this.splitViewManager = new SplitViewManager(this);
		this.splitViewManager.init();

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

		// Synchronize CSV view artifact file on CSV file rename
		this.registerEvent(
			this.app.vault.on('rename', async (file, oldPath) => {
				if (file instanceof TFile && file.extension?.toLowerCase() === 'csv') {
					await handleArtifactRename(this.app, oldPath, file.path, this.settings.csvArtifactFolderPath);
				}
			})
		);

		// 10. Register Master-Detail Settings Tab
		this.registerSettingsHub();
	}

	async onunload() {
		// 1. Remove ribbon icon if present
		if (this.bubbleRibbonEl) {
			this.bubbleRibbonEl.remove();
			this.bubbleRibbonEl = null;
		}

		// 2. Persistent Snapshot on App Close / Unload
		try {
			await saveVaultConfig(this.app, 'pakcli-table', this.settings, 'session-close');
		} catch {
			// Vault config save failure ignored on unload
		}
		if (this.leafletPlugin) {
			this.leafletPlugin.onunload();
		}
		if (this.splitViewManager) {
			this.splitViewManager.destroy();
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
		this.settingsTabInstance = settingsTab;

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

				let folderTextInput: TextComponent | null = null;
				const artifactFolderSetting = new Setting(containerEl)
					.setName('CSV View Artifacts Folder')
					.setDesc('Vault folder where custom column order, sizing, hidden columns, filters, custom views, and calculations are saved (default: csv_view_artifacts).')
					.addText((text) => {
						folderTextInput = text;
						text.setPlaceholder('csv_view_artifacts')
							.setValue(this.settings.csvArtifactFolderPath || 'csv_view_artifacts')
							.onChange(async (v) => {
								this.settings.csvArtifactFolderPath = v.trim();
								await this.saveSettings();
							});
					})
					.addButton((btn) => {
						btn.setButtonText('Move Default → Custom')
							.setTooltip('Migrate all artifact JSON files from default (csv_view_artifacts) to this custom folder')
							.setCta()
							.onClick(async () => {
								const customFolder = (this.settings.csvArtifactFolderPath || '').trim().replace(/^\/+|\/+$/g, '');
								if (!customFolder || customFolder === 'csv_view_artifacts') {
									new Notice('⚠️ Destination is already the default folder ("csv_view_artifacts"). Please specify a different custom folder first.');
									return;
								}
								btn.setDisabled(true);
								try {
									const result = await moveArtifactsBetweenFolders(this.app, 'csv_view_artifacts', customFolder);
									if (result.moved > 0) {
										new Notice(`🚚 Successfully moved ${result.moved} artifact file(s) to "${customFolder}"!`);
									} else if (result.errors > 0) {
										new Notice(`⚠️ Encountered errors moving some files. Check developer console for details.`);
									} else {
										new Notice(`ℹ️ No artifact files found in "csv_view_artifacts" or files have already been moved.`);
									}
								} catch (err) {
									console.error('Error during artifact migration:', err);
									new Notice(`❌ Failed to move artifacts: ${String(err)}`);
								} finally {
									btn.setDisabled(false);
								}
							});
					})
					.addButton((btn) => {
						btn.setButtonText('Reset')
							.setTooltip('Reset folder path back to default (csv_view_artifacts)')
							.onClick(async () => {
								this.settings.csvArtifactFolderPath = 'csv_view_artifacts';
								if (folderTextInput) {
									folderTextInput.setValue('csv_view_artifacts');
								}
								await this.saveSettings();
								new Notice('🔄 Reset artifacts folder to "csv_view_artifacts".');
							});
					});
				artifactFolderSetting.settingEl.addClass('tablite-artifact-folder-setting');

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
						listContainer.createEl('div', {
							text: 'No custom calculation presets configured. Click "+ Add Calc Preset" to create one.',
							cls: 'tablite-calc-empty-note'
						});
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

		// 2. Explorer Additions & Split View (table-explorer)
		settingsTab.registerLocalSection({
			id: 'table-explorer',
			category: 'table',
			title: 'Explorer Additions',
			icon: 'rows-2',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Explorer Additions & Split View')
					.setDesc('Multi-pane split view for the Obsidian File Explorer with recent files, folder-qualified index.md titles, and customizable layout order.')
					.setHeading();

				new Setting(containerEl)
					.setName('Apply Explorer Split View')
					.setDesc('Enable split view in the File Explorer sidebar. When toggled off, the File Explorer returns to the original single-pane tree.')
					.addToggle((t) => {
						t.setValue(this.settings.explorerSplitEnabled === true)
							.onChange(async (val) => {
								this.settings.explorerSplitEnabled = val;
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyLayout();
								}
							});
					});

				new Setting(containerEl)
					.setName('Explorer Section Layout & Sorter')
					.setDesc('Customize the vertical layout order of file explorer components. Default: Header Control → Recent Files → Original Explorer.')
					.setHeading();

				const renderSectionOrderList = (parentEl: HTMLElement) => {
					parentEl.empty();
					const listEl = parentEl.createDiv({ cls: 'pakcli-section-order-list' });

					const currentOrder: ExplorerSectionId[] = (
						this.settings.explorerSectionOrder && this.settings.explorerSectionOrder.length === 3
							? this.settings.explorerSectionOrder
							: [...DEFAULT_EXPLORER_SECTION_ORDER]
					);

					currentOrder.forEach((secId, index) => {
						const info = EXPLORER_SECTIONS_INFO[secId];
						const rowEl = listEl.createDiv({ cls: 'pakcli-section-order-item' });

						// Left side (Drag handle + Badge + Names)
						const leftEl = rowEl.createDiv({ cls: 'pakcli-section-left' });
						const handle = leftEl.createDiv({ cls: 'pakcli-drag-handle' });
						setIcon(handle, 'grip-vertical');

						const badge = leftEl.createDiv({ cls: 'pakcli-section-badge' });
						badge.textContent = `${index + 1}`;

						const infoEl = leftEl.createDiv({ cls: 'pakcli-section-info' });
						const nameEl = infoEl.createSpan({ cls: 'pakcli-section-name' });
						nameEl.textContent = info ? info.name : secId;

						const descEl = infoEl.createSpan({ cls: 'pakcli-section-desc' });
						descEl.textContent = info ? info.description : '';

						// Right side (Up / Down controls)
						const rightEl = rowEl.createDiv({ cls: 'pakcli-section-right' });

						const upBtn = rightEl.createEl('button', { cls: 'clickable-icon' });
						setIcon(upBtn, 'arrow-up');
						upBtn.setAttribute('aria-label', 'Move Section Up');
						if (index === 0) {
							upBtn.disabled = true;
						} else {
							upBtn.addEventListener('click', async () => {
								const temp = currentOrder[index];
								currentOrder[index] = currentOrder[index - 1];
								currentOrder[index - 1] = temp;
								this.settings.explorerSectionOrder = [...currentOrder];
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyLayout();
								}
								renderSectionOrderList(parentEl);
							});
						}

						const downBtn = rightEl.createEl('button', { cls: 'clickable-icon' });
						setIcon(downBtn, 'arrow-down');
						downBtn.setAttribute('aria-label', 'Move Section Down');
						if (index === currentOrder.length - 1) {
							downBtn.disabled = true;
						} else {
							downBtn.addEventListener('click', async () => {
								const temp = currentOrder[index];
								currentOrder[index] = currentOrder[index + 1];
								currentOrder[index + 1] = temp;
								this.settings.explorerSectionOrder = [...currentOrder];
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyLayout();
								}
								renderSectionOrderList(parentEl);
							});
						}

						// HTML5 Drag and drop
						rowEl.setAttribute('draggable', 'true');
						rowEl.addEventListener('dragstart', (e) => {
							e.dataTransfer?.setData('text/plain', String(index));
						});
						rowEl.addEventListener('dragover', (e) => {
							e.preventDefault();
							rowEl.addClass('is-drag-over');
						});
						rowEl.addEventListener('dragleave', () => {
							rowEl.removeClass('is-drag-over');
						});
						rowEl.addEventListener('drop', async (e) => {
							e.preventDefault();
							rowEl.removeClass('is-drag-over');
							const fromIdx = parseInt(e.dataTransfer?.getData('text/plain') || '-1', 10);
							if (fromIdx !== -1 && fromIdx !== index) {
								const [moved] = currentOrder.splice(fromIdx, 1);
								currentOrder.splice(index, 0, moved);
								this.settings.explorerSectionOrder = [...currentOrder];
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyLayout();
								}
								renderSectionOrderList(parentEl);
							}
						});
					});

					// Reset button
					const footer = parentEl.createDiv({ cls: 'pakcli-section-footer' });
					new Setting(footer)
						.setName('Reset Section Order')
						.setDesc('Restore default layout: Header Control → Recent Files → Original Explorer.')
						.addButton((b) => {
							b.setButtonText('Reset Order to Default')
								.onClick(async () => {
									this.settings.explorerSectionOrder = [...DEFAULT_EXPLORER_SECTION_ORDER];
									await this.saveSettings();
									if (this.splitViewManager) {
										this.splitViewManager.applyLayout();
									}
									renderSectionOrderList(parentEl);
									new Notice('Explorer section order reset to default.');
								});
						});
				};

				const orderContainerEl = containerEl.createDiv();
				renderSectionOrderList(orderContainerEl);

				new Setting(containerEl)
					.setName('Recent Files Pane Preferences')
					.setHeading();

				new Setting(containerEl)
					.setName('Max Recent Files')
					.setDesc('Maximum number of recently opened files to display in the pane (5 - 50).')
					.addSlider((slider) => {
						slider.setLimits(5, 50, 5)
							.setValue(this.settings.explorerMaxRecentFiles || 20)
							.setDynamicTooltip()
							.onChange(async (val) => {
								this.settings.explorerMaxRecentFiles = val;
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.renderRecentList();
								}
							});
					});

				new Setting(containerEl)
					.setName('Recent Files Pane Height')
					.setDesc('Default height in pixels for the recent files section (also resizable by dragging the splitter bar).')
					.addText((text) => {
						text.setPlaceholder('180')
							.setValue(String(this.settings.explorerSplitHeight || 180))
							.onChange(async (val) => {
								const num = parseInt(val, 10);
								if (!isNaN(num) && num >= 70 && num <= 600) {
									this.settings.explorerSplitHeight = num;
									await this.saveSettings();
									if (this.splitViewManager) {
										this.splitViewManager.applyLayout();
									}
								}
							});
					});

				new Setting(containerEl)
					.setName('Show File Icons')
					.setDesc('Display file type icons (Markdown, Table, Canvas, Images) next to filenames.')
					.addToggle((t) => {
						t.setValue(this.settings.explorerRecentShowIcons !== false)
							.onChange(async (val) => {
								this.settings.explorerRecentShowIcons = val;
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.renderRecentList();
								}
							});
					});
			}
		});

		// 3. Tree Diagram & Hierarchy Explorer (table-tree)
		settingsTab.registerLocalSection({
			id: 'table-tree',
			category: 'table',
			title: 'Tree Diagram & Hierarchy Explorer',
			icon: 'folder-tree',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Tree Diagram & Hierarchy Explorer')
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
			}
		});

		settingsTab.registerLocalSection({
			id: 'table-asset-router',
			category: 'table',
			title: 'Asset Router & Attachments',
			icon: 'folder-input',
			isInstalled: true,
			render: (containerEl) => {
				const pluginSettings = this.settings;
				const saveSettings = async () => await this.saveSettings();

				new Setting(containerEl)
					.setName('Asset Router & Attachment Manager')
					.setDesc('Automatic attachment routing, centralized media vault, Captain Folders nested mode, and note link auto-updating.')
					.setHeading();

				// 1. Centralized Mode
				new Setting(containerEl).setName('Centralized Mode (Default)').setHeading();

				new Setting(containerEl)
					.setName('Enable Centralized Routing')
					.setDesc('Route all attachments to a single global directory by default.')
					.addToggle(toggle => toggle
						.setValue(pluginSettings.centralAssetFolderEnabled)
						.onChange(async (value) => {
							pluginSettings.centralAssetFolderEnabled = value;
							await saveSettings();
						}));

				new Setting(containerEl)
					.setName('Central Asset Folder')
					.setDesc('Directory at the vault root where default assets will be saved.')
					.addText(text => {
						text.setPlaceholder('assets')
							.setValue(pluginSettings.centralAssetFolder || 'assets')
							.onChange(async (value) => {
								pluginSettings.centralAssetFolder = value.trim() || 'assets';
								await saveSettings();
							});
						new FolderSuggest(this.app, text.inputEl);
					});

				new Setting(containerEl)
					.setName('Use Note Title in Centralized Mode')
					.setDesc('Use note frontmatter "title" property when renaming attachments instead of filename.')
					.addToggle(toggle => toggle
						.setValue(pluginSettings.useNoteTitleGlobalCentral)
						.onChange(async (value) => {
							pluginSettings.useNoteTitleGlobalCentral = value;
							await saveSettings();
						}));

				new Setting(containerEl)
					.setName('Rescan Centralized Assets')
					.setDesc('Scan the vault and organize all attachments for notes in Centralized Mode (excluding Captain Folders).')
					.addButton(button => button
						.setButtonText('Rescan Centralized')
						.onClick(async () => {
							button.setDisabled(true);
							await this.router.rescanCentralizedAssets();
							button.setDisabled(false);
						}));

				// 2. Global Nested Mode Settings
				new Setting(containerEl).setName('Nested Mode Globals').setHeading();

				new Setting(containerEl)
					.setName('Use Note Title in Nested Mode (Default)')
					.setDesc('Default setting for Captain Folders to use frontmatter "title" property.')
					.addToggle(toggle => toggle
						.setValue(pluginSettings.useNoteTitleGlobalNested)
						.onChange(async (value) => {
							pluginSettings.useNoteTitleGlobalNested = value;
							await saveSettings();
						}));

				new Setting(containerEl)
					.setName('Path Delimiter')
					.setDesc('Character used to join directories and file titles.')
					.addDropdown(dropdown => dropdown
						.addOption('-', '-')
						.addOption('_', '_')
						.setValue(pluginSettings.delimiter || '-')
						.onChange(async (value) => {
							pluginSettings.delimiter = value;
							await saveSettings();
						}));

				new Setting(containerEl)
					.setName('Monitored File Extensions')
					.setDesc('Comma-separated list of file extensions that the plugin should route.')
					.addTextArea(text => text
						.setPlaceholder('png, jpg, jpeg, pdf')
						.setValue((pluginSettings.assetExtensions || []).join(', '))
						.onChange(async (value) => {
							pluginSettings.assetExtensions = value
								.split(',')
								.map(ext => ext.trim().toLowerCase())
								.filter(ext => ext !== '');
							await saveSettings();
						}));

				// 3. Captain Folders (Rules) Settings
				new Setting(containerEl).setName('Nested Mode Override Rules (Captain Folders)').setHeading();

				const bulkContainer = containerEl.createDiv({ cls: 'asset-router-bulk-container' });
				bulkContainer.style.marginBottom = '10px';

				new ButtonComponent(bulkContainer)
					.setButtonText('Turn On All Rules')
					.setCta()
					.onClick(() => {
						new ConfirmModal(
							this.app,
							'Are you sure you want to enable ALL Captain Folder rules?',
							async () => {
								(pluginSettings.rules || []).forEach(r => r.enabled = true);
								await saveSettings();
								renderRulesTable();
								new Notice('All rules enabled');
							}
						).open();
					});

				const turnOffBtn = new ButtonComponent(bulkContainer)
					.setButtonText('Turn Off All Rules')
					.onClick(() => {
						new ConfirmModal(
							this.app,
							'Are you sure you want to disable ALL Captain Folder rules?',
							async () => {
								(pluginSettings.rules || []).forEach(r => r.enabled = false);
								await saveSettings();
								renderRulesTable();
								new Notice('All rules disabled');
							}
						).open();
					});
				turnOffBtn.buttonEl.style.marginLeft = '10px';

				const rescanAllBtn = new ButtonComponent(bulkContainer)
					.setButtonText('Rescan All Nested')
					.onClick(async () => {
						rescanAllBtn.setDisabled(true);
						await this.router.rescanAllNestedAssets();
						rescanAllBtn.setDisabled(false);
					});
				rescanAllBtn.buttonEl.style.marginLeft = '10px';

				// Form to add new rule
				new Setting(containerEl).setName('Add New Captain Folder Rule').setHeading();
				const addRuleDiv = containerEl.createDiv();
				addRuleDiv.style.border = '1px solid var(--background-modifier-border)';
				addRuleDiv.style.padding = '15px';
				addRuleDiv.style.borderRadius = '8px';
				addRuleDiv.style.marginBottom = '20px';

				let newPath = '';
				let newScope = 'children';
				let newSubCaptain = false;
				let newTitleOverride: TitleOverrideOption = 'inherit';

				new Setting(addRuleDiv)
					.setName('Folder Path')
					.setDesc('Relative path from vault root (e.g. folderb or folderb/*)')
					.addText(text => {
						text.setPlaceholder('e.g. folderb/projects')
							.onChange(value => newPath = value.trim());
						new FolderSuggest(this.app, text.inputEl);
					});

				new Setting(addRuleDiv)
					.setName('Rule Scope')
					.setDesc('Should this rule apply to subfolders too?')
					.addDropdown(dropdown => dropdown
						.addOption('folder', 'Folder Only (Exclude Children)')
						.addOption('children', 'Include Children')
						.setValue(newScope)
						.onChange(value => newScope = value));

				new Setting(addRuleDiv)
					.setName('Auto Sub-Captain Mode')
					.setDesc('Treat each subfolder under this Captain Folder as an independent Sub-Captain with its own assets/ directory.')
					.addToggle(toggle => toggle
						.setValue(newSubCaptain)
						.onChange(value => newSubCaptain = value));

				new Setting(addRuleDiv)
					.setName('Note Title Override')
					.setDesc('How to handle Note Title frontmatter parsing for this folder.')
					.addDropdown(dropdown => dropdown
						.addOption('inherit', 'Inherit Default')
						.addOption('always', 'Always Use Title')
						.addOption('never', 'Never Use Title')
						.setValue(newTitleOverride)
						.onChange((value: string) => newTitleOverride = value as TitleOverrideOption));

				const addBtnContainer = addRuleDiv.createDiv();
				addBtnContainer.style.textAlign = 'right';
				addBtnContainer.style.marginTop = '10px';

				const rulesTableContainer = containerEl.createDiv({ cls: 'asset-router-rules-table-container' });

				const renderRulesTable = () => {
					rulesTableContainer.empty();
					if (!pluginSettings.rules || pluginSettings.rules.length === 0) {
						rulesTableContainer.createEl('p', { text: 'No Captain Folder rules configured yet.', cls: 'setting-item-description' });
						return;
					}

					const table = rulesTableContainer.createEl('table');
					table.style.width = '100%';
					const thead = table.createEl('thead');
					const headerRow = thead.createEl('tr');
					headerRow.createEl('th', { text: 'Active' });
					headerRow.createEl('th', { text: 'Folder Path' });
					headerRow.createEl('th', { text: 'Scope' });
					headerRow.createEl('th', { text: 'Sub-Captain' });
					headerRow.createEl('th', { text: 'Title' });
					headerRow.createEl('th', { text: 'Actions' });

					const tbody = table.createEl('tbody');
					pluginSettings.rules.forEach((rule, idx) => {
						const row = tbody.createEl('tr');
						const activeTd = row.createEl('td');
						const toggle = activeTd.createEl('input');
						toggle.type = 'checkbox';
						toggle.checked = rule.enabled;
						toggle.onchange = async () => {
							rule.enabled = toggle.checked;
							await saveSettings();
						};

						row.createEl('td', { text: rule.path === '' ? '/' : rule.path });
						row.createEl('td', { text: rule.includeChildren ? 'Children' : 'Folder' });
						row.createEl('td', { text: rule.subCaptainMode ? 'Yes' : 'No' });
						row.createEl('td', { text: rule.useNoteTitle });

						const actionsTd = row.createEl('td');
						const rescanBtn = new ButtonComponent(actionsTd)
							.setButtonText('Rescan')
							.onClick(async () => {
								rescanBtn.setDisabled(true);
								await this.router.rescanFolderRuleAssets(rule);
								rescanBtn.setDisabled(false);
							});
						rescanBtn.buttonEl.style.marginRight = '8px';

						const delBtn = new ButtonComponent(actionsTd)
							.setButtonText('Delete')
							.setWarning()
							.onClick(async () => {
								pluginSettings.rules.splice(idx, 1);
								await saveSettings();
								renderRulesTable();
							});
					});
				};

				new ButtonComponent(addBtnContainer)
					.setButtonText('Add Rule')
					.setCta()
					.onClick(async () => {
						if (!pluginSettings.rules) pluginSettings.rules = [];
						pluginSettings.rules.push({
							path: newPath,
							isNested: true,
							includeChildren: newScope === 'children',
							subCaptainMode: newSubCaptain,
							useNoteTitle: newTitleOverride,
							enabled: true,
						});
						await saveSettings();
						renderRulesTable();
						new Notice(`Rule added: ${newPath || '/'}`);
					});

				renderRulesTable();
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
					.setName('Default Codeblock Wrap & Flow Mode')
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
								this.codeblockScaler.scheduleRescale();
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

				new Setting(containerEl)
					.setName('Per-Language Rules')
					.setDesc('Customize behavior for specific languages (e.g., ascii, python, sql, markdown).')
					.setHeading();

				const rulesBox = containerEl.createDiv({ cls: 'pakcli-codeblock-rules-section' });

				const renderLangRules = () => {
					rulesBox.empty();
					const rules = this.settings.codeblockLanguageRules || [];

					if (rules.length === 0) {
						rulesBox.createEl('p', {
							text: 'No per-language rules configured. Default wrap mode applies to all languages.',
							cls: 'setting-item-description'
						});
					} else {
						const table = rulesBox.createEl('table');
						table.style.width = '100%';
						table.style.marginBottom = '12px';
						const thead = table.createEl('thead');
						const hRow = thead.createEl('tr');
						hRow.createEl('th', { text: 'Language' });
						hRow.createEl('th', { text: 'Behavior' });
						hRow.createEl('th', { text: 'Actions' });

						const tbody = table.createEl('tbody');
						rules.forEach((rule, idx) => {
							const row = tbody.createEl('tr');
							row.createEl('td', { text: rule.language });

							const behaviorTd = row.createEl('td');
							const sel = behaviorTd.createEl('select', { cls: 'dropdown' });
							sel.createEl('option', { text: 'Scale Fit (Auto Vector)', value: 'scalefit' }).selected = rule.behavior === 'scalefit';
							sel.createEl('option', { text: 'Flow Clip (Scrollbar)', value: 'flowclip' }).selected = rule.behavior === 'flowclip';
							sel.createEl('option', { text: 'Word Wrap', value: 'wrap' }).selected = rule.behavior === 'wrap';
							sel.onchange = async () => {
								rule.behavior = sel.value as 'scalefit' | 'flowclip' | 'wrap';
								await this.saveSettings();
								this.codeblockScaler.scheduleRescale();
							};

							const actTd = row.createEl('td');
							const delBtn = new ButtonComponent(actTd)
								.setButtonText('Delete')
								.setWarning()
								.onClick(async () => {
									this.settings.codeblockLanguageRules.splice(idx, 1);
									await this.saveSettings();
									this.codeblockScaler.scheduleRescale();
									renderLangRules();
								});
						});
					}

					// Add new rule form
					let newLang = '';
					let newBehavior: 'scalefit' | 'flowclip' | 'wrap' = 'scalefit';

					new Setting(rulesBox)
						.setName('Add Language Rule')
						.setDesc('Define a custom behavior for a specific language tag.')
						.addText((t) => {
							t.setPlaceholder('e.g. ascii, python, sql')
								.onChange((v) => { newLang = v.trim().toLowerCase(); });
						})
						.addDropdown((d) => {
							d.addOption('scalefit', 'Scale Fit')
								.addOption('flowclip', 'Flow Clip')
								.addOption('wrap', 'Word Wrap')
								.setValue(newBehavior)
								.onChange((v) => { newBehavior = v as 'scalefit' | 'flowclip' | 'wrap'; });
						})
						.addButton((b) => {
							b.setButtonText('+ Add Rule')
								.setCta()
								.onClick(async () => {
									if (!newLang) {
										new Notice('Please enter a language identifier.');
										return;
									}
									if (!this.settings.codeblockLanguageRules) {
										this.settings.codeblockLanguageRules = [];
									}
									this.settings.codeblockLanguageRules.push({
										id: String(Date.now()),
										language: newLang,
										behavior: newBehavior
									});
									await this.saveSettings();
									this.codeblockScaler.scheduleRescale();
									renderLangRules();
									new Notice(`Added rule for "${newLang}".`);
								});
						});
				};

				renderLangRules();
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
import { AssetRouterSettings } from './features/tree/types';
import { TablitePluginData as SQLSealSettings, DEFAULT_PLUGIN_DATA as DEFAULT_SQLSEAL_SETTINGS } from './features/sqlseal/types';
import { BasesLeafletViewSettings } from './features/leaflet/types';
import { CodeblockLanguageRule } from './features/codeblock/scaler';

export type BubbleGraphIntegrationMode = 'deactivate' | 'replace' | 'second';

export interface BubbleGraphSettings {
    bubbleGraphMode: BubbleGraphIntegrationMode;
    bubbleRibbonIcon: string;
    bubbleMaxDragDepth: number;
    bubbleDefaultLayout: 'bubble' | 'default';
    bubbleHullOpacity: number;
    bubbleShowLabels: boolean;
    bubbleShowLines: boolean;
    bubbleShowVennBridges: boolean;
    bubbleIntraLinkOpacity: number;
    bubbleInterLinkGlow: boolean;
    bubbleClusterPadding: number;
    bubbleTimelapseMode: 'date' | 'vanilla';
    bubbleTimelapseVanillaSpeed: number;
}

export interface PakCLITableSettings extends 
    AssetRouterSettings, 
    SQLSealSettings, 
    BasesLeafletViewSettings,
    BubbleGraphSettings 
{
    dateFormat: string;
    codeblockWrapMode: 'flowclip' | 'wrap' | 'scalefit';
    codeblockLanguageRules: CodeblockLanguageRule[];
    enableAssetDrag: boolean;
}

export const DEFAULT_ASSET_ROUTER_SETTINGS: AssetRouterSettings = {
	centralAssetFolderEnabled: true,
	centralAssetFolder: "assets",
	useNoteTitleGlobalCentral: false,
	useNoteTitleGlobalNested: false,
	rules: [],
	delimiter: "_",
	assetExtensions: ["png", "jpg", "jpeg", "gif", "svg", "pdf", "mp3", "mp4", "wav", "webm", "ogg", "m4a", "xls", "xlsx", "doc", "docx", "zip", "tar", "gz"]
};

export const DEFAULT_LEAFLET_SETTINGS: BasesLeafletViewSettings = {
    enableMeasureTool: true,
    enableCopyTool: true,
    iconData: [],
    defaultOsm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileTheme: "auto"
};

export const DEFAULT_BUBBLE_GRAPH_SETTINGS: BubbleGraphSettings = {
    bubbleGraphMode: 'second',
    bubbleRibbonIcon: 'circle-dot',
    bubbleMaxDragDepth: 2,
    bubbleDefaultLayout: 'bubble',
    bubbleHullOpacity: 0.12,
    bubbleShowLabels: true,
    bubbleShowLines: true,
    bubbleShowVennBridges: true,
    bubbleIntraLinkOpacity: 0.2,
    bubbleInterLinkGlow: true,
    bubbleClusterPadding: 40,
    bubbleTimelapseMode: 'date',
    bubbleTimelapseVanillaSpeed: 0.025,
};

export const DEFAULT_TABLE_SETTINGS: PakCLITableSettings = {
    ...DEFAULT_ASSET_ROUTER_SETTINGS,
    ...DEFAULT_SQLSEAL_SETTINGS,
    ...DEFAULT_LEAFLET_SETTINGS,
    ...DEFAULT_BUBBLE_GRAPH_SETTINGS,
    dateFormat: '_{yyyy}{mm}{dd}',
    codeblockWrapMode: 'flowclip',
    codeblockLanguageRules: [
        { id: '1', language: 'asci', behavior: 'scalefit' },
        { id: '2', language: 'ascii', behavior: 'scalefit' }
    ],
    enableAssetDrag: true,
};


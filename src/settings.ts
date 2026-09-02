import { AssetRouterSettings } from './features/tree/types';
import { TablitePluginData as SQLSealSettings, DEFAULT_PLUGIN_DATA as DEFAULT_SQLSEAL_SETTINGS } from './features/sqlseal/types';
import { BasesLeafletViewSettings } from './features/leaflet/types';
import { CodeblockLanguageRule } from './features/codeblock/scaler';

export interface PakCLITableSettings extends 
    AssetRouterSettings, 
    SQLSealSettings, 
    BasesLeafletViewSettings 
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

export const DEFAULT_TABLE_SETTINGS: PakCLITableSettings = {
    ...DEFAULT_ASSET_ROUTER_SETTINGS,
    ...DEFAULT_SQLSEAL_SETTINGS,
    ...DEFAULT_LEAFLET_SETTINGS,
    dateFormat: '_{yyyy}{mm}{dd}',
    codeblockWrapMode: 'flowclip',
    codeblockLanguageRules: [
        { id: '1', language: 'asci', behavior: 'scalefit' },
        { id: '2', language: 'ascii', behavior: 'scalefit' }
    ],
    enableAssetDrag: true,
};

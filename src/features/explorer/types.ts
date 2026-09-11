export type ExplorerSectionId = 'header-control' | 'recent' | 'explorer-original';

export interface ExplorerSectionInfo {
  id: ExplorerSectionId;
  name: string;
  description: string;
  icon: string;
}

export const EXPLORER_SECTIONS_INFO: Record<ExplorerSectionId, ExplorerSectionInfo> = {
  'header-control': {
    id: 'header-control',
    name: 'Explorer Header Controls',
    description: 'Navigation header containing New Note, New Folder, and action buttons',
    icon: 'sliders-horizontal',
  },
  'recent': {
    id: 'recent',
    name: 'Recent Files Pane',
    description: 'Quick-access list of recently opened files with folder-qualified index.md titles',
    icon: 'clock',
  },
  'explorer-original': {
    id: 'explorer-original',
    name: 'Original File Explorer Tree',
    description: 'Default Obsidian vault folder hierarchy and file navigation tree',
    icon: 'folder-tree',
  },
};

export const DEFAULT_EXPLORER_SECTION_ORDER: ExplorerSectionId[] = [
  'header-control',
  'recent',
  'explorer-original',
];

export type RecentTimeFilter =
  | 'all'
  | '15m'
  | '1h'
  | '12h'
  | 'today'
  | '1m'
  | '3m'
  | '6m'
  | '12m'
  | '36m';

export interface RecentTimeFilterOption {
  id: RecentTimeFilter;
  label: string;
  durationMs: number | 'today' | 'all';
}

export const RECENT_TIME_FILTER_OPTIONS: RecentTimeFilterOption[] = [
  { id: 'all', label: 'All Recent', durationMs: 'all' },
  { id: '15m', label: 'Last 15 min', durationMs: 15 * 60 * 1000 },
  { id: '1h', label: 'Last 1 hour', durationMs: 60 * 60 * 1000 },
  { id: '12h', label: 'Last 12 hours', durationMs: 12 * 60 * 60 * 1000 },
  { id: 'today', label: 'Today', durationMs: 'today' },
  { id: '1m', label: '1 month', durationMs: 30 * 24 * 60 * 60 * 1000 },
  { id: '3m', label: '3 months', durationMs: 90 * 24 * 60 * 60 * 1000 },
  { id: '6m', label: '6 months', durationMs: 180 * 24 * 60 * 60 * 1000 },
  { id: '12m', label: '12 months', durationMs: 365 * 24 * 60 * 60 * 1000 },
  { id: '36m', label: '36 months', durationMs: 36 * 30 * 24 * 60 * 60 * 1000 },
];

export interface ExplorerSettings {
  explorerSplitEnabled: boolean;
  explorerSectionOrder: ExplorerSectionId[];
  explorerSplitHeight: number;
  explorerMaxRecentFiles: number;
  explorerRecentShowIcons: boolean;
  explorerRecentTimeFilter?: RecentTimeFilter;
  recentsArtifactFolderPath: string;
  customRecentPaths?: string[];
  activeRecentFolderFilter?: string;
  backlogFolderPath?: string;
  enableBaseExplorerMode?: boolean;
  baseExplorerActive?: boolean;
  enableAutoFolderIndex?: boolean;
  folderIndexPrefix?: string;
  folderIndexSuffix?: string;
  folderIndexUseTimestamp?: boolean;
  carouselOrientation?: 'horizontal' | 'vertical';
}

export const DEFAULT_EXPLORER_SETTINGS: ExplorerSettings = {
  explorerSplitEnabled: false,
  explorerSectionOrder: [...DEFAULT_EXPLORER_SECTION_ORDER],
  explorerSplitHeight: 180,
  explorerMaxRecentFiles: 20,
  explorerRecentShowIcons: false,
  explorerRecentTimeFilter: 'all',
  recentsArtifactFolderPath: 'artifacts/pakcli-table',
  customRecentPaths: [],
  activeRecentFolderFilter: '',
  backlogFolderPath: 'Backlog',
  enableBaseExplorerMode: false,
  baseExplorerActive: false,
  enableAutoFolderIndex: false,
  folderIndexPrefix: '',
  folderIndexSuffix: '',
  folderIndexUseTimestamp: false,
  carouselOrientation: 'horizontal',
};


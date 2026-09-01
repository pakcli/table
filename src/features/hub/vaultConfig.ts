import { App } from "obsidian";

const VAULT_CONFIG_DIR = ".obsidian/plugins/pakcli-vault-config";
const SNAPSHOTS_DIR = `${VAULT_CONFIG_DIR}/snapshots`;

export interface VaultConfigPayload {
  plugin: "pakcli-local" | "pakcli-table" | "pakcli-agent";
  version: string;
  lastSaved: string;
  name?: string;
  settings: Record<string, any>;
}

export interface SnapshotItem {
  id: string;
  name: string;
  path: string;
  date: string;
}

/**
 * Ensures the pakcli-vault-config directory exists
 */
async function ensureConfigDir(app: App): Promise<void> {
  try {
    if (!(await app.vault.adapter.exists(VAULT_CONFIG_DIR))) {
      await app.vault.adapter.mkdir(VAULT_CONFIG_DIR);
    }
    if (!(await app.vault.adapter.exists(SNAPSHOTS_DIR))) {
      await app.vault.adapter.mkdir(SNAPSHOTS_DIR);
    }
  } catch (err) {
    console.error("[VaultConfig] Error creating directories:", err);
  }
}

/**
 * Lists all available snapshots for a plugin
 */
export async function listVaultSnapshots(
  app: App,
  pluginName: "pakcli-local" | "pakcli-table" | "pakcli-agent"
): Promise<SnapshotItem[]> {
  await ensureConfigDir(app);
  const prefix = pluginName.replace("pakcli-", "");
  const list: SnapshotItem[] = [];

  const latestPath = `${VAULT_CONFIG_DIR}/latest-${prefix}.json`;
  if (await app.vault.adapter.exists(latestPath)) {
    list.push({
      id: "latest",
      name: "Latest Backup (Active)",
      path: latestPath,
      date: "Latest"
    });
  }

  try {
    const files = await app.vault.adapter.list(SNAPSHOTS_DIR);
    // Sort reverse chronological
    const sortedFiles = files.files.sort().reverse();
    for (const f of sortedFiles) {
      if (f.includes(`/${prefix}-`) && f.endsWith('.json')) {
        const base = f.split('/').pop()?.replace('.json', '') || f;
        const stamp = base.replace(`${prefix}-`, '');
        list.push({
          id: f,
          name: `Snapshot (${stamp})`,
          path: f,
          date: stamp
        });
      }
    }
  } catch (err) {
    console.error("[VaultConfig] Error listing snapshots:", err);
  }

  if (list.length === 0) {
    list.push({
      id: "default",
      name: "Default Preset",
      path: "",
      date: "Preset"
    });
  }

  return list;
}

/**
 * Save settings snapshot to pakcli-vault-config (Rotates 1 snapshot per hour)
 */
export async function saveVaultConfig(
  app: App,
  pluginName: "pakcli-local" | "pakcli-table" | "pakcli-agent",
  settings: Record<string, any>,
  customName?: string
): Promise<void> {
  await ensureConfigDir(app);

  const payload: VaultConfigPayload = {
    plugin: pluginName,
    version: "1.0.0",
    lastSaved: new Date().toISOString(),
    name: customName,
    settings,
  };

  const prefix = pluginName.replace("pakcli-", "");
  const latestPath = `${VAULT_CONFIG_DIR}/latest-${prefix}.json`;
  const jsonStr = JSON.stringify(payload, null, 2);

  try {
    // 1. Always write to latest
    await app.vault.adapter.write(latestPath, jsonStr);

    // 2. Write to hourly snapshot file (1 new snapshot per 1 hour)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const hourlyStamp = `${year}-${month}-${day}_${hour}h00`;

    const snapPath = customName 
      ? `${SNAPSHOTS_DIR}/${prefix}-${customName}-${hourlyStamp}_${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}.json`
      : `${SNAPSHOTS_DIR}/${prefix}-${hourlyStamp}.json`;

    await app.vault.adapter.write(snapPath, jsonStr);
  } catch (err) {
    console.error(`[VaultConfig] Error writing config for ${pluginName}:`, err);
  }
}

/**
 * Load saved settings by path or latest
 */
export async function loadVaultConfig(
  app: App,
  pluginName: "pakcli-local" | "pakcli-table" | "pakcli-agent",
  targetPath?: string
): Promise<Record<string, any> | null> {
  const filePath = targetPath || `${VAULT_CONFIG_DIR}/latest-${pluginName.replace("pakcli-", "")}.json`;
  try {
    if (await app.vault.adapter.exists(filePath)) {
      const raw = await app.vault.adapter.read(filePath);
      const parsed = JSON.parse(raw) as VaultConfigPayload;
      return parsed.settings || null;
    }
  } catch (err) {
    console.error(`[VaultConfig] Error reading config from ${filePath}:`, err);
  }
  return null;
}

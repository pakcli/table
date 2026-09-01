import { App } from "obsidian";

const VAULT_CONFIG_DIR = ".obsidian/plugins/pakcli-vault-config";
const SNAPSHOTS_DIR = `${VAULT_CONFIG_DIR}/snapshots`;

export interface VaultConfigPayload {
  plugin: "pakcli-local" | "pakcli-table" | "pakcli-agent";
  version: string;
  lastSaved: string;
  settings: Record<string, any>;
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
 * Save settings snapshot to pakcli-vault-config
 */
export async function saveVaultConfig(
  app: App,
  pluginName: "pakcli-local" | "pakcli-table" | "pakcli-agent",
  settings: Record<string, any>
): Promise<void> {
  await ensureConfigDir(app);

  const payload: VaultConfigPayload = {
    plugin: pluginName,
    version: "1.0.0",
    lastSaved: new Date().toISOString(),
    settings,
  };

  const latestPath = `${VAULT_CONFIG_DIR}/latest-${pluginName.replace("pakcli-", "")}.json`;
  const jsonStr = JSON.stringify(payload, null, 2);

  try {
    await app.vault.adapter.write(latestPath, jsonStr);

    // Also write timestamped snapshot
    const now = new Date();
    const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
    const snapPath = `${SNAPSHOTS_DIR}/${pluginName.replace("pakcli-", "")}-${dateStamp}.json`;
    await app.vault.adapter.write(snapPath, jsonStr);
  } catch (err) {
    console.error(`[VaultConfig] Error writing config for ${pluginName}:`, err);
  }
}

/**
 * Load latest saved settings from pakcli-vault-config (used on fresh install or auto-restore)
 */
export async function loadVaultConfig(
  app: App,
  pluginName: "pakcli-local" | "pakcli-table" | "pakcli-agent"
): Promise<Record<string, any> | null> {
  const latestPath = `${VAULT_CONFIG_DIR}/latest-${pluginName.replace("pakcli-", "")}.json`;
  try {
    if (await app.vault.adapter.exists(latestPath)) {
      const raw = await app.vault.adapter.read(latestPath);
      const parsed = JSON.parse(raw) as VaultConfigPayload;
      return parsed.settings || null;
    }
  } catch (err) {
    console.error(`[VaultConfig] Error reading config for ${pluginName}:`, err);
  }
  return null;
}

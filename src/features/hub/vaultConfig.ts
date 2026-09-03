import { App } from "obsidian";

function getVaultConfigDir(app: App): string {
  const configDir = (app.vault as { configDir?: string }).configDir || ".obsidian";
  return `${configDir}/plugins/pakcli-vault-config`;
}

function getSnapshotsDir(app: App): string {
  return `${getVaultConfigDir(app)}/snapshots`;
}

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
  timestamp: number;
}

/**
 * Formats relative time (e.g. "23 jam lalu", "15 menit lalu", "2 hari lalu")
 */
export function formatRelativeSnapshotTime(isoOrStamp: string): string {
  let date: Date;

  // Check if standard ISO date string
  if (isoOrStamp.includes("T") || isoOrStamp.includes("-")) {
    const parsed = new Date(isoOrStamp);
    if (!isNaN(parsed.getTime())) {
      date = parsed;
    } else {
      // Parse custom stamp: YYYY-MM-DD_HHh00
      const match = isoOrStamp.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})h?(\d{2})?/);
      if (match) {
        date = new Date(
          parseInt(match[1]),
          parseInt(match[2]) - 1,
          parseInt(match[3]),
          parseInt(match[4]),
          match[5] ? parseInt(match[5]) : 0
        );
      } else {
        return isoOrStamp;
      }
    }
  } else {
    return isoOrStamp;
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

  if (diffSec < 60) {
    return `Baru saja (${timeStr})`;
  }
  if (diffMin < 60) {
    return `${diffMin} menit lalu (${timeStr})`;
  }
  if (diffHours < 24) {
    return `${diffHours} jam lalu (${timeStr})`;
  }
  if (diffDays === 1) {
    return `Kemarin (${timeStr})`;
  }
  return `${diffDays} hari lalu (${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")})`;
}

/**
 * Ensures the pakcli-vault-config directory exists
 */
async function ensureConfigDir(app: App): Promise<void> {
  try {
    if (!(await app.vault.adapter.exists(getVaultConfigDir(app)))) {
      await app.vault.adapter.mkdir(getVaultConfigDir(app));
    }
    if (!(await app.vault.adapter.exists(getSnapshotsDir(app)))) {
      await app.vault.adapter.mkdir(getSnapshotsDir(app));
    }
  } catch (err) {
    console.error("[VaultConfig] Error creating directories:", err);
  }
}

/**
 * Lists all available snapshots for a plugin with relative human-readable times
 */
export async function listVaultSnapshots(
  app: App,
  pluginName: "pakcli-local" | "pakcli-table" | "pakcli-agent"
): Promise<SnapshotItem[]> {
  await ensureConfigDir(app);
  const prefix = pluginName.replace("pakcli-", "");
  const list: SnapshotItem[] = [];

  const latestPath = `${getVaultConfigDir(app)}/latest-${prefix}.json`
  if (await app.vault.adapter.exists(latestPath)) {
    try {
      const raw = await app.vault.adapter.read(latestPath);
      const parsed = JSON.parse(raw) as VaultConfigPayload;
      const relTime = parsed.lastSaved ? formatRelativeSnapshotTime(parsed.lastSaved) : "Aktif";
      const ts = parsed.lastSaved ? new Date(parsed.lastSaved).getTime() : Date.now();
      list.push({
        id: "latest",
        name: `Latest Backup (${relTime})`,
        path: latestPath,
        date: parsed.lastSaved || "Latest",
        timestamp: ts
      });
    } catch {
      list.push({
        id: "latest",
        name: "Latest Backup (Active)",
        path: latestPath,
        date: "Latest",
        timestamp: Date.now()
      });
    }
  }

  try {
    const files = await app.vault.adapter.list(getSnapshotsDir(app));
    for (const f of files.files) {
      if (f.includes(`/${prefix}-`) && f.endsWith('.json')) {
        const base = f.split('/').pop()?.replace('.json', '') || f;
        const stamp = base.replace(`${prefix}-`, '');

        let isoDate = stamp;
        let ts = 0;
        try {
          const raw = await app.vault.adapter.read(f);
          const parsed = JSON.parse(raw) as VaultConfigPayload;
          if (parsed.lastSaved) {
            isoDate = parsed.lastSaved;
            ts = new Date(parsed.lastSaved).getTime();
          }
        } catch {
          // fallback to stamp
        }

        const relTime = formatRelativeSnapshotTime(isoDate);

        list.push({
          id: f,
          name: `Snapshot (${relTime})`,
          path: f,
          date: stamp,
          timestamp: ts || 0
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
      date: "Preset",
      timestamp: 0
    });
  }

  // Sort list: "latest" first, then newest snapshots first
  list.sort((a, b) => {
    if (a.id === "latest") return -1;
    if (b.id === "latest") return 1;
    return b.timestamp - a.timestamp;
  });

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

  const now = new Date();
  const payload: VaultConfigPayload = {
    plugin: pluginName,
    version: "1.0.0",
    lastSaved: now.toISOString(),
    name: customName,
    settings,
  };

  const prefix = pluginName.replace("pakcli-", "");
  const latestPath = `${getVaultConfigDir(app)}/latest-${prefix}.json`
  const jsonStr = JSON.stringify(payload, null, 2);

  try {
    // 1. Always update latest
    await app.vault.adapter.write(latestPath, jsonStr);

    // 2. Write to hourly snapshot file
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const hourlyStamp = `${year}-${month}-${day}_${hour}h00`;

    const snapPath = customName 
      ? `${getSnapshotsDir(app)}/${prefix}-${customName}-${hourlyStamp}_${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}.json`
      : `${getSnapshotsDir(app)}/${prefix}-${hourlyStamp}.json`

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
  const filePath = targetPath || `${getVaultConfigDir(app)}/latest-${pluginName.replace("pakcli-", "")}.json`
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

import { getNodeFs, getNodeChildProcess, PathUtils } from "../../utils/nodeHelpers";

export interface SystemHealthStatus {
  powershell: {
    status: "ok" | "warning" | "error";
    version?: string;
    details: string;
  };
  symlink: {
    status: "ok" | "warning" | "error";
    devMode: boolean;
    details: string;
  };
  ytdlp: {
    status: "ok" | "warning" | "error";
    path?: string;
    version?: string;
    details: string;
  };
}

/**
 * Runs quick system health diagnostics for PakCLI Local
 */
export async function runSystemDiagnostics(customYtDlpPath?: string): Promise<SystemHealthStatus> {
  const result: SystemHealthStatus = {
    powershell: { status: "error", details: "PowerShell not detected" },
    symlink: { status: "warning", devMode: false, details: "Testing symlink privileges..." },
    ytdlp: { status: "warning", details: "yt-dlp binary not found" },
  };

  const cp = getNodeChildProcess();
  const fs = getNodeFs();

  if (!cp) {
    result.powershell.details = "Node child_process not available (Desktop required)";
    return result;
  }

  // 1. Check PowerShell
  try {
    const pwshOutput = await execAsync(cp, "pwsh -NoProfile -Command $PSVersionTable.PSVersion.ToString()");
    result.powershell = {
      status: "ok",
      version: pwshOutput.trim(),
      details: `PowerShell Core ${pwshOutput.trim()} detected`,
    };
  } catch {
    try {
      const winPsOutput = await execAsync(cp, "powershell -NoProfile -Command $PSVersionTable.PSVersion.ToString()");
      result.powershell = {
        status: "ok",
        version: winPsOutput.trim(),
        details: `Windows PowerShell ${winPsOutput.trim()} detected`,
      };
    } catch (e: any) {
      result.powershell = {
        status: "error",
        details: `Failed to execute PowerShell: ${e?.message || e}`,
      };
    }
  }

  // 2. Check Symlink Privileges (Windows Developer Mode)
  if (fs) {
    try {
      const testSrc = PathUtils.join(process.cwd(), ".symlink-test-src.tmp");
      const testDst = PathUtils.join(process.cwd(), ".symlink-test-dst.tmp");
      try {
        fs.writeFileSync(testSrc, "test");
        fs.symlinkSync(testSrc, testDst, "file");
        result.symlink = {
          status: "ok",
          devMode: true,
          details: "Developer Mode active (Unprivileged symlinks supported)",
        };
        fs.unlinkSync(testDst);
        fs.unlinkSync(testSrc);
      } catch (err: any) {
        if (fs.existsSync(testSrc)) fs.unlinkSync(testSrc);
        if (fs.existsSync(testDst)) fs.unlinkSync(testDst);
        result.symlink = {
          status: "warning",
          devMode: false,
          details: "Developer Mode not enabled. Symlinks may require elevated permissions.",
        };
      }
    } catch {
      result.symlink = {
        status: "ok",
        devMode: true,
        details: "Symlink engine ready",
      };
    }
  }

  // 3. Check yt-dlp
  const ytdlpCmd = customYtDlpPath || "yt-dlp";
  try {
    const ytdlpVer = await execAsync(cp, `"${ytdlpCmd}" --version`);
    result.ytdlp = {
      status: "ok",
      version: ytdlpVer.trim(),
      details: `yt-dlp ${ytdlpVer.trim()} detected`,
    };
  } catch {
    result.ytdlp = {
      status: "warning",
      details: "yt-dlp executable not found in PATH. Specify custom path in settings or install.",
    };
  }

  return result;
}

function execAsync(cp: any, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.exec(command, { timeout: 4000 }, (error: any, stdout: string) => {
      if (error) reject(error);
      else resolve(stdout || "");
    });
  });
}

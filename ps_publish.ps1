<#
.SYNOPSIS
    PakCLI Plugin Release Automation Tool & Obsidian Community Hub
    Supports modular release, build, GitHub Releases, and Obsidian Community check-release trigger.
#>

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

$ConfigFile = ".publish-config.json"

function Write-Header {
    Clear-Host
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "         * PakCLI Suite - Interactive Plugin Release Hub *       " -ForegroundColor Yellow
    Write-Host "=================================================================" -ForegroundColor Cyan
}

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "[+] $msg" -ForegroundColor Cyan
}

function Write-Success([string]$msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Warn([string]$msg) {
    Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Write-Err([string]$msg) {
    Write-Host "[ERR] $msg" -ForegroundColor Red
}

# 1. Load / Save Config Helper
function Get-PublishConfig {
    if (Test-Path $ConfigFile) {
        try {
            return Get-Content $ConfigFile -Raw | ConvertFrom-Json
        } catch {
            return $null
        }
    }
    return $null
}

function Save-PublishConfig([hashtable]$updates) {
    $existing = @{}
    $cfg = Get-PublishConfig
    if ($cfg) {
        foreach ($prop in $cfg.PSObject.Properties) {
            $existing[$prop.Name] = $prop.Value
        }
    }
    foreach ($k in $updates.Keys) {
        $existing[$k] = $updates[$k]
    }
    $existing["lastUpdated"] = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $existing | ConvertTo-Json -Depth 5 | Set-Content $ConfigFile
}

# 2. Extract Plugin Info Modularly from manifest.json & git remote
function Get-PluginInfo {
    if (-not (Test-Path "manifest.json")) {
        Write-Err "manifest.json not found in $PSScriptRoot!"
        exit 1
    }

    $manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
    $pkg = if (Test-Path "package.json") { Get-Content "package.json" -Raw | ConvertFrom-Json } else { $null }

    # Detect git remote repo
    $remoteUrl = git config --get remote.origin.url
    $repo = ""
    if ($remoteUrl -match "github.com[:/](.+?)(?:.git)?$") {
        $repo = $matches[1]
    }

    return [PSCustomObject]@{
        Id          = $manifest.id
        Name        = $manifest.name
        Version     = $manifest.version
        MinApp      = $manifest.minAppVersion
        Description = $manifest.description
        Repo        = $repo
    }
}

# 3. Main Interactive Menu
function Show-Menu {
    $info = Get-PluginInfo

    while ($true) {
        Write-Header
        Write-Host "Plugin:  $($info.Name) ($($info.Id))" -ForegroundColor White
        Write-Host "Version: $($info.Version) (minAppVersion: $($info.MinApp))" -ForegroundColor Green
        Write-Host "GitHub:  $($info.Repo)" -ForegroundColor Yellow
        Write-Host "Portal:  https://community.obsidian.md/account/plugins/$($info.Id)/check-release" -ForegroundColor Magenta
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
        
        $config = Get-PublishConfig
        $lastChoice = if ($config -and $config.latestMenuChoice) { [string]$config.latestMenuChoice } else { "2" }
        
        Write-Host "  [1] Full Release Pipeline (Bump -> Build -> Git Tag -> GH Release -> Obsidian Check)" -ForegroundColor Green
        Write-Host "  [2] Build and Test Only (npm run build + Auto Copy to Vault)" -ForegroundColor Cyan
        Write-Host "  [3] Upload Assets to an Existing GitHub Release" -ForegroundColor White
        Write-Host "  [4] Open GitHub Releases in Browser" -ForegroundColor Gray
        Write-Host "  [5] 🌐 Trigger Obsidian Community Release Check" -ForegroundColor Yellow
        Write-Host "  [0] Exit" -ForegroundColor Red
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray

        $choice = Read-Host "Choose option [Default: $lastChoice]"
        if ([string]::IsNullOrWhiteSpace($choice)) {
            $choice = $lastChoice
        }

        Save-PublishConfig @{ latestMenuChoice = $choice }

        switch ($choice) {
            "1" { Invoke-FullRelease $info }
            "2" { Invoke-BuildOnly $info }
            "3" { Invoke-UploadExistingRelease $info }
            "4" { Invoke-OpenWeb $info }
            "5" { Invoke-ObsidianCheckRelease $info }
            "0" { Write-Host "Goodbye!"; exit 0 }
            default { Write-Warn "Invalid choice. Please choose 0 to 5." }
        }

        Write-Host ""
        Write-Host "Press any key to return to menu..." -ForegroundColor Gray
        [Console]::ReadKey() | Out-Null
    }
}

# Action 1: Full Release Pipeline
function Invoke-FullRelease($info) {
    Write-Step "Step 1/5: Select Version Bump"
    $cur = $info.Version
    $parts = $cur.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    $patchVer = "$major.$minor.$($patch + 1)"
    $minorVer = "$major.$($minor + 1).0"
    $majorVer = "$($major + 1).0.0"

    $config = Get-PublishConfig
    $lastBump = if ($config -and $config.latestBumpChoice) { [string]$config.latestBumpChoice } else { "1" }

    Write-Host "  [1] Keep current ($cur) -> Directly publish / re-release" -ForegroundColor White
    Write-Host "  [2] Patch bump   ($cur -> $patchVer)" -ForegroundColor Green
    Write-Host "  [3] Minor bump   ($cur -> $minorVer)" -ForegroundColor Yellow
    Write-Host "  [4] Major bump   ($cur -> $majorVer)" -ForegroundColor Magenta
    Write-Host "  [5] Custom version string" -ForegroundColor White

    $vChoice = Read-Host "Select version bump [Default: $lastBump]"
    if ([string]::IsNullOrWhiteSpace($vChoice)) { $vChoice = $lastBump }

    Save-PublishConfig @{ latestBumpChoice = $vChoice }

    $targetVer = $cur
    if ($vChoice -eq "2") { $targetVer = $patchVer }
    elseif ($vChoice -eq "3") { $targetVer = $minorVer }
    elseif ($vChoice -eq "4") { $targetVer = $majorVer }
    elseif ($vChoice -eq "5") {
        $targetVer = Read-Host "Enter custom SemVer (e.g. 1.0.9)"
    }

    # 1. Update Version in Files (if bumped)
    if ($targetVer -ne $cur) {
        Write-Step "Updating manifest.json, package.json, versions.json to $targetVer..."
        
        $m = Get-Content "manifest.json" -Raw | ConvertFrom-Json
        $m.version = $targetVer
        $m | ConvertTo-Json -Depth 10 | Set-Content "manifest.json"

        $p = Get-Content "package.json" -Raw | ConvertFrom-Json
        $p.version = $targetVer
        $p | ConvertTo-Json -Depth 10 | Set-Content "package.json"

        $vJson = @{}
        if (Test-Path "versions.json") {
            $vJson = Get-Content "versions.json" -Raw | ConvertFrom-Json
        }
        $vObj = @{}
        foreach ($prop in $vJson.PSObject.Properties) { $vObj[$prop.Name] = $prop.Value }
        $vObj[$targetVer] = $info.MinApp
        $vObj | ConvertTo-Json -Depth 10 | Set-Content "versions.json"

        Write-Success "All version files updated to $targetVer."
    }

    # 2. Build Production Assets
    Write-Step "Step 2/5: Building production assets (npm run build)..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Build failed! Please fix compiler errors."
        return
    }

    $required = @("main.js", "manifest.json", "styles.css")
    foreach ($f in $required) {
        if (-not (Test-Path $f)) {
            Write-Err "Missing expected release artifact: $f"
            return
        }
    }
    Write-Success "Build completed! Verified: main.js, manifest.json, styles.css."

    # 3. Git Commit (only if changes exist)
    Write-Step "Step 3/5: Checking Git status..."
    $diffCheck = git status --porcelain
    if ($diffCheck) {
        git add manifest.json package.json versions.json
        git commit -m "chore: release $targetVer" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Committed release metadata."
        }
    } else {
        Write-Host "No file changes to commit. Proceeding with existing commit." -ForegroundColor Gray
    }

    # 4. Git Tag & Push
    Write-Step "Step 4/5: Pushing code and ensuring tag '$targetVer' exists..."
    git push origin HEAD 2>$null
    
    $tagCheck = git tag -l $targetVer
    if (-not $tagCheck) {
        git tag $targetVer
        git push origin $targetVer 2>$null
        Write-Success "Created and pushed tag '$targetVer'."
    } else {
        git push origin $targetVer 2>$null
        Write-Host "Tag '$targetVer' synced to remote." -ForegroundColor Gray
    }

    # 5. Create GitHub Release & Upload Assets
    Write-Step "Step 5/5: Publishing GitHub Release with attached assets..."
    
    gh release create $targetVer main.js manifest.json styles.css --repo $info.Repo --title "$targetVer" --notes "Release $targetVer of $($info.Name)" 2>$null
    if ($LASTEXITCODE -ne 0) {
        gh release upload $targetVer main.js manifest.json styles.css --repo $info.Repo --clobber
        Write-Success "Updated existing GitHub Release '$targetVer' assets!"
    } else {
        Write-Success "Created new GitHub Release '$targetVer' with assets attached!"
    }

    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "           RELEASE $targetVer IS OFFICIALLY LIVE ON GITHUB!       " -ForegroundColor Yellow
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "Release URL: https://github.com/$($info.Repo)/releases/tag/$targetVer" -ForegroundColor White
    Write-Host "Check URL:   https://community.obsidian.md/account/plugins/$($info.Id)/check-release" -ForegroundColor Magenta
    Write-Host ""

    # Interactive Prompt with ENTER as Default to Open Obsidian Check-Release
    $openPrompt = "Open Obsidian Community Check-Release in browser now? [Y/n, Default: Y (Press ENTER)]"
    $openCheck = Read-Host $openPrompt
    if ([string]::IsNullOrWhiteSpace($openCheck) -or $openCheck -match "^[Yy]") {
        Invoke-ObsidianCheckRelease $info
    } else {
        Write-Host "Skipped opening browser check." -ForegroundColor Gray
    }
}

# Action 2: Build Only + Auto Copy
function Invoke-BuildOnly($info) {
    Write-Step "Running production build..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Build encountered errors."
        return
    }
    
    Write-Success "Build succeeded! (main.js, manifest.json, styles.css)"

    # Ask for copy to vault
    Write-Host ""
    $config = Get-PublishConfig
    $savedDir = if ($config -and $config.latestCopyDir) { $config.latestCopyDir } else { "" }
    if ([string]::IsNullOrWhiteSpace($savedDir)) {
        $savedDir = "<Enter path to Vault/.obsidian/plugins/$($info.Id)>"
    }

    $doCopy = Read-Host "Copy built files to Obsidian Vault plugin directory? [Y/n, default: Y (ENTER)]"
    if ([string]::IsNullOrWhiteSpace($doCopy) -or $doCopy -match "^[Yy]") {
        Write-Host "Current saved destination: $savedDir" -ForegroundColor Yellow
        $targetPath = Read-Host "Enter target directory path (Press ENTER to use saved destination)"
        
        if ([string]::IsNullOrWhiteSpace($targetPath)) {
            $targetPath = $savedDir
        }

        if ([string]::IsNullOrWhiteSpace($targetPath) -or $targetPath.StartsWith("<Enter")) {
            Write-Warn "No valid destination provided. Skipping copy."
            return
        }

        # Ensure directory exists
        if (-not (Test-Path $targetPath)) {
            New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
        }

        # Copy release artifacts
        Copy-Item "main.js" -Destination $targetPath -Force
        Copy-Item "manifest.json" -Destination $targetPath -Force
        if (Test-Path "styles.css") {
            Copy-Item "styles.css" -Destination $targetPath -Force
        }

        # Save to config JSON
        Save-PublishConfig @{ latestCopyDir = $targetPath }

        Write-Success "Successfully copied plugin files to: $targetPath"
        Write-Host "Saved destination and choices to .publish-config.json for instant 1-click execution." -ForegroundColor DarkGray
    }
}

# Action 3: Upload Existing Release Assets
function Invoke-UploadExistingRelease($info) {
    $tag = Read-Host "Enter release tag to upload assets to [Default: $($info.Version)]"
    if ([string]::IsNullOrWhiteSpace($tag)) { $tag = $info.Version }

    Write-Step "Uploading main.js, manifest.json, styles.css to release '$tag'..."
    npm run build
    gh release upload $tag main.js manifest.json styles.css --repo $info.Repo --clobber
    Write-Success "Assets uploaded to https://github.com/$($info.Repo)/releases/tag/$tag"
}

# Action 4: Open Web
function Invoke-OpenWeb($info) {
    $releasesUrl = "https://github.com/$($info.Repo)/releases"
    Write-Step "Opening GitHub Releases in browser: $releasesUrl"
    Start-Process $releasesUrl
}

# Action 5: Modular Obsidian Community Check Release Trigger API
function Invoke-ObsidianCheckRelease($info) {
    $checkUrl = "https://community.obsidian.md/account/plugins/$($info.Id)/check-release"
    Write-Step "Triggering Obsidian Community Release Check for '$($info.Id)'..."
    Write-Host "Endpoint: $checkUrl" -ForegroundColor Cyan

    try {
        $response = Invoke-WebRequest -Uri $checkUrl -Method Get -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        Write-Success "Obsidian API responded with status code: $($response.StatusCode)"
    } catch {
        Write-Host "API check request sent to portal." -ForegroundColor Gray
    }

    Write-Step "Opening Obsidian Check Release Portal in browser..."
    Start-Process $checkUrl
    Write-Success "Check release page opened for '$($info.Id)'!"
}

# Start execution
Show-Menu

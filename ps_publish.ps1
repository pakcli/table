<#
.SYNOPSIS
    PakCLI Suite - Interactive Plugin Release Hub (10/10 Architecture)
#>

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

$ConfigFile = ".publish-config.json"

function Write-Header {
    Clear-Host
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "       * PakCLI Suite - Interactive Plugin Release Hub *       " -ForegroundColor Yellow
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

# 1. Config Persistence Helpers
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

# 2. Pre-flight Checks
function Test-Preflight {
    Write-Step "Checking environment prerequisites..."
    
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Err "npm is not installed or not in PATH."
        return $false
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Err "git is not installed or not in PATH."
        return $false
    }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Err "GitHub CLI (gh) is not installed."
        return $false
    }
    if (-not (Test-Path "manifest.json")) {
        Write-Err "manifest.json not found in current directory."
        return $false
    }
    
    Write-Success "Prerequisites verified (npm, git, gh, manifest.json)."
    return $true
}

function Get-PluginInfo {
    $manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
    $repo = (gh repo view --json nameWithOwner -q .nameWithOwner 2>$null)
    if ([string]::IsNullOrWhiteSpace($repo)) { $repo = "pakcli/$($manifest.id)" }
    
    return [PSCustomObject]@{
        Id      = $manifest.id
        Name    = $manifest.name
        Version = $manifest.version
        MinApp  = $manifest.minAppVersion
        Repo    = $repo.Trim()
    }
}

# 3. Main Menu Loop
function Show-Menu {
    if (-not (Test-Preflight)) {
        Write-Host "Press any key to exit..."
        [Console]::ReadKey() | Out-Null
        exit 1
    }

    while ($true) {
        Write-Header
        $info = Get-PluginInfo
        $config = Get-PublishConfig
        $savedDir = if ($config -and $config.latestCopyDir) { $config.latestCopyDir } else { "" }
        $lastChoice = if ($config -and $config.latestMenuChoice) { [string]$config.latestMenuChoice } else { "2" }

        Write-Host "  Plugin ID:       $($info.Id)" -ForegroundColor White
        Write-Host "  Plugin Name:     $($info.Name)" -ForegroundColor White
        Write-Host "  Current Version: $($info.Version)" -ForegroundColor Green
        Write-Host "  Obsidian Min:    $($info.MinApp)" -ForegroundColor White
        Write-Host "  GitHub Repo:     $($info.Repo)" -ForegroundColor Yellow
        if (-not [string]::IsNullOrWhiteSpace($savedDir)) {
            Write-Host "  Saved Copy Dest: $savedDir" -ForegroundColor DarkGray
        }
        if (-not [string]::IsNullOrWhiteSpace($lastChoice)) {
            Write-Host "  Last Option Used: [$lastChoice]" -ForegroundColor Cyan
        }
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
        Write-Host "  [1] Full Release Pipeline (Bump, Build, Tag, and GitHub Release)" -ForegroundColor Cyan
        Write-Host "  [2] Build and Test Only (npm run build + Auto Copy to Vault)" -ForegroundColor White
        Write-Host "  [3] Upload Assets to Existing GitHub Release Tag" -ForegroundColor White
        Write-Host "  [4] Open Obsidian Review and GitHub Releases Web Page" -ForegroundColor White
        Write-Host "  [0] Exit" -ForegroundColor Gray
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray

        $choicePrompt = "Select option [0-4, Default: $lastChoice]"
        $choice = Read-Host $choicePrompt
        if ([string]::IsNullOrWhiteSpace($choice)) { $choice = $lastChoice }

        # Save selected choice to config
        Save-PublishConfig @{ latestMenuChoice = $choice }

        switch ($choice) {
            "1" { Invoke-FullRelease $info }
            "2" { Invoke-BuildOnly $info }
            "3" { Invoke-UploadExistingRelease $info }
            "4" { Invoke-OpenWeb $info }
            "0" { Write-Host "Goodbye!"; exit 0 }
            default { Write-Warn "Invalid choice. Please choose 0 to 4." }
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
    Write-Host "RELEASE $targetVer IS OFFICIALLY LIVE!" -ForegroundColor Green
    Write-Host "Release URL: https://github.com/$($info.Repo)/releases/tag/$targetVer" -ForegroundColor Yellow
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

    $doCopy = Read-Host "Copy built files to Obsidian Vault plugin directory? [Y/n, default: Y]"
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
    $reviewUrl = "https://community.obsidian.md/account/plugins/$($info.Id)/check-release"
    
    Write-Step "Opening GitHub Releases and Obsidian Review portal..."
    Start-Process $releasesUrl
    Start-Process $reviewUrl
}

# Start execution
Show-Menu

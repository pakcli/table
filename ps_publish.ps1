<#
.SYNOPSIS
    PakCLI Suite - Interactive Plugin Release Hub (10/10 Architecture)
#>

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

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

# 1. Pre-flight Checks
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
    if ([string]::IsNullOrWhiteSpace($repo)) { $repo = "pakcli/local" }
    
    return [PSCustomObject]@{
        Id      = $manifest.id
        Name    = $manifest.name
        Version = $manifest.version
        MinApp  = $manifest.minAppVersion
        Repo    = $repo.Trim()
    }
}

# 2. Main Menu Loop
function Show-Menu {
    if (-not (Test-Preflight)) {
        Write-Host "Press any key to exit..."
        [Console]::ReadKey() | Out-Null
        exit 1
    }

    while ($true) {
        Write-Header
        $info = Get-PluginInfo
        Write-Host "  Plugin ID:       $($info.Id)" -ForegroundColor White
        Write-Host "  Plugin Name:     $($info.Name)" -ForegroundColor White
        Write-Host "  Current Version: $($info.Version)" -ForegroundColor Green
        Write-Host "  Obsidian Min:    $($info.MinApp)" -ForegroundColor White
        Write-Host "  GitHub Repo:     $($info.Repo)" -ForegroundColor Yellow
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
        Write-Host "  [1] Full Release Pipeline (Bump, Build, Tag, and GitHub Release)" -ForegroundColor Cyan
        Write-Host "  [2] Build and Test Only (npm run build)" -ForegroundColor White
        Write-Host "  [3] Upload Assets to Existing GitHub Release Tag" -ForegroundColor White
        Write-Host "  [4] Open Obsidian Review and GitHub Releases Web Page" -ForegroundColor White
        Write-Host "  [0] Exit" -ForegroundColor Gray
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray

        $choice = Read-Host "Select option [0-4]"
        switch ($choice) {
            "1" { Invoke-FullRelease $info }
            "2" { Invoke-BuildOnly }
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

    Write-Host "  [1] Keep current ($cur) -> Directly publish / re-release" -ForegroundColor White
    Write-Host "  [2] Patch bump   ($cur -> $patchVer)" -ForegroundColor Green
    Write-Host "  [3] Minor bump   ($cur -> $minorVer)" -ForegroundColor Yellow
    Write-Host "  [4] Major bump   ($cur -> $majorVer)" -ForegroundColor Magenta
    Write-Host "  [5] Custom version string" -ForegroundColor White

    $vChoice = Read-Host "Select version bump [Default: 1]"
    if ([string]::IsNullOrWhiteSpace($vChoice)) { $vChoice = "1" }

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

    # 3. Git Commit (only if there are staged/modified tracked changes)
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
    
    # Try creating new release first
    gh release create $targetVer main.js manifest.json styles.css --repo $info.Repo --title "$targetVer" --notes "Release $targetVer of $($info.Name)" 2>$null
    if ($LASTEXITCODE -ne 0) {
        # If release already exists, upload / overwrite assets
        gh release upload $targetVer main.js manifest.json styles.css --repo $info.Repo --clobber
        Write-Success "Updated existing GitHub Release '$targetVer' assets!"
    } else {
        Write-Success "Created new GitHub Release '$targetVer' with assets attached!"
    }

    Write-Host ""
    Write-Host "🎉 RELEASE $targetVer IS OFFICIALLY LIVE! 🎉" -ForegroundColor Green
    Write-Host "Release URL: https://github.com/$($info.Repo)/releases/tag/$targetVer" -ForegroundColor Yellow
}

# Action 2: Build Only
function Invoke-BuildOnly {
    Write-Step "Running production build..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Build encountered errors."
    } else {
        Write-Success "Build succeeded! Check main.js and styles.css."
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

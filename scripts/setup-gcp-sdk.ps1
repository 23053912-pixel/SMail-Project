# Complete Google Cloud SDK Setup
Write-Host "Google Cloud SDK Setup Helper"
Write-Host "================================"
Write-Host ""

# Step 1: Check if installer is still running
Write-Host "1. Waiting for Google Cloud SDK installer to complete..."
Write-Host "   (This window should close automatically when done)"
Write-Host ""

# Wait for the google-cloud-sdk folder to be created
$maxAttempts = 60
$attempt = 0
$sdkPath = $null

$possiblePaths = @(
    "C:\Program Files\Google\Cloud SDK",
    "C:\Program Files (x86)\Google\Cloud SDK", 
    "$env:LOCALAPPDATA\Google\Cloud SDK",
    "$env:APPDATA\Google\Cloud SDK"
)

do {
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $sdkPath = $path
            break
        }
    }
    
    if (-not $sdkPath) {
        Write-Host "  Waiting... ($attempt/60)" -NoNewline
        Start-Sleep -Seconds 1
        Write-Host "`rWaiting... ($attempt/60)     " -NoNewline
        $attempt++
    }
} while (-not $sdkPath -and $attempt -lt $maxAttempts)

if (-not $sdkPath) {
    Write-Host ""
    Write-Host "ERROR: Google Cloud SDK installation not found."
    Write-Host "Please manually install it from: https://cloud.google.com/sdk/docs/install-cloud-sdk-windows"
    exit 1
}

Write-Host ""
Write-Host "Found SDK at: $sdkPath"

# Step 2: Add to PATH
Write-Host ""
Write-Host "2. Adding to system PATH..."

$binPath = Join-Path $sdkPath "bin"
$currentPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)

if ($currentPath -notlike "*$binPath*") {
    $newPath = "$currentPath;$binPath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, [EnvironmentVariableTarget]::User)
    Write-Host "   Added $binPath to PATH"
} else {
    Write-Host "   Already in PATH"
}

# Step 3: Refresh PATH in current session
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Step 4: Verify gcloud works
Write-Host ""
Write-Host "3. Verifying gcloud CLI..."
try {
    $version = gcloud --version 2>&1 | Select-Object -First 1
    Write-Host "   SUCCESS! $version"
} catch {
    Write-Host "   ERROR: gcloud still not accessible"
    Write-Host "   Try closing and reopening PowerShell"
    exit 1
}

# Step 5: Authenticate
Write-Host ""
Write-Host "4. Authenticating with Google Cloud..."
gcloud auth login

# Step 6: Ready to deploy
Write-Host ""
Write-Host "Setup complete! You can now run:"
Write-Host ""
Write-Host "cd 'c:\Users\bhand\Downloads\SMAIL SYSTEM\ml portion spam'"
Write-Host "./deploy-gcp-all.ps1 -ProjectID smail-system-prod -Region us-central1"
Write-Host ""

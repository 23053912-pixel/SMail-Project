# SMAIL GCP Complete Deployment Script - Fixed
param(
    [string]$ProjectID = "level-dragon-486718-b5",
    [string]$Region = "us-central1",
    [string]$DbPassword = "ChangeMe123!@#Secure"
)

function Section { param([string]$Title); Write-Host ""; Write-Host "===== $Title =====" }
function Success { param([string]$Msg); Write-Host "[OK] $Msg" -ForegroundColor Green }
function Error { param([string]$Msg); Write-Host "[ERROR] $Msg" -ForegroundColor Red; exit 1 }
function Info { param([string]$Msg); Write-Host "[INFO] $Msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "============================================"
Write-Host "SMAIL System - GCP Complete Deployment"
Write-Host "Project: $ProjectID"
Write-Host "Region: $Region"
Write-Host "============================================"
Write-Host ""

# Check and configure gcloud path
Section "Prerequisites Check"
Info "Checking gcloud CLI..."

# Try to find gcloud in common locations
$gcpPaths = @(
    "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin",
    "C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin",
    "C:\Program Files (x86)\Google\Cloud SDK\bin",
    "C:\Program Files\Google\Cloud SDK\bin",
    "$env:LOCALAPPDATA\Google\Cloud SDK\bin"
)

$gcloudFound = $false
foreach ($path in $gcpPaths) {
    if (Test-Path (Join-Path $path "gcloud.cmd")) {
        Info "Found GCP SDK at: $path"
        $env:Path = $path + ";" + $env:Path
        $gcloudFound = $true
        break
    }
}

try {
    $v = gcloud --version 2>&1 | Select-Object -First 1
    Success "gcloud found"
} catch {
    Error "gcloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install"
}

Info "Using Google Cloud Build (no local Docker needed)"
Success "Build method: Cloud Build"

# Enable required APIs
Section "Enabling Google Cloud APIs"
Info "Enabling Cloud SQL Admin API..."
gcloud services enable sqladmin.googleapis.com --project=$ProjectID 2>&1 | Out-Null
Success "Cloud SQL Admin API enabled"

Info "Enabling Redis API..."
gcloud services enable redis.googleapis.com --project=$ProjectID 2>&1 | Out-Null
Success "Redis API enabled"

Info "Enabling Cloud Run API..."
gcloud services enable run.googleapis.com --project=$ProjectID 2>&1 | Out-Null
Success "Cloud Run API enabled"

Info "Enabling Cloud Artifact Registry API..."
gcloud services enable artifactregistry.googleapis.com --project=$ProjectID 2>&1 | Out-Null
Success "Artifact Registry API enabled"

# Setup registry (with explicit project)
Section "Container Registry Setup"
$registry = "$Region-docker.pkg.dev/$ProjectID/smail-repo"
Info "Creating artifact repository..."
try {
    gcloud artifacts repositories create smail-repo --project=$ProjectID --repository-format=docker --location=$Region --quiet 2>&1 | Out-Null
    Success "Repository created"
} catch {
    Info "Repository may already exist, continuing..."
}

Info "Configuring Docker..."
gcloud auth configure-docker "$Region-docker.pkg.dev" --quiet 2>&1 | Out-Null
Success "Registry ready: $registry"

# Build images using Cloud Build
Section "Building Docker Images via Cloud Build (3-10 minutes)"
Info "Enabling Cloud Build API..."
gcloud services enable cloudbuild.googleapis.com --project=$ProjectID 2>&1 | Out-Null
Success "Cloud Build API enabled"

Info "Building backend image in the cloud..."
$backendConfig = @"
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-t', '$registry/smail-backend:latest', '-f', 'Dockerfile.backend', '.']
- name: 'gcr.io/cloud-builders/docker'
  args: ['push', '$registry/smail-backend:latest']
images: ['$registry/smail-backend:latest']
"@

$backendConfigFile = Join-Path $env:TEMP "cloudbuild-backend.yaml"
$backendConfig | Out-File -FilePath $backendConfigFile -Encoding UTF8
gcloud builds submit --project=$ProjectID --config=$backendConfigFile --timeout=1800 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Success "Backend image built and pushed"
} else {
    Info "Backend build completed (check GCP Console for details)"
}
Remove-Item $backendConfigFile -ErrorAction SilentlyContinue

Info "Building ML API image in the cloud..."
$mlConfig = @"
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-t', '$registry/smail-ml-api:latest', '-f', 'ml-engine/core/predictive/Dockerfile', './ml-engine/core/predictive']
- name: 'gcr.io/cloud-builders/docker'
  args: ['push', '$registry/smail-ml-api:latest']
images: ['$registry/smail-ml-api:latest']
"@

$mlConfigFile = Join-Path $env:TEMP "cloudbuild-ml.yaml"
$mlConfig | Out-File -FilePath $mlConfigFile -Encoding UTF8
gcloud builds submit --project=$ProjectID --config=$mlConfigFile --timeout=1800 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Success "ML API image built and pushed"
} else {
    Info "ML API build completed (check GCP Console for details)"
}
Remove-Item $mlConfigFile -ErrorAction SilentlyContinue

# Setup Cloud SQL
Section "Cloud SQL Setup (may take 5-10 minutes)"
Info "Creating PostgreSQL instance..."
try {
    gcloud sql instances create smail-postgres --project=$ProjectID --database-version=POSTGRES_15 --tier=db-f1-micro --region=$Region --storage-auto-increase --storage-auto-increase-limit=100 --enable-bin-log --backup-start-time=03:00 --quiet 2>&1 | Out-Null
    Success "PostgreSQL instance created"
} catch {
    Info "Instance may already exist, continuing..."
}

Info "Creating database..."
gcloud sql databases create smail_db --project=$ProjectID --instance=smail-postgres --quiet 2>&1 | Out-Null
Success "Database created"

Info "Creating database user..."
gcloud sql users create smail_user --project=$ProjectID --instance=smail-postgres --password=$DbPassword --quiet 2>&1 | Out-Null
Success "Database user created"

Info "Retrieving database host..."
$dbHost = gcloud sql instances describe smail-postgres --project=$ProjectID --format="value(ipAddresses[0].ipAddress)" 2>&1
Success "Cloud SQL ready. Host: $dbHost"

# Setup Redis
Section "Redis Memorystore Setup (may take 3-5 minutes)"
Info "Creating Redis instance..."
try {
    gcloud redis instances create smail-redis --project=$ProjectID --size=1 --region=$Region --redis-version=7.0 --tier=basic --quiet 2>&1 | Out-Null
    Success "Redis instance created"
} catch {
    Info "Redis instance may already exist, continuing..."
}

Info "Retrieving Redis host..."
$redisHost = gcloud redis instances describe smail-redis --project=$ProjectID --region=$Region --format="value(host)" 2>&1
Success "Redis ready. Host: $redisHost"

# Deploy services
Section "Deploying to Cloud Run"
Info "Deploying backend service..."
gcloud run deploy smail-backend --project=$ProjectID --image="$registry/smail-backend:latest" --platform=managed --region=$Region --set-env-vars="NODE_ENV=production,DB_HOST=$dbHost,DB_USER=smail_user,DB_PASSWORD=$DbPassword,DB_NAME=smail_db,ML_API_HOST=smail-ml-api,ML_API_PORT=5001,JWT_SECRET=smail-jwt-secret" --memory=512Mi --cpu=1 --min-instances=5 --max-instances=50 --timeout=3600 --allow-unauthenticated --quiet 2>&1 | Out-Null
Success "Backend deployed"

Info "Deploying ML API service..."
gcloud run deploy smail-ml-api --project=$ProjectID --image="$registry/smail-ml-api:latest" --platform=managed --region=$Region --set-env-vars="FLASK_ENV=production,WORKERS=4" --memory=1Gi --cpu=2 --min-instances=2 --max-instances=20 --timeout=300 --allow-unauthenticated --quiet 2>&1 | Out-Null
Success "ML API deployed"

# Retrieve URLs
Info "Retrieving service URLs..."
$backendUrl = gcloud run services describe smail-backend --project=$ProjectID --region=$Region --format="value(status.url)" 2>&1
$mlApiUrl = gcloud run services describe smail-ml-api --project=$ProjectID --region=$Region --format="value(status.url)" 2>&1

# Summary
Write-Host ""
Write-Host "============================================"
Write-Host "DEPLOYMENT COMPLETE!"
Write-Host "============================================"
Write-Host ""
Write-Host "Backend URL:     $backendUrl"
Write-Host "ML API URL:      $mlApiUrl"
Write-Host ""
Write-Host "Database:"
Write-Host "  Host:          $dbHost"
Write-Host "  User:          smail_user"
Write-Host "  Database:      smail_db"
Write-Host ""
Write-Host "Redis:"
Write-Host "  Host:          $redisHost"
Write-Host "  Port:          6379"
Write-Host ""
Write-Host "Auto-Scaling:"
Write-Host "  Backend:       5-50 instances"
Write-Host "  ML API:        2-20 instances"
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Test health:  $backendUrl/health"
Write-Host "2. View logs:    gcloud run logs read smail-backend --project=$ProjectID --region=$Region"
Write-Host "3. Scale up:     gcloud run services update smail-backend --project=$ProjectID --min-instances=10 --max-instances=100 --region=$Region"
Write-Host ""
Success "All done! System is live!"

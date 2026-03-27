# SMAIL GCP Deployment - Complete Setup Guide

## Status: Google Cloud SDK Installation Required

The deployment script is ready, but requires Google Cloud SDK to be properly installed and configured.

---

## Step 1: Install Google Cloud SDK (If not already done)

**Via Browser (Recommended):**
1. Go to: https://cloud.google.com/sdk/docs/install-cloud-sdk-windows
2. Download the installer for Windows
3. Run `google-cloud-sdk-XXX-windows-x86_64.exe`
4. Follow the installation wizard:
   - Click "Next >"
   - Accept terms
   - **IMPORTANT: Check "Add to PATH"**
   - Complete installation
5. **Restart PowerShell** (close all Windows and open a new one)

**Via Chocolatey (If you have it):**
```powershell
choco install google-cloud-sdk
```

---

## Step 2: Verify Installation

Open a NEW PowerShell window and run:
```powershell
gcloud --version
```

You should see:
```
Google Cloud SDK 450.0.0
...
```

If not found, add to PATH manually:
```powershell
# Run as Administrator
$gcpPath = "C:\Program Files\Google\Cloud SDK\bin"
$currentPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
[Environment]::SetEnvironmentVariable("Path", "$currentPath;$gcpPath", [EnvironmentVariableTarget]::User)

# Refresh environment
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Verify
gcloud --version
```

---

## Step 3: Authenticate with Google Cloud

```powershell
gcloud auth login
```

A browser window will open. Sign in with your Google account that has the GCP project.

---

## Step 4: Verify Prerequisites

```powershell
# Check gcloud
gcloud --version

# Check Docker
docker --version

# Check authentication
gcloud auth list
```

All three should work without errors.

---

## Step 5: Run the Deployment

Once all prerequisites are verified, run:

```powershell
cd "c:\Users\bhand\Downloads\SMAIL SYSTEM\ml portion spam"

# Run the complete deployment
./deploy-gcp-all.ps1 -ProjectID smail-system-prod -Region us-central1 -DbPassword "YourSecurePassword123!@#"
```

---

## What the Deployment Script Will Do

The script automatically:
1. ✅ Enables required GCP APIs
2. ✅ Creates Artifact Registry container repository
3. ✅ Builds backend Docker image
4. ✅ Builds ML API Docker image
5. ✅ Pushes images to registry
6. ✅ Creates Cloud SQL PostgreSQL instance
7. ✅ Creates Cloud SQL database and user
8. ✅ Creates Redis Memorystore instance
9. ✅ Deploys backend to Cloud Run (5-50 auto-scaling)
10. ✅ Deploys ML API to Cloud Run (2-20 auto-scaling)
11. ✅ Outputs service URLs
12. ✅ Shows configuration summary

---

## Deployment Timing

- **Docker builds:** 2-3 minutes
- **Cloud SQL setup:** 5-10 minutes (longest step)
- **Redis setup:** 3-5 minutes
- **Cloud Run deployments:** 1-2 minutes
- **Total:** ~15-25 minutes

---

## Expected Output

When complete, you'll see:

```
============================================
DEPLOYMENT COMPLETE!
============================================

Backend URL:     https://smail-backend-XXXXX.run.app
ML API URL:      https://smail-ml-api-XXXXX.run.app

Database Host:   x.x.x.x
Database User:   smail_user
Database:        smail_db

Redis Host:      x.x.x.x
Redis Port:      6379

Scaling:
  Backend:       5-50 instances
  ML API:        2-20 instances

Next steps:
1. Test: https://smail-backend-XXXXX.run.app/health
2. View logs: gcloud run logs read smail-backend --region=us-central1
3. Scale: gcloud run services update smail-backend --min-instances=10 --max-instances=100 --region=us-central1

[OK] All done!
```

---

## Troubleshooting

**"gcloud CLI not found"**
- Verify installation completed
- Restart PowerShell after installing
- Check PATH manually with: `$env:Path`

**"Not authenticated with GCP"**
- Run: `gcloud auth login`
- Make sure account has GCP project access
- Run: `gcloud config set project smail-system-prod`

**"Docker not running"**
- Start Docker Desktop from Windows start menu
- Wait for it to fully load
- Check system tray for Docker icon

**"Database/Redis creation timeout"**
- These services can take 10+ minutes
- Check GCP Console > Cloud SQL and Memorystore to see progress
- You can manually complete remaining steps if timeout occurs

---

## Deployment Script Files

All ready-to-use scripts are in:
```
c:\Users\bhand\Downloads\SMAIL SYSTEM\ml portion spam\
```

- `deploy-gcp-all.ps1` - Main deployment script
- `setup-gcp-sdk.ps1` - SDK setup helper
- `GCP_DEPLOYMENT_GUIDE.md` - Detailed architecture guide
- `GCP_DEPLOYMENT_CHECKLIST.md` - Step-by-step checklist

---

## Post-Deployment

After successful deployment:

1. **Test the system:**
   ```powershell
   $url = "https://smail-backend-XXXXX.run.app/health"
   Invoke-WebRequest $url
   ```

2. **View logs:**
   ```powershell
   gcloud run logs read smail-backend --region=us-central1 --limit=50
   ```

3. **Scale up if needed:**
   ```powershell
   gcloud run services update smail-backend --min-instances=10 --max-instances=100 --region=us-central1
   ```

4. **Monitor in GCP Console:**
   - Go to: https://console.cloud.google.com/
   - Cloud Run > Details for each service
   - Cloud Monitoring for metrics

---

## Support

Need help? Check:
- GCP Documentation: https://cloud.google.com/docs
- Cloud Run Docs: https://cloud.google.com/run/docs
- Cloud SDK Documentation: https://cloud.google.com/sdk/docs
- GCP Status: https://status.cloud.google.com/

Ready to proceed? Follow the steps above and let me know when the SDK is ready!

#!/usr/bin/env pwsh
# Render Deployment Setup Script for SMAIL System

param(
    [string]$GitHubUsername = "",
    [string]$RepositoryName = "SMAIL"
)

function Section { param([string]$Title); Write-Host ""; Write-Host "===== $Title =====" }
function Success { param([string]$Msg); Write-Host "[OK] $Msg" -ForegroundColor Green }
function Error { param([string]$Msg); Write-Host "[ERROR] $Msg" -ForegroundColor Red; exit 1 }
function Info { param([string]$Msg); Write-Host "[INFO] $Msg" -ForegroundColor Yellow }
function Warning { param([string]$Msg); Write-Host "[WARN] $Msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "============================================"
Write-Host "SMAIL System - Render Deployment Setup"
Write-Host "============================================"
Write-Host ""

# Check prerequisites
Section "Checking Prerequisites"

# Check Git
Info "Checking Git..."
try {
    $gitVersion = git --version 2>&1
    Success "Git installed: $gitVersion"
} catch {
    Error "Git not found. Install from: https://git-scm.com/download/win"
}

# Check Node.js
Info "Checking Node.js..."
try {
    $nodeVersion = node --version 2>&1
    Success "Node.js installed: $nodeVersion"
} catch {
    Warning "Node.js not found (needed for local testing)"
}

# Check Python
Info "Checking Python..."
try {
    $pythonVersion = python --version 2>&1
    Success "Python installed: $pythonVersion"
} catch {
    Warning "Python not found (needed for ML API local testing)"
}

# Initialize Git repository
Section "Initializing Git Repository"

if (Test-Path .git) {
    Info "Git repository already initialized"
} else {
    git init 2>&1 | Out-Null
    Success "Git repository initialized"
}

# Stage and commit
Info "Staging files..."
git add . 2>&1 | Out-Null
Success "Files staged"

Info "Creating initial commit..."
git commit -m "Initial SMAIL deployment to Render" --allow-empty 2>&1 | Out-Null
Success "Commit created"

# Display next steps
Section "Next Steps for Render Deployment"

Write-Host ""
Write-Host "1. CREATE GITHUB REPOSITORY"
Write-Host "   Visit: https://github.com/new"
Write-Host "   - Create repo named: $RepositoryName"
Write-Host "   - Keep it PUBLIC"
Write-Host ""

if ([string]::IsNullOrEmpty($GitHubUsername)) {
    Write-Host "2. PUSH TO GITHUB"
    Write-Host "   Run these commands:"
    Write-Host ""
    Write-Host "   git remote add origin https://github.com/YOUR_USERNAME/$RepositoryName.git"
    Write-Host "   git branch -M main"
    Write-Host "   git push -u origin main"
} else {
    Write-Host "2. PUSH TO GITHUB"
    Write-Host "   Run this command:"
    Write-Host ""
    $repoUrl = "https://github.com/$GitHubUsername/$RepositoryName.git"
    Write-Host "   git remote add origin $repoUrl"
    Write-Host "   git branch -M main"
    Write-Host "   git push -u origin main"
}

Write-Host ""
Write-Host "3. CREATE RENDER ACCOUNT"
Write-Host "   Visit: https://render.com (free signup, no credit card)"
Write-Host ""

Write-Host "4. DEPLOY TO RENDER"
Write-Host "   a) Go to: https://dashboard.render.com"
Write-Host "   b) Click 'New +' > 'Web Service'"
Write-Host "   c) Connect your GitHub repo"
Write-Host "   d) Name: smail-backend"
Write-Host "   e) Environment: Node"
Write-Host "   f) Build: npm install"
Write-Host "   g) Start: npm start"
Write-Host "   h) Plan: Free"
Write-Host ""

Write-Host "5. DEPLOY ML API"
Write-Host "   a) Click 'New +' > 'Web Service' again"
Write-Host "   b) Same repo, but:"
Write-Host "   c) Name: smail-ml-api"
Write-Host "   d) Environment: Python 3.11"
Write-Host "   e) Build: pip install -r ml-engine/core/predictive/requirements.txt"
Write-Host "   f) Start: cd ml-engine/core/predictive && gunicorn -w 4 -b 0.0.0.0:10000 predict_api:app"
Write-Host ""

Write-Host "6. CREATE DATABASE"
Write-Host "   a) Click 'New +' > 'PostgreSQL'"
Write-Host "   b) Name: smail-postgres"
Write-Host "   c) Plan: Free"
Write-Host "   d) Copy Internal Database URL"
Write-Host ""

Write-Host "7. ADD ENVIRONMENT VARIABLES"
Write-Host "   Backend (smail-backend):"
Write-Host "   - DATABASE_URL: (from PostgreSQL)"
Write-Host "   - NODE_ENV: production"
Write-Host "   - ML_API_HOST: smail-ml-api.onrender.com"
Write-Host ""
Write-Host "   ML API (smail-ml-api):"
Write-Host "   - FLASK_ENV: production"
Write-Host ""

Write-Host "8. TEST"
Write-Host "   Wait 2-3 minutes for deployment, then:"
Write-Host "   curl https://smail-backend.onrender.com/health"
Write-Host ""

Write-Host "============================================"
Success "Setup complete! Follow the steps above to deploy to Render"
Write-Host "============================================"
Write-Host ""
Write-Host "Documentation: See RENDER_DEPLOYMENT_GUIDE.md"
Write-Host ""

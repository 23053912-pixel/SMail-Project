# SMAIL Kubernetes Setup Script - Local Development (Windows PowerShell)
# This script automates the entire K8s deployment on Docker Desktop

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🚀 SMAIL Kubernetes Setup" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if kubectl is installed
Write-Host "🔍 Checking prerequisites..." -ForegroundColor Yellow

try {
    kubectl cluster-info 2>&1 | Out-Null
} catch {
    Write-Host "❌ Kubernetes cluster not running. Enable Kubernetes in Docker Desktop." -ForegroundColor Red
    Write-Host "  Steps:" -ForegroundColor Yellow
    Write-Host "  1. Open Docker Desktop" -ForegroundColor Yellow
    Write-Host "  2. Settings → Kubernetes" -ForegroundColor Yellow
    Write-Host "  3. Check 'Enable Kubernetes'" -ForegroundColor Yellow
    Write-Host "  4. Click 'Apply & Restart'" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ kubectl found" -ForegroundColor Green
Write-Host ""

# Step 1: Build Docker images
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "📦 Building Docker images..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path "Dockerfile.backend")) {
    Write-Host "❌ Dockerfile.backend not found in current directory" -ForegroundColor Red
    exit 1
}

Write-Host "Building backend image..." -ForegroundColor Yellow
docker build -t smail-backend:latest -f Dockerfile.backend .
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Backend image built" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to build backend image" -ForegroundColor Red
    exit 1
}

Write-Host "Building ML API image..." -ForegroundColor Yellow
docker build -t smail-ml-api:latest -f ml-engine/core/predictive/Dockerfile ./ml-engine/core/predictive
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ ML API image built" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to build ML API image" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "📦 Docker images created:" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
docker images | Select-String "smail-" | ForEach-Object { Write-Host $_ -ForegroundColor Green }
Write-Host ""

# Step 2: Create namespace and secrets
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🔐 Creating Kubernetes namespace and secrets..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Creating namespace..." -ForegroundColor Yellow
kubectl create namespace smail 2>&1 | Out-Null
Write-Host "✅ Namespace created" -ForegroundColor Green

Write-Host "Creating database credentials secret..." -ForegroundColor Yellow
kubectl create secret generic db-credentials `
  --from-literal=username=smail_user `
  --from-literal=password=smail_password `
  -n smail 2>&1 | Out-Null
Write-Host "✅ Database credentials secret created" -ForegroundColor Green

Write-Host "Creating application secrets..." -ForegroundColor Yellow
kubectl create secret generic app-secrets `
  --from-literal=jwt-secret=smail-jwt-secret-key-change-in-prod `
  -n smail 2>&1 | Out-Null
Write-Host "✅ Application secrets created" -ForegroundColor Green

Write-Host ""

# Step 3: Deploy to Kubernetes
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🚀 Deploying to Kubernetes..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

kubectl apply -f k8s-local-deployment.yaml
Write-Host "✅ Deployment manifest applied" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "⏳ Waiting for pods to be ready (120 seconds)..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Wait for deployments with progress
$deployments = @("postgres", "redis", "ml-api", "backend")
$maxWait = 120
$waited = 0

foreach ($dep in $deployments) {
    Write-Host "Waiting for $dep to be ready..." -ForegroundColor Yellow
    $ready = $false
    
    while (-not $ready -and $waited -lt $maxWait) {
        $status = kubectl get deployment/$dep -n smail -o jsonpath='{.status.conditions[?(@.type=="Available")].status}' 2>/dev/null
        if ($status -eq "True") {
            Write-Host "✅ $dep is ready" -ForegroundColor Green
            $ready = $true
        } else {
            Start-Sleep -Seconds 5
            $waited += 5
            Write-Host "  Still waiting..." -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "📊 Pod Status:" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
kubectl get pods -n smail
Write-Host ""

# Step 4: HPA status
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "📈 Auto-scaling Status (HPA):" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
kubectl get hpa -n smail
Write-Host ""

# Step 5: Port forwarding info
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "📝 Next Steps:" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1️⃣  Port-forward the backend service:" -ForegroundColor Yellow
Write-Host "   kubectl port-forward -n smail svc/backend 3000:80" -ForegroundColor Cyan
Write-Host ""
Write-Host "2️⃣  In another terminal, access the system:" -ForegroundColor Yellow
Write-Host "   http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "3️⃣  View logs:" -ForegroundColor Yellow
Write-Host "   kubectl logs -n smail deployment/backend -f --tail=100" -ForegroundColor Cyan
Write-Host ""
Write-Host "4️⃣  Scale backend replicas (for load testing):" -ForegroundColor Yellow
Write-Host "   kubectl scale deployment backend --replicas=10 -n smail" -ForegroundColor Cyan
Write-Host ""
Write-Host "5️⃣  Monitor scaling in real-time:" -ForegroundColor Yellow
Write-Host "   kubectl get hpa -n smail -w" -ForegroundColor Cyan
Write-Host ""
Write-Host "6️⃣  Stop everything:" -ForegroundColor Yellow
Write-Host "   kubectl delete namespace smail" -ForegroundColor Cyan
Write-Host ""
Write-Host "7️⃣  Useful commands:" -ForegroundColor Yellow
Write-Host "   Get all pods:          kubectl get pods -n smail" -ForegroundColor Gray
Write-Host "   Get services:          kubectl get svc -n smail" -ForegroundColor Gray
Write-Host "   Describe pod:          kubectl describe pod POD_NAME -n smail" -ForegroundColor Gray
Write-Host "   SSH into pod:          kubectl exec -it POD_NAME -n smail -- /bin/sh" -ForegroundColor Gray
Write-Host "   View all resources:    kubectl get all -n smail" -ForegroundColor Gray
Write-Host ""

Write-Host "==========================================" -ForegroundColor Green
Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

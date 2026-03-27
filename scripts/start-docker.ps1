# SMAIL Manual Docker Setup - Simplified
param(
    [int]$BackendInstances = 3,
    [switch]$Logs = $false
)

$GREEN = "`e[32m"
$RED = "`e[31m"
$YELLOW = "`e[33m"
$CYAN = "`e[36m"
$RESET = "`e[0m"

Write-Host "$CYAN========================================$RESET"
Write-Host "🚀 SMAIL Manual Docker Setup"
Write-Host "$CYAN========================================$RESET"
Write-Host ""

# Check Docker
Write-Host "$YELLOW🔍 Checking Docker...$RESET"
try {
    docker --version 2>&1 | Out-Null
    Write-Host "$GREEN✅ Docker found$RESET"
} catch {
    Write-Host "$RED❌ Docker not installed or not running$RESET"
    exit 1
}

# Build images
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "📦 Building Docker Images"
Write-Host "$CYAN========================================$RESET"
Write-Host ""

Write-Host "$YELLOW Building backend image...$RESET"
docker build -t smail-backend:latest -f Dockerfile.backend . 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "$GREEN✅ Backend image built$RESET"
} else {
    Write-Host "$RED❌ Failed to build backend$RESET"
    exit 1
}

Write-Host "$YELLOW Building ML API image...$RESET"
docker build -t smail-ml-api:latest -f ml-engine/core/predictive/Dockerfile ./ml-engine/core/predictive 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "$GREEN✅ ML API image built$RESET"
} else {
    Write-Host "$RED❌ Failed to build ML API$RESET"
    exit 1
}

# Cleanup
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "🧹 Cleaning Up Previous Containers"
Write-Host "$CYAN========================================$RESET"
Write-Host ""

$containers = @("smail-postgres", "smail-redis", "smail-ml-api", "smail-nginx", "smail-backend-1", "smail-backend-2", "smail-backend-3", "smail-backend-4", "smail-backend-5")

foreach ($container in $containers) {
    if (docker ps -a -q -f "name=$container" 2>/dev/null) {
        Write-Host "$YELLOW Stopping $container...$RESET"
        docker stop $container 2>&1 | Out-Null
        docker rm $container 2>&1 | Out-Null
    }
}

docker network rm smail-network 2>&1 | Out-Null
Write-Host "$GREEN✅ Cleanup complete$RESET"

# Create network
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "🌐 Creating Docker Network"
Write-Host "$CYAN========================================$RESET"
docker network create smail-network 2>&1 | Out-Null
Write-Host "$GREEN✅ Network created$RESET"

# Start PostgreSQL
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "🗄️  Starting PostgreSQL"
Write-Host "$CYAN========================================$RESET"
docker run -d `
  --name smail-postgres `
  --network smail-network `
  -e POSTGRES_USER=smail_user `
  -e POSTGRES_PASSWORD=smail_password `
  -e POSTGRES_DB=smail_db `
  -p 5432:5432 `
  -v postgres_data:/var/lib/postgresql/data `
  postgres:15-alpine | Out-Null

Write-Host "$GREEN✅ PostgreSQL started (port 5432)$RESET"

# Wait for PostgreSQL
Write-Host "$YELLOW Waiting for PostgreSQL to be ready...$RESET"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    $result = docker exec smail-postgres pg_isready -U smail_user 2>&1
    if ($result -like "*accepting*") {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    Write-Host "$RED❌ PostgreSQL failed to start$RESET"
    exit 1
}

Write-Host "$GREEN✅ PostgreSQL ready$RESET"

# Start Redis
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "📦 Starting Redis"
Write-Host "$CYAN========================================$RESET"
docker run -d `
  --name smail-redis `
  --network smail-network `
  -p 6379:6379 `
  -v redis_data:/data `
  redis:7-alpine redis-server --appendonly yes | Out-Null

Write-Host "$GREEN✅ Redis started (port 6379)$RESET"

# Start ML API
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "🤖 Starting ML API"
Write-Host "$CYAN========================================$RESET"
docker run -d `
  --name smail-ml-api `
  --network smail-network `
  -e FLASK_ENV=production `
  -e WORKERS=2 `
  -p 5001:5001 `
  smail-ml-api:latest | Out-Null

Write-Host "$GREEN✅ ML API started (port 5001)$RESET"

# Start Backend Instances
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "⚙️  Starting $BackendInstances Backend Instance(s)"
Write-Host "$CYAN========================================$RESET"

for ($i = 1; $i -le $BackendInstances; $i++) {
    $port = 3000 + $i
    $container_name = "smail-backend-$i"
    
    Write-Host "$YELLOW Starting $container_name (port $port)...$RESET"
    
    docker run -d `
      --name $container_name `
      --network smail-network `
      -e NODE_ENV=production `
      -e PORT=3000 `
      -e DB_HOST=smail-postgres `
      -e DB_USER=smail_user `
      -e DB_PASSWORD=smail_password `
      -e DB_NAME=smail_db `
      -e REDIS_HOST=smail-redis `
      -e REDIS_PORT=6379 `
      -e ML_API_HOST=smail-ml-api `
      -e ML_API_PORT=5001 `
      -e NUM_WORKERS=2 `
      -e JWT_SECRET=smail-jwt-secret-key `
      -p "$port`:3000" `
      smail-backend:latest | Out-Null
}

Write-Host "$GREEN✅ $BackendInstances backend instance(s) started$RESET"

# Start Nginx
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "🔄 Starting Nginx Load Balancer"
Write-Host "$CYAN========================================$RESET"

# Copy nginx config to temp
$sourceConfig = "nginx.conf"
$destConfig = "$env:TEMP\nginx-smail.conf"
Copy-Item -Path $sourceConfig -Destination $destConfig -Force

$volumeMount = $destConfig + ":/etc/nginx/conf.d/default.conf:ro"

docker run -d `
  --name smail-nginx `
  --network smail-network `
  -v $volumeMount `
  -p 80:80 `
  nginx:alpine | Out-Null

Write-Host "$GREEN✅ Nginx started (port 80)$RESET"

# Summary
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "✅ All Containers Started!"
Write-Host "$CYAN========================================$RESET"
Write-Host ""

docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | Select-String "smail-"

Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "📍 Access Points"
Write-Host "$CYAN========================================$RESET"
Write-Host ""
Write-Host "$GREEN Frontend/API (via Nginx)$RESET"
Write-Host "  http://localhost"
Write-Host ""
Write-Host "$GREEN Direct Backend Access$RESET"
for ($i = 1; $i -le $BackendInstances; $i++) {
    $port = 3000 + $i
    Write-Host "  Backend $($i): http://localhost:$($port)"
}
Write-Host ""
Write-Host "$GREEN Services$RESET"
Write-Host "  PostgreSQL: localhost:5432"
Write-Host "  Redis: localhost:6379"
Write-Host "  ML API: http://localhost:5001"
Write-Host ""

if ($Logs) {
    Write-Host "$CYAN========================================"
    Write-Host "📊 Container Logs"
    Write-Host "$CYAN========================================$RESET"
    Write-Host ""
    Write-Host "$YELLOW Backend logs:$RESET"
    docker logs smail-backend-1
}

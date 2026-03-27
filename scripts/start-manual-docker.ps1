# SMAIL Manual Docker Setup Script - Automated
# PowerShell script to start all containers with one command

param(
    [int]$BackendInstances = 3,
    [switch]$Clean = $false,
    [switch]$Logs = $false
)

# Colors
$GREEN = "`e[32m"
$RED = "`e[31m"
$YELLOW = "`e[33m"
$CYAN = "`e[36m"
$RESET = "`e[0m"

Write-Host "$CYAN" -NoNewline
Write-Host "========================================"
Write-Host "🚀 SMAIL Manual Docker Setup"
Write-Host "========================================" 
Write-Host "$RESET"
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

# Build images if needed
Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "📦 Building Docker Images..." 
Write-Host "========================================$RESET"
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

Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "🧹 Cleaning Up Previous Containers..." 
Write-Host "========================================$RESET"
Write-Host ""

# Stop existing containers
$containers = @(
    "smail-postgres", "smail-redis", "smail-ml-api", 
    "smail-nginx", "smail-backend-1", "smail-backend-2", 
    "smail-backend-3", "smail-backend-4", "smail-backend-5"
)

foreach ($container in $containers) {
    if (docker ps -a -q -f "name=$container" | Select-Object -First 1) {
        Write-Host "$YELLOW Stopping $container...$RESET"
        docker stop $container 2>&1 | Out-Null
        docker rm $container 2>&1 | Out-Null
    }
}

# Remove old network
docker network rm smail-network 2>&1 | Out-Null

Write-Host "$GREEN✅ Cleanup complete$RESET"
Write-Host ""

# Create network
Write-Host "$CYAN========================================"
Write-Host "🌐 Creating Docker Network..." 
Write-Host "========================================$RESET"
docker network create smail-network
Write-Host "$GREEN✅ Network created$RESET"
Write-Host ""

# Start PostgreSQL
Write-Host "$CYAN========================================"
Write-Host "🗄️  Starting PostgreSQL..." 
Write-Host "========================================$RESET"
docker run -d `
  --name smail-postgres `
  --network smail-network `
  -e POSTGRES_USER=smail_user `
  -e POSTGRES_PASSWORD=smail_password `
  -e POSTGRES_DB=smail_db `
  -p 5432:5432 `
  -v postgres_data:/var/lib/postgresql/data `
  postgres:15-alpine

Write-Host "$GREEN✅ PostgreSQL started (port 5432)$RESET"

# Wait for PostgreSQL to be ready
Write-Host "$YELLOW Waiting for PostgreSQL to be ready...$RESET"
$postgresql_ready = $false
for ($i = 0; $i -lt 30; $i++) {
    $result = docker exec smail-postgres pg_isready -U smail_user 2>&1
    if ($result -like "*accepting*") {
        $postgresql_ready = $true
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $postgresql_ready) {
    Write-Host "$RED❌ PostgreSQL failed to start$RESET"
    exit 1
}

Write-Host "$GREEN✅ PostgreSQL ready$RESET"
Write-Host ""

# Init database schema
Write-Host "$YELLOW Initializing database schema...$RESET"
$schema = Get-Content "backend/db/schema.sql"
$schema | docker exec -i smail-postgres psql -U smail_user -d smail_db 2>&1 | Out-Null
Write-Host "$GREEN✅ Database schema initialized$RESET"
Write-Host ""

# Start Redis
Write-Host "$CYAN========================================"
Write-Host "📦 Starting Redis..." 
Write-Host "========================================$RESET"
docker run -d `
  --name smail-redis `
  --network smail-network `
  -p 6379:6379 `
  -v redis_data:/data `
  redis:7-alpine redis-server --appendonly yes

Write-Host "$GREEN✅ Redis started (port 6379)$RESET"
Write-Host ""

# Start ML API
Write-Host "$CYAN========================================"
Write-Host "🤖 Starting ML API..." 
Write-Host "========================================$RESET"
docker run -d `
  --name smail-ml-api `
  --network smail-network `
  -e FLASK_ENV=production `
  -e WORKERS=2 `
  -p 5001:5001 `
  smail-ml-api:latest

Write-Host "$GREEN✅ ML API started (port 5001)$RESET"
Write-Host ""

# Start Backend Instances
Write-Host "$CYAN========================================"
Write-Host "⚙️  Starting $BackendInstances Backend Instance(s)..." 
Write-Host "========================================$RESET"

for ($i = 1; $i -le $BackendInstances; $i++) {
    $port = 3000 + $i
    $container_name = "smail-backend-$i"
    
    Write-Host "$YELLOW Starting $container_name (port $port)...$RESET"
    
    $portMapping = "$($port):3000"
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
      -p $portMapping `
      smail-backend:latest
}

Write-Host "$GREEN✅ $BackendInstances backend instance(s) started$RESET"
Write-Host ""

# Start Nginx
Write-Host "$CYAN========================================"
Write-Host "🔄 Starting Nginx Load Balancer..." 
Write-Host "========================================$RESET"

# Create Nginx config
$nginx_config = @"
upstream backend_pool {
    least_conn;
"@

for ($i = 1; $i -le $BackendInstances; $i++) {
    $backend_line = "    server smail-backend-$i`:3000 weight=1;" + [Environment]::NewLine
    $nginx_config += $backend_line
}

$nginx_config += @"
    keepalive 32;
}

server {
    listen 80;
    server_name _;
    client_max_body_size 10M;
    
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    
    location / {
        proxy_pass http://backend_pool;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_buffering off;
    }
    
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
"@

# Save config to temp file
$nginx_config | Out-File -FilePath "$env:TEMP/nginx-docker.conf" -Encoding UTF8

# Start Nginx
docker run -d `
  --name smail-nginx `
  --network smail-network `
  -v "$env:TEMP/nginx-docker.conf":/etc/nginx/conf.d/default.conf:ro `
  -p 80:80 `
  nginx:alpine

Write-Host "$GREEN✅ Nginx started (port 80)$RESET"
Write-Host ""

# Summary
Write-Host "$CYAN========================================"
Write-Host "✅ All Containers Started!" 
Write-Host "========================================$RESET"
Write-Host ""

docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | Select-String "smail-"

Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "📍 Access Points" 
Write-Host "========================================$RESET"
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

# Show logs if requested
if ($Logs) {
    Write-Host "$CYAN========================================"
    Write-Host "📊 Container Logs" 
    Write-Host "========================================$RESET"
    Write-Host ""
    Write-Host "$YELLOW Backend logs:$RESET"
    docker logs smail-backend-1
}

Write-Host ""
Write-Host "$CYAN========================================"
Write-Host "💡 Useful Commands" 
Write-Host "========================================$RESET"
Write-Host ""
Write-Host "View logs:              $YELLOW`docker logs -f smail-backend-1$RESET"
Write-Host "Check status:           $YELLOW`docker ps | Select-String smail$RESET"
Write-Host "Scale up:               $YELLOW`./start-manual-docker.ps1 -BackendInstances 5$RESET"
Write-Host "Stop all:               $YELLOW`docker stop `$(docker ps -q | Select-String smail)$RESET"
Write-Host "Connect to database:    $YELLOW`docker exec -it smail-postgres psql -U smail_user -d smail_db$RESET"
Write-Host ""

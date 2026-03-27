param([int]$BackendInstances = 3)

Write-Host "Starting SMAIL Docker Setup..."

# Check Docker
docker --version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker not found!"
    exit 1
}

# Build images
Write-Host "Building images..."
docker build -t smail-backend:latest -f Dockerfile.backend .
docker build -t smail-ml-api:latest -f ml-engine/core/predictive/Dockerfile ./ml-engine/core/predictive

# Cleanup
Write-Host "Cleaning up..."
docker ps -aq --filter "name=smail-" | ForEach-Object { docker stop $_; docker rm $_ }
docker network rm smail-network 2>/dev/null

# Create network
Write-Host "Creating network..."
docker network create smail-network

# Start PostgreSQL
Write-Host "Starting PostgreSQL..."
docker run -d --name smail-postgres --network smail-network `
  -e POSTGRES_USER=smail_user -e POSTGRES_PASSWORD=smail_password `
  -e POSTGRES_DB=smail_db -p 5432:5432 `
  -v postgres_data:/var/lib/postgresql/data postgres:15-alpine

# Wait for PostgreSQL
Write-Host "Waiting for PostgreSQL..."
$maxAttempts = 30
$attempt = 0
do {
    $attempt++
    docker exec smail-postgres pg_isready -U smail_user 2>/dev/null | Select-String "accepting" | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
} while ($attempt -lt $maxAttempts)

# Start Redis
Write-Host "Starting Redis..."
docker run -d --name smail-redis --network smail-network `
  -p 6379:6379 -v redis_data:/data `
  redis:7-alpine redis-server --appendonly yes

# Start ML API
Write-Host "Starting ML API..."
docker run -d --name smail-ml-api --network smail-network `
  -e FLASK_ENV=production -e WORKERS=2 -p 5001:5001 smail-ml-api:latest

# Start Backend Instances
Write-Host "Starting $BackendInstances backend instances..."
for ($i = 1; $i -le $BackendInstances; $i++) {
    $port = 3000 + $i
    $name = "smail-backend-$i"
    docker run -d --name $name --network smail-network `
      -e NODE_ENV=production -e PORT=3000 `
      -e DB_HOST=smail-postgres -e DB_USER=smail_user `
      -e DB_PASSWORD=smail_password -e DB_NAME=smail_db `
      -e REDIS_HOST=smail-redis -e REDIS_PORT=6379 `
      -e ML_API_HOST=smail-ml-api -e ML_API_PORT=5001 `
      -e NUM_WORKERS=2 -e JWT_SECRET=smail-jwt-secret-key `
      -p "${port}:3000" smail-backend:latest
}

# Start Nginx
Write-Host "Starting Nginx..."
$tempConfig = "$env:TEMP\nginx-smail.conf"
Copy-Item -Path "nginx.conf" -Destination $tempConfig -Force
docker run -d --name smail-nginx --network smail-network `
  -v "$tempConfig`:/etc/nginx/conf.d/default.conf:ro" `
  -p 80:80 nginx:alpine

Write-Host "Done! All containers started."
Write-Host "Access at: http://localhost"
docker ps --filter "name=smail-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

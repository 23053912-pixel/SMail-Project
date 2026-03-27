# SMAIL Manual Docker Setup - Full Control
# Run containers individually with complete control

## Prerequisites
- Docker Desktop installed and running
- All images built

---

## 🏗️ Architecture (Manual)

```
Your Machine
├─ PostgreSQL Container (:5432)
├─ Redis Container (:6379)
├─ ML API Container (:5001)
├─ Backend Container 1 (:3001)
├─ Backend Container 2 (:3002)
└─ Nginx Container (:80)
```

---

## Step 1: Build Docker Images

```bash
cd "c:\Users\bhand\Downloads\SMAIL SYSTEM\ml portion spam"

# Build backend image
docker build -t smail-backend:latest -f Dockerfile.backend .

# Build ML API image
docker build -t smail-ml-api:latest -f ml-engine/core/predictive/Dockerfile ./ml-engine/core/predictive
```

Verify:
```bash
docker images | grep smail-
```

---

## Step 2: Create Docker Network

```bash
# Create a shared network for containers to communicate
docker network create smail-network
```

---

## Step 3: Start PostgreSQL

```bash
docker run -d \
  --name smail-postgres \
  --network smail-network \
  -e POSTGRES_USER=smail_user \
  -e POSTGRES_PASSWORD=smail_password \
  -e POSTGRES_DB=smail_db \
  -p 5432:5432 \
  -v postgres_data:/var/lib/postgresql/data \
  postgres:15-alpine

# Verify
docker logs smail-postgres
```

Create schema:
```bash
docker exec -i smail-postgres psql -U smail_user -d smail_db < backend/db/schema.sql
```

---

## Step 4: Start Redis

```bash
docker run -d \
  --name smail-redis \
  --network smail-network \
  -p 6379:6379 \
  -v redis_data:/data \
  redis:7-alpine redis-server --appendonly yes

# Verify
docker logs smail-redis
```

---

## Step 5: Start ML API

```bash
docker run -d \
  --name smail-ml-api \
  --network smail-network \
  -e FLASK_ENV=production \
  -e WORKERS=2 \
  -p 5001:5001 \
  smail-ml-api:latest

# Verify
docker logs smail-ml-api
```

---

## Step 6: Start Backend Containers (Multiple Instances)

### Backend Instance 1 (Port 3001)
```bash
docker run -d \
  --name smail-backend-1 \
  --network smail-network \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DB_HOST=smail-postgres \
  -e DB_USER=smail_user \
  -e DB_PASSWORD=smail_password \
  -e DB_NAME=smail_db \
  -e REDIS_HOST=smail-redis \
  -e REDIS_PORT=6379 \
  -e ML_API_HOST=smail-ml-api \
  -e ML_API_PORT=5001 \
  -e NUM_WORKERS=2 \
  -e JWT_SECRET=your-jwt-secret-key \
  -p 3001:3000 \
  smail-backend:latest

# Verify
docker logs smail-backend-1
```

### Backend Instance 2 (Port 3002)
```bash
docker run -d \
  --name smail-backend-2 \
  --network smail-network \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DB_HOST=smail-postgres \
  -e DB_USER=smail_user \
  -e DB_PASSWORD=smail_password \
  -e DB_NAME=smail_db \
  -e REDIS_HOST=smail-redis \
  -e REDIS_PORT=6379 \
  -e ML_API_HOST=smail-ml-api \
  -e ML_API_PORT=5001 \
  -e NUM_WORKERS=2 \
  -e JWT_SECRET=your-jwt-secret-key \
  -p 3002:3000 \
  smail-backend:latest
```

### Backend Instance 3 (Port 3003) - Optional
```bash
docker run -d \
  --name smail-backend-3 \
  --network smail-network \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DB_HOST=smail-postgres \
  -e DB_USER=smail_user \
  -e DB_PASSWORD=smail_password \
  -e DB_NAME=smail_db \
  -e REDIS_HOST=smail-redis \
  -e REDIS_PORT=6379 \
  -e ML_API_HOST=smail-ml-api \
  -e ML_API_PORT=5001 \
  -e NUM_WORKERS=2 \
  -e JWT_SECRET=your-jwt-secret-key \
  -p 3003:3000 \
  smail-backend:latest
```

---

## Step 7: Start Nginx Load Balancer

Create `nginx-docker.conf`:
```nginx
upstream backend_pool {
    least_conn;
    server smail-backend-1:3000 weight=1;
    server smail-backend-2:3000 weight=1;
    server smail-backend-3:3000 weight=1;
    keepalive 32;
}

server {
    listen 80;
    server_name _;
    
    location / {
        proxy_pass http://backend_pool;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Start Nginx:
```bash
docker run -d \
  --name smail-nginx \
  --network smail-network \
  -v $(pwd)/nginx-docker.conf:/etc/nginx/conf.d/default.conf:ro \
  -p 80:80 \
  nginx:alpine

# Verify
docker logs smail-nginx
```

---

## Step 8: Verify All Containers

```bash
# Check all running containers
docker ps

# Expected output:
# smail-postgres
# smail-redis
# smail-ml-api
# smail-backend-1
# smail-backend-2
# smail-backend-3 (optional)
# smail-nginx
```

---

## 🌐 Access Your System

```
Frontend/API:    http://localhost
Backend 1:       http://localhost:3001
Backend 2:       http://localhost:3002
Backend 3:       http://localhost:3003
PostgreSQL:      localhost:5432 (psql)
Redis:           localhost:6379 (redis-cli)
ML API:          http://localhost:5001
```

---

## 📊 Useful Commands

### View Logs
```bash
docker logs smail-postgres
docker logs smail-redis
docker logs smail-ml-api
docker logs smail-backend-1
docker logs smail-backend-2
docker logs smail-nginx

# Follow logs in real-time
docker logs -f smail-backend-1
```

### Execute Commands in Container
```bash
# SSH into backend
docker exec -it smail-backend-1 /bin/sh

# SSH into PostgreSQL
docker exec -it smail-postgres psql -U smail_user -d smail_db

# SSH into Redis
docker exec -it smail-redis redis-cli
```

### Container Management
```bash
# Stop a container
docker stop smail-backend-1

# Start a container
docker start smail-backend-1

# Restart a container
docker restart smail-backend-1

# Remove a container (must be stopped first)
docker rm smail-backend-1

# View container stats
docker stats
```

### Database Management
```bash
# List databases
docker exec smail-postgres psql -U smail_user -l

# Create backup
docker exec smail-postgres pg_dump -U smail_user smail_db > backup.sql

# Restore backup
docker exec -i smail-postgres psql -U smail_user smail_db < backup.sql
```

---

## 🔧 Scale Up (Add More Backend Instances)

```bash
# Backend 4
docker run -d \
  --name smail-backend-4 \
  --network smail-network \
  -e DB_HOST=smail-postgres \
  -e DB_USER=smail_user \
  -e DB_PASSWORD=smail_password \
  -e DB_NAME=smail_db \
  -e REDIS_HOST=smail-redis \
  -e REDIS_PORT=6379 \
  -e ML_API_HOST=smail-ml-api \
  -e ML_API_PORT=5001 \
  -p 3004:3000 \
  smail-backend:latest

# Update nginx.conf and restart nginx
docker restart smail-nginx
```

---

## 🧹 Clean Up Everything

```bash
# Stop all containers
docker stop smail-postgres smail-redis smail-ml-api smail-backend-1 smail-backend-2 smail-backend-3 smail-nginx

# Remove all containers
docker rm smail-postgres smail-redis smail-ml-api smail-backend-1 smail-backend-2 smail-backend-3 smail-nginx

# Remove volumes
docker volume rm postgres_data redis_data

# Remove network
docker network rm smail-network
```

---

## 📈 Capacity with Manual Docker

```
3 Backend Instances = ~60 concurrent users
5 Backend Instances = ~100 concurrent users
10 Backend Instances = ~200 concurrent users
```

Each backend instance handles ~20 concurrent users with proper connection pooling.

---

## 🚀 Automated Setup Script

Create `start-manual-docker.ps1` (see next section) for one-command startup.

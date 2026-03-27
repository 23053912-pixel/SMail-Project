#!/bin/bash
# SMAIL Kubernetes Setup Script - Local Development
# This script automates the entire K8s deployment on Docker Desktop

set -e

echo "=========================================="
echo "🚀 SMAIL Kubernetes Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if kubectl is installed
echo "🔍 Checking prerequisites..."
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}❌ kubectl not found. Install Docker Desktop with Kubernetes enabled.${NC}"
    exit 1
fi

if ! kubectl cluster-info &> /dev/null; then
    echo -e "${RED}❌ Kubernetes cluster not running. Enable Kubernetes in Docker Desktop.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ kubectl found${NC}"
echo ""

# Step 1: Build Docker images
echo "=========================================="
echo "📦 Building Docker images..."
echo "=========================================="

if [ ! -f "Dockerfile.backend" ]; then
    echo -e "${RED}❌ Dockerfile.backend not found in current directory${NC}"
    exit 1
fi

docker build -t smail-backend:latest -f Dockerfile.backend .
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Backend image built${NC}"
else
    echo -e "${RED}❌ Failed to build backend image${NC}"
    exit 1
fi

docker build -t smail-ml-api:latest -f ml-engine/core/predictive/Dockerfile ./ml-engine/core/predictive
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ ML API image built${NC}"
else
    echo -e "${RED}❌ Failed to build ML API image${NC}"
    exit 1
fi

echo ""
echo "=========================================="
echo "📦 Docker images created:"
echo "=========================================="
docker images | grep -E "smail-|REPOSITORY"
echo ""

# Step 2: Create namespace and secrets
echo "=========================================="
echo "🔐 Creating Kubernetes namespace and secrets..."
echo "=========================================="

kubectl create namespace smail --dry-run=client -o yaml | kubectl apply -f -
echo -e "${GREEN}✅ Namespace created${NC}"

kubectl create secret generic db-credentials \
  --from-literal=username=smail_user \
  --from-literal=password=smail_password \
  -n smail --dry-run=client -o yaml | kubectl apply -f -
echo -e "${GREEN}✅ Database credentials secret created${NC}"

kubectl create secret generic app-secrets \
  --from-literal=jwt-secret=smail-jwt-secret-key-change-in-prod \
  -n smail --dry-run=client -o yaml | kubectl apply -f -
echo -e "${GREEN}✅ Application secrets created${NC}"

echo ""

# Step 3: Deploy to Kubernetes
echo "=========================================="
echo "🚀 Deploying to Kubernetes..."
echo "=========================================="

kubectl apply -f k8s-local-deployment.yaml

echo -e "${GREEN}✅ Deployment manifest applied${NC}"

echo ""
echo "=========================================="
echo "⏳ Waiting for pods to be ready (60 seconds)..."
echo "=========================================="

# Wait for deployments to be ready
kubectl wait --for=condition=available --timeout=120s \
  deployment/postgres deployment/redis deployment/ml-api deployment/backend \
  -n smail 2>/dev/null || true

echo ""
echo "=========================================="
echo "📊 Pod Status:"
echo "=========================================="
kubectl get pods -n smail
echo ""

# Step 4: Get service info
echo "=========================================="
echo "🌐 Services:"
echo "=========================================="
kubectl get svc -n smail
echo ""

# Step 5: Port forwarding info
echo "=========================================="
echo "📝 Next Steps:"
echo "=========================================="
echo ""
echo "1️⃣  Port-forward the backend service:"
echo "   ${YELLOW}kubectl port-forward -n smail svc/backend 3000:80${NC}"
echo ""
echo "2️⃣  Access the system:"
echo "   ${YELLOW}http://localhost:3000${NC}"
echo ""
echo "3️⃣  View logs:"
echo "   ${YELLOW}kubectl logs -n smail deployment/backend -f${NC}"
echo ""
echo "4️⃣  Scale backend replicas:"
echo "   ${YELLOW}kubectl scale deployment backend --replicas=10 -n smail${NC}"
echo ""
echo "5️⃣  Stop everything:"
echo "   ${YELLOW}kubectl delete namespace smail${NC}"
echo ""

echo "=========================================="
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo "=========================================="

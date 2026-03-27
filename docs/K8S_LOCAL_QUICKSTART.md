# Kubernetes Quick Start - Production Ready

## 🚀 Prerequisites
- Docker Desktop installed with Kubernetes enabled
- `kubectl` CLI (comes with Docker Desktop)
- 8GB+ RAM allocated to Docker

---

## Step 1: Enable Kubernetes in Docker Desktop

1. Open **Docker Desktop**
2. Go to **Settings → Kubernetes**
3. Check ✅ **"Enable Kubernetes"**
4. Click **"Apply & Restart"**
5. Wait 2-3 minutes for initialization

Verify:
```bash
kubectl version
kubectl get nodes
```

---

## Step 2: Create Kubernetes Namespace

```bash
kubectl create namespace smail
kubectl config set-context --current --namespace=smail
```

---

## Step 3: Create Secrets

```bash
# Database credentials
kubectl create secret generic db-credentials \
  --from-literal=username=smail_user \
  --from-literal=password=smail_password \
  -n smail

# Application secrets
kubectl create secret generic app-secrets \
  --from-literal=jwt-secret=your-jwt-secret-key \
  -n smail

# Verify
kubectl get secrets -n smail
```

---

## Step 4: Deploy to Kubernetes

### Local Deployment (Using Localhost Images)

```bash
cd "c:\Users\bhand\Downloads\SMAIL SYSTEM\ml portion spam"

# First, build Docker images
docker build -t smail-backend:latest -f Dockerfile.backend .
docker build -t smail-ml-api:latest -f ml-engine/core/predictive/Dockerfile ./ml-engine/core/predictive

# Create a Docker Compose manifest for K8s
kubectl apply -f k8s-local-deployment.yaml
```

---

## Step 5: Monitor Deployment

```bash
# Watch pod creation
kubectl get pods -n smail -w

# Check service status
kubectl get svc -n smail

# View logs
kubectl logs -n smail deployment/backend -f

# Get pod details
kubectl describe pod POD_NAME -n smail
```

---

## Step 6: Access Your System

```bash
# Port-forward backend
kubectl port-forward -n smail svc/backend 3000:3000

# Port-forward PostgreSQL
kubectl port-forward -n smail svc/postgres 5432:5432

# Once port-forwarded:
# Frontend: http://localhost:3000
# API: http://localhost:3000/api
```

---

## Common Kubernetes Commands

```bash
# Scale backend to 10 replicas
kubectl scale deployment backend --replicas=10 -n smail

# View HPA status (autoscaling)
kubectl get hpa -n smail -w

# Delete a pod to trigger restart
kubectl delete pod POD_NAME -n smail

# View resource usage
kubectl top pods -n smail

# SSH into pod
kubectl exec -it POD_NAME -n smail -- /bin/sh

# View all resources
kubectl get all -n smail

# Delete deployment
kubectl delete -f k8s-local-deployment.yaml -n smail

# Delete entire namespace
kubectl delete namespace smail
```

---

## Troubleshooting

### Pods stuck in "Pending"
```bash
kubectl describe pod STUCK_POD -n smail
# Check "Events" section for detailed error
```

### Image pull errors
```bash
# Make sure Docker images are built locally
docker images | grep smail

# Rebuild if needed
docker build -t smail-backend:latest -f Dockerfile.backend .
```

### Out of memory
```bash
# Check Docker Desktop memory allocation
# Settings → Resources → Memory: increase to 8GB+
```

### Port already in use
```bash
# Use different local port
kubectl port-forward -n smail svc/backend 8080:3000
# Then access at http://localhost:8080
```

---

## Capacity & Scaling

```
Kubernetes Local (Docker Desktop):
├─ 1 backend replica   = ~20 users
├─ 5 backend replicas  = ~100 users
├─ 10 backend replicas = ~200 users
└─ 20 backend replicas = ~400+ users

Auto-scaling triggers:
└─ CPU: 70% → scale up
└─ Memory: 80% → scale up
```

---

## Production Checklist

- [x] Kubernetes cluster created
- [ ] Persistent storage configured
- [ ] Network policies set
- [ ] Resource limits defined
- [ ] Health checks configured
- [ ] Monitoring setup (Prometheus)
- [ ] Log aggregation (ELK)
- [ ] Backup strategy
- [ ] Security scanning
- [ ] Load testing completed

---

## Next: Deploy to GCP

When ready for production on GCP:
```bash
# Follow SCALING_GUIDE_GCP.md for:
# 1. Create GCP project
# 2. Create GKE cluster
# 3. Push images to GCR
# 4. Deploy with kubectl
# 5. Setup load balancer
```

---

**Ready? Start with:**
```bash
kubectl apply -f k8s-local-deployment.yaml -n smail
kubectl get pods -n smail -w
```

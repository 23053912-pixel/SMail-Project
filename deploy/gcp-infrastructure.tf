terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Variables
variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "smail-system-prod"
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "backend_image" {
  description = "Backend Docker image URL"
  type        = string
}

variable "ml_api_image" {
  description = "ML API Docker image URL"
  type        = string
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com"
  ])

  service            = each.value
  disable_on_destroy = false
}

# Cloud SQL Instance
resource "google_sql_database_instance" "postgres" {
  name             = "smail-postgres"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier              = "db-f1-micro"
    availability_type = "REGIONAL"
    
    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        retained_backups = 30
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      require_ssl = true
    }

    database_flags {
      name  = "max_connections"
      value = "200"
    }
  }

  deletion_protection = false
  depends_on          = [google_project_service.required_apis]
}

resource "google_sql_database" "smail_db" {
  name     = "smail_db"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "smail_user" {
  name     = "smail_user"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}

# Redis Memorystore
resource "google_redis_instance" "smail_redis" {
  name           = "smail-redis"
  memory_size_gb = 1
  region         = var.region
  redis_version  = "7.0"
  tier           = "basic"

  auth_enabled = true

  redis_configs = {
    maxmemory-policy = "allkeys-lru"
  }
}

# Service Account
resource "google_service_account" "smail_service_account" {
  account_id   = "smail-deployer"
  display_name = "SMAIL System Service Account"
}

# IAM Roles
resource "google_project_iam_member" "run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.smail_service_account.email}"
}

resource "google_project_iam_member" "sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.smail_service_account.email}"
}

# Cloud Run Backend Service
resource "google_cloud_run_service" "backend" {
  name     = "smail-backend"
  location = var.region

  template {
    spec {
      service_account_name = google_service_account.smail_service_account.email

      containers {
        image = var.backend_image

        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name  = "DB_HOST"
          value = google_sql_database_instance.postgres.private_ip_address
        }
        env {
          name  = "DB_USER"
          value = "smail_user"
        }
        env {
          name  = "DB_PASSWORD"
          value = var.db_password
        }
        env {
          name  = "DB_NAME"
          value = "smail_db"
        }
        env {
          name  = "REDIS_HOST"
          value = google_redis_instance.smail_redis.host
        }
        env {
          name  = "REDIS_PORT"
          value = "6379"
        }
        env {
          name  = "ML_API_HOST"
          value = google_cloud_run_service.ml_api.status[0].url
        }
        env {
          name  = "ML_API_PORT"
          value = "5001"
        }
        env {
          name  = "JWT_SECRET"
          value = "smail-jwt-secret-key-prod"
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }

      timeout_seconds = 3600
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale" = "5"
        "autoscaling.knative.dev/maxScale" = "50"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [
    google_project_service.required_apis,
    google_sql_database_instance.postgres,
    google_redis_instance.smail_redis
  ]
}

# Cloud Run ML API Service
resource "google_cloud_run_service" "ml_api" {
  name     = "smail-ml-api"
  location = var.region

  template {
    spec {
      service_account_name = google_service_account.smail_service_account.email

      containers {
        image = var.ml_api_image

        env {
          name  = "FLASK_ENV"
          value = "production"
        }
        env {
          name  = "WORKERS"
          value = "4"
        }

        resources {
          limits = {
            cpu    = "2"
            memory = "1Gi"
          }
        }
      }

      timeout_seconds = 300
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale" = "2"
        "autoscaling.knative.dev/maxScale" = "20"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [google_project_service.required_apis]
}

# Allow public access
resource "google_cloud_run_service_iam_member" "backend_public" {
  service       = google_cloud_run_service.backend.name
  location      = google_cloud_run_service.backend.location
  role          = "roles/run.invoker"
  member        = "allUsers"
}

resource "google_cloud_run_service_iam_member" "ml_api_public" {
  service       = google_cloud_run_service.ml_api.name
  location      = google_cloud_run_service.ml_api.location
  role          = "roles/run.invoker"
  member        = "allUsers"
}

# Outputs
output "backend_url" {
  value = google_cloud_run_service.backend.status[0].url
}

output "ml_api_url" {
  value = google_cloud_run_service.ml_api.status[0].url
}

output "database_host" {
  value = google_sql_database_instance.postgres.private_ip_address
}

output "redis_host" {
  value = google_redis_instance.smail_redis.host
}

output "service_account_email" {
  value = google_service_account.smail_service_account.email
}

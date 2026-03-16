#!/bin/bash
set -e

# Replace this with your actual key
GOOGLE_API_KEY="${GOOGLE_API_KEY:?Please set GOOGLE_API_KEY env var}"

gcloud run deploy theia-agent \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_API_KEY=${GOOGLE_API_KEY}" \
  --memory 512Mi \
  --port 8080

#!/usr/bin/env bash
# Build the container image and roll it out to Azure Container Apps.
#
# The image is built locally with Docker because free-trial subscriptions cannot
# run cloud builds (ACR Tasks). Needs: Docker running, and `az login` done.
#
#   ./deploy.sh            # tag = current git commit
#   ./deploy.sh v3         # explicit tag
#
# One-time setup (already done for the live demo), roughly:
#   az group create -n rg-matchbrain -l eastus
#   # Foundry resource + project "matchbrain" with a gpt-5-mini deployment (Foundry portal)
#   az acr create -n <registry> -g rg-matchbrain --sku Basic
#   az containerapp env create -n matchbrain-env-w2 -g rg-matchbrain -l westus2
#   az containerapp create -n matchbrain -g rg-matchbrain --environment matchbrain-env-w2 \
#     --image <registry>.azurecr.io/matchbrain:v1 --registry-server <registry>.azurecr.io \
#     --registry-identity system --system-assigned --ingress external --target-port 8000 \
#     --min-replicas 0 --max-replicas 1 \
#     --env-vars FOUNDRY_AUTH=identity FOUNDRY_MODEL_DEPLOYMENT=gpt-5-mini \
#       FOUNDRY_PROJECT_ENDPOINT=https://<foundry>.services.ai.azure.com/api/projects/matchbrain \
#       FOUNDRY_RESOURCE_ENDPOINT=https://<foundry>.cognitiveservices.azure.com
#   az role assignment create --assignee-object-id <app principal id> \
#     --assignee-principal-type ServicePrincipal --role "Foundry User" --scope <foundry resource id>
#
# max-replicas 1: viewer profiles for live sessions are kept in memory.
set -euo pipefail

RG=${RG:-rg-matchbrain}
ACR=${ACR:-matchbrainacrf2b933}
APP=${APP:-matchbrain}
TAG=${1:-$(git rev-parse --short HEAD)}
IMAGE="$ACR.azurecr.io/matchbrain:$TAG"

export PYTHONWARNINGS=ignore  # silence harmless warnings from the Azure CLI

echo "==> Building $IMAGE (linux/amd64)"
az acr login --name "$ACR" --only-show-errors
docker buildx build --platform linux/amd64 --tag "$IMAGE" --push .

echo "==> Rolling out to $APP"
URL=$(az containerapp update --name "$APP" --resource-group "$RG" --image "$IMAGE" \
  --only-show-errors --query properties.configuration.ingress.fqdn --output tsv)

echo "==> Live at https://$URL"

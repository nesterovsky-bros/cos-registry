#!/bin/bash

# Default values for optional parameters
APP_REPO_URL="https://github.com/nesterovsky-bros/cos-registry.git"
APP_REPO_BRANCH="main"

# Function to display help message
usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --resource-group <resource-group>         IBM Cloud resource group (required)"
  echo "  --region <region>                         IBM Cloud region (required)"
  echo "  --cos-instance-name <cos-instance-name>   Name of the Cloud Object Storage instance (required)"
  echo "  --cos-bucket-name <cos-bucket-name>       Name of the Cloud Object Storage bucket (optional, defaults to application name)"
  echo "  --app-name <app-name>                     Application name (required)"
  echo "  --app-user-service-id <service-id>        Service ID for app user (optional, defaults to derived name)"
  echo "  --users-container-service-id <service-id> Service ID for user management (optional, defaults to derived name)"
  echo "  --code-engine-project <project-name>      Code Engine project name (required)"
  echo "  --app-repo-url <repo-url>                 Application repository URL (default: https://github.com/nesterovsky-bros/cos-registry.git)"
  echo "  --app-repo-branch <repo-branch>           Application repository branch (default: main)"
  echo "  --api-key <api-key>                       IBM Cloud API key (optional, can also be set via IBM_CLOUD_API_KEY environment variable)"
  echo "  --help                                    Display this help message"
  exit 1
}

# Parse named parameters
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --resource-group) RESOURCE_GROUP="$2"; shift ;;
    --region) REGION="$2"; shift ;;
    --cos-instance-name) COS_INSTANCE_NAME="$2"; shift ;;
    --cos-bucket-name) COS_BUCKET_NAME="$2"; shift ;;
    --app-name) APP_NAME="$2"; shift ;;
    --app-user-service-id) APP_USER_SERVICE_ID_NAME="$2"; shift ;;
    --users-container-service-id) USERS_CONTAINER_SERVICE_ID_NAME="$2"; shift ;;
    --code-engine-project) CODE_ENGINE_PROJECT_NAME="$2"; shift ;;
    --app-repo-url) APP_REPO_URL="$2"; shift ;;
    --app-repo-branch) APP_REPO_BRANCH="$2"; shift ;;
    --api-key) IBM_CLOUD_API_KEY="$2"; shift ;;
    --help) usage ;;
    *) echo "Unknown parameter passed: $1"; usage ;;
  esac
  shift
done

# Check for required parameters
if [[ -z "$RESOURCE_GROUP" || -z "$REGION" || -z "$COS_INSTANCE_NAME" || -z "$APP_NAME" || -z "$CODE_ENGINE_PROJECT_NAME" ]]; then
  echo "Error: Missing required parameters."
  usage
fi

# Check for IBM Cloud API key
if [[ -z "$IBM_CLOUD_API_KEY" ]]; then
  echo "Error: IBM_CLOUD_API_KEY environment variable is not set and --api-key is not provided."
  exit 1
fi

# Set default values for optional parameters
COS_BUCKET_NAME=${COS_BUCKET_NAME:-$APP_NAME}
APP_USER_SERVICE_ID_NAME=${APP_USER_SERVICE_ID_NAME:-"${APP_NAME}-app-user"}
USERS_CONTAINER_SERVICE_ID_NAME=${USERS_CONTAINER_SERVICE_ID_NAME:-"${APP_NAME}-users-container"}

# Install jq if not present
if ! command -v jq &> /dev/null; then
  echo "jq not found, installing..."
  sudo apt-get update && sudo apt-get install -y jq
fi

# Install required IBM Cloud plugins if not present
if ! ibmcloud plugin list | grep -q "cloud-object-storage"; then
  ibmcloud plugin install cloud-object-storage -f
fi

if ! ibmcloud plugin list | grep -q "code-engine"; then
  ibmcloud plugin install code-engine -f
fi

# Login to IBM Cloud
ibmcloud login --apikey "$IBM_CLOUD_API_KEY" -r "$REGION" -g "$RESOURCE_GROUP"

# Check if Cloud Object Storage instance exists
COS_INSTANCE_ID=$(ibmcloud resource service-instance "$COS_INSTANCE_NAME" --id --quiet 2>/dev/null)
if [[ -z "$COS_INSTANCE_ID" ]]; then
  # Create Cloud Object Storage instance
  ibmcloud resource service-instance-create "$COS_INSTANCE_NAME" cloud-object-storage standard global --resource-group "$RESOURCE_GROUP"
  COS_INSTANCE_ID=$(ibmcloud resource service-instance "$COS_INSTANCE_NAME" --id --quiet)
fi

# Create a new bucket in Cloud Object Storage
ibmcloud cos bucket-create --bucket "$COS_BUCKET_NAME" --ibm-service-instance-id "$COS_INSTANCE_ID"

# Create a new Service ID for the application if not provided
if ! ibmcloud iam service-id "$APP_USER_SERVICE_ID_NAME" --quiet 2>/dev/null; then
  ibmcloud iam service-id-create "$APP_USER_SERVICE_ID_NAME" -d "Service ID for app user"
fi
APP_USER_SERVICE_ID=$(ibmcloud iam service-id "$APP_USER_SERVICE_ID_NAME" --uuid --quiet)

# Create an API key for the Service ID
APP_USER_API_KEY=$(ibmcloud iam service-api-key-create app-user-api-key "$APP_USER_SERVICE_ID_NAME" -d "API key for app user" --output JSON --quiet | jq -r .apikey)

# Assign write access to the Cloud Object Storage instance
ibmcloud iam service-policy-create "$APP_USER_SERVICE_ID" --roles Writer --service-name cloud-object-storage --service-instance "$COS_INSTANCE_NAME"

# Assign IAM Identity keys inspection to the Service ID
ibmcloud iam service-policy-create "$APP_USER_SERVICE_ID" --roles Operator --service-name iam-identity

# Create another Service ID for user management if not provided
if ! ibmcloud iam service-id "$USERS_CONTAINER_SERVICE_ID_NAME" --quiet 2>/dev/null; then
  ibmcloud iam service-id-create "$USERS_CONTAINER_SERVICE_ID_NAME" -d "Service ID for user management"
fi
USERS_CONTAINER_SERVICE_ID=$(ibmcloud iam service-id "$USERS_CONTAINER_SERVICE_ID_NAME" --uuid --quiet)

# Check if Code Engine project exists
if ! ibmcloud ce project get --name "$CODE_ENGINE_PROJECT_NAME" --quiet 2>/dev/null; then
  # Create a Code Engine project
  ibmcloud ce project create --name "$CODE_ENGINE_PROJECT_NAME" --region "$REGION" --resource-group "$RESOURCE_GROUP"
fi

# Select the Code Engine project
ibmcloud ce project select --name "$CODE_ENGINE_PROJECT_NAME"

# Check if application already exists
if ibmcloud ce application get --name "$APP_NAME" --quiet 2>/dev/null; then
  echo "Error: Application with name $APP_NAME already exists."
  exit 1
fi

# Create a service binding prefix derived from application name
BINDING_PREFIX="${APP_NAME}-binding"

# Bind the Cloud Object Storage service to the Code Engine project
ibmcloud ce secret create --name "$BINDING_PREFIX" --from-literal "cos_api_key=$APP_USER_API_KEY" --from-literal "cos_instance_id=$COS_INSTANCE_ID"

# Create an application within the Code Engine project
ibmcloud ce application create --name "$APP_NAME" --source "$APP_REPO_URL" --branch "$APP_REPO_BRANCH" --build-strategy buildpacks --env APP_BUCKET="$COS_BUCKET_NAME" --env APP_USER_SERVICE_ID="$USERS_CONTAINER_SERVICE_ID_NAME" --env APP_COS_PREFIX="$BINDING_PREFIX"

# Deploy the application
ibmcloud ce application deploy --name "$APP_NAME"

echo "Setup complete. Your application is now running."
echo "App User Service ID: $APP_USER_SERVICE_ID_NAME ($APP_USER_SERVICE_ID)"
echo "Users Container Service ID: $USERS_CONTAINER_SERVICE_ID_NAME ($USERS_CONTAINER_SERVICE_ID)"
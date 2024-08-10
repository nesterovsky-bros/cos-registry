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
  echo "  --app-user-service-id <service-id>        Service ID for app user (optional, defaults to app-name-app-user)"
  echo "  --users-container-service-id <service-id> Service ID for user management (optional, defaults to app-name-users-container)"
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

# Validate application name
if [[ ! "$APP_NAME" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]; then
  echo "Error: Application name must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character."
  exit 1
fi

# Set default values for optional parameters
COS_BUCKET_NAME=${COS_BUCKET_NAME:-$APP_NAME}
APP_USER_SERVICE_ID_NAME=${APP_USER_SERVICE_ID_NAME:-"$APP_NAME-app-user"}
USERS_CONTAINER_SERVICE_ID_NAME=${USERS_CONTAINER_SERVICE_ID_NAME:-"$APP_NAME-users-container"}

# Install jq if not present
if ! command -v jq &> /dev/null; then
  echo "Installing jq..."
  sudo apt-get install -y jq || { echo "Failed to install jq"; exit 1; }
fi

# Install IBM Cloud CLI if not present
if ! command -v ibmcloud &> /dev/null; then
  echo "Installing IBM Cloud CLI..."
  curl -fsSL https://clis.cloud.ibm.com/install/linux | sh || { echo "Failed to install IBM Cloud CLI"; exit 1; }
fi

# Install required IBM Cloud plugins if not present
for plugin in cloud-object-storage code-engine; do
  if ! ibmcloud plugin list | grep -q $plugin; then
    echo "Installing IBM Cloud plugin: $plugin"
    ibmcloud plugin install $plugin -f || { echo "Failed to install plugin: $plugin"; exit 1; }
  fi
done

# Login to IBM Cloud
echo "Logging in to IBM Cloud..."
ibmcloud login --apikey "$IBM_CLOUD_API_KEY" -r "$REGION" -g "$RESOURCE_GROUP" || { echo "Failed to login to IBM Cloud"; exit 1; }

# Select or create Code Engine project
echo "Checking Code Engine project..."
if ! ibmcloud ce project get --name "$CODE_ENGINE_PROJECT_NAME" --quiet 2>/dev/null; then
  echo "Creating Code Engine project..."
  ibmcloud ce project create --name "$CODE_ENGINE_PROJECT_NAME" --region "$REGION" --resource-group "$RESOURCE_GROUP" || { echo "Failed to create Code Engine project"; exit 1; }
fi

# Select Code Engine project
echo "Selecting Code Engine project..."
ibmcloud ce project select --name "$CODE_ENGINE_PROJECT_NAME" || { echo "Failed to select Code Engine project"; exit 1; }

# Check if application already exists
echo "Checking if application already exists..."
if ibmcloud ce application get --name "$APP_NAME" --quiet 2>/dev/null; then
  echo "Error: Application with name $APP_NAME already exists."
  exit 1
fi

# Check if configmap already exists
echo "Checking if configmap already exists..."
if ibmcloud ce secret get --name "${APP_NAME}-config" --quiet 2>/dev/null; then
  echo "Error: Configmap with name ${APP_NAME}-config already exists."
  exit 1
fi

# Create or select existing Cloud Object Storage instance
echo "Checking Cloud Object Storage instance..."
COS_INSTANCE_CRN_GUID=$(ibmcloud resource service-instance "$COS_INSTANCE_NAME" --id --quiet 2>/dev/null)
if [[ -z "$COS_INSTANCE_CRN_GUID" ]]; then
  echo "Creating Cloud Object Storage instance..."
  ibmcloud resource service-instance-create "$COS_INSTANCE_NAME" cloud-object-storage standard global -g "$RESOURCE_GROUP" || { echo "Failed to create Cloud Object Storage instance"; exit 1; }
  COS_INSTANCE_CRN_GUID=$(ibmcloud resource service-instance "$COS_INSTANCE_NAME" --id --quiet)
fi
COS_INSTANCE_CRN=$(echo "$COS_INSTANCE_CRN_GUID" | awk '{print $1}')
COS_INSTANCE_GUID=$(echo "$COS_INSTANCE_CRN_GUID" | awk '{print $2}')

# Create or reuse existing bucket
echo "Checking Cloud Object Storage bucket..."
if ! ibmcloud cos bucket-head --bucket "$COS_BUCKET_NAME" --region "$REGION" --output json 2>/dev/null; then
  echo "Creating Cloud Object Storage bucket..."
  ibmcloud cos bucket-create --bucket "$COS_BUCKET_NAME" --region "$REGION" --ibm-service-instance-id "$COS_INSTANCE_CRN" || { echo "Failed to create bucket"; exit 1; }
fi

# Create or reuse Service ID for app user
echo "Checking Service ID for app user..."
if ! ibmcloud iam service-id "$APP_USER_SERVICE_ID_NAME" --quiet 2>/dev/null; then
  echo "Creating Service ID for app user..."
  ibmcloud iam service-id-create "$APP_USER_SERVICE_ID_NAME" -d "Service ID for app user" || { echo "Failed to create Service ID for app user"; exit 1; }
fi
APP_USER_SERVICE_ID=$(ibmcloud iam service-id "$APP_USER_SERVICE_ID_NAME" --uuid --quiet)

# Create an API key for the Service ID
echo "Checking API key for app user..."
if ! ibmcloud iam service-api-key "$APP_USER_SERVICE_ID_NAME-api-key" "$APP_USER_SERVICE_ID_NAME" --quiet 2>/dev/null; then
  echo "Creating API key for app user..."
  APP_USER_API_KEY=$(ibmcloud iam service-api-key-create "$APP_USER_SERVICE_ID_NAME-api-key" "$APP_USER_SERVICE_ID_NAME" -d "API key for app user" --output JSON | jq -r .apikey) || { echo "Failed to create API key for app user"; exit 1; }
else
  APP_USER_API_KEY=$(ibmcloud iam service-api-key "$APP_USER_SERVICE_ID_NAME-api-key" "$APP_USER_SERVICE_ID_NAME" --output JSON | jq -r .apikey)
fi

# Assign write access to the Cloud Object Storage instance
echo "Assigning write access to Cloud Object Storage instance..."
if ! ibmcloud iam service-policies "$APP_USER_SERVICE_ID" --output json | jq -e '.[] | select(.resources[].attributes[].value == "'$COS_INSTANCE_GUID'") | select(.roles[].display_name == "Writer")' > /dev/null; then
  ibmcloud iam service-policy-create "$APP_USER_SERVICE_ID" --roles Writer --service-instance "$COS_INSTANCE_GUID" || { echo "Failed to assign write access to Cloud Object Storage instance"; exit 1; }
fi

# Assign IAM Identity keys inspection to the Service ID
echo "Assigning IAM Identity keys inspection to Service ID..."
if ! ibmcloud iam service-policies "$APP_USER_SERVICE_ID" --output json | jq -e '.[] | select(.resources[].attributes[].value == "iam-identity") | select(.roles[].display_name == "Operator")' > /dev/null; then
  ibmcloud iam service-policy-create "$APP_USER_SERVICE_ID" --roles Operator --service-name iam-identity || { echo "Failed to assign IAM Identity keys inspection to Service ID"; exit 1; }
fi

# Create or reuse Service ID for user management
echo "Checking Service ID for user management..."
if ! ibmcloud iam service-id "$USERS_CONTAINER_SERVICE_ID_NAME" --quiet 2>/dev/null; then
  echo "Creating Service ID for user management..."
  ibmcloud iam service-id-create "$USERS_CONTAINER_SERVICE_ID_NAME" -d "Service ID for user management" || { echo "Failed to create Service ID for user management"; exit 1; }
fi
USERS_CONTAINER_SERVICE_ID=$(ibmcloud iam service-id "$USERS_CONTAINER_SERVICE_ID_NAME" --uuid --quiet)

# Create configmap for application
echo "Creating configmap for application..."
ibmcloud ce secret create --name "${APP_NAME}-config" --from-literal=CLOUD_OBJECT_STORAGE_RESOURCE_INSTANCE_ID="$COS_INSTANCE_CRN" --from-literal=CLOUD_OBJECT_STORAGE_APIKEY="$APP_USER_API_KEY" --from-literal=APP_USERS_SERVICE_ID="$USERS_CONTAINER_SERVICE_ID" --from-literal=APP_BUCKET="$COS_BUCKET_NAME" || { echo "Failed to create configmap"; exit 1; }

# Create an application within the Code Engine project
echo "Creating application..."
ibmcloud ce application create --name "$APP_NAME" --source "$APP_REPO_URL" --commit "$APP_REPO_BRANCH" --build-strategy buildpacks --env-from-secret "${APP_NAME}-config" --scale-down-delay 120 --no-wait || { echo "Failed to create application"; exit 1; }

echo "Setup complete. Your application is now running."
echo "App User Service ID: $APP_USER_SERVICE_ID_NAME ($APP_USER_SERVICE_ID)"
echo "Users Container Service ID: $USERS_CONTAINER_SERVICE_ID_NAME ($USERS_CONTAINER_SERVICE_ID)"

#!/bin/bash

# Default values for optional parameters
APP_IMAGE_NAME="registry"
APP_REPO_URL="https://github.com/nesterovsky-bros/cos-registry.git"
APP_REPO_BRANCH="main"
USE_EXISTING_COS="false"

# Function to display help message
usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --resource-group <resource-group>         IBM Cloud resource group (required)"
  echo "  --region <region>                         IBM Cloud region (required)"
  echo "  --cos-instance-name <cos-instance-name>   Name of the Cloud Object Storage instance (required)"
  echo "  --cos-bucket-name <cos-bucket-name>       Name of the Cloud Object Storage bucket (required)"
  echo "  --app-user-service-id <service-id>        Service ID for app user (required)"
  echo "  --users-container-service-id <service-id> Service ID for user management (required)"
  echo "  --code-engine-project <project-name>      Code Engine project name (required)"
  echo "  --app-image-name <image-name>             Application image name (default: registry)"
  echo "  --app-repo-url <repo-url>                 Application repository URL (default: https://github.com/nesterovsky-bros/cos-registry.git)"
  echo "  --app-repo-branch <repo-branch>           Application repository branch (default: main)"
  echo "  --use-existing-cos                        Use existing Cloud Object Storage instance (default: false)"
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
    --app-user-service-id) APP_USER_SERVICE_ID_NAME="$2"; shift ;;
    --users-container-service-id) USERS_CONTAINER_SERVICE_ID_NAME="$2"; shift ;;
    --code-engine-project) CODE_ENGINE_PROJECT_NAME="$2"; shift ;;
    --app-image-name) APP_IMAGE_NAME="$2"; shift ;;
    --app-repo-url) APP_REPO_URL="$2"; shift ;;
    --app-repo-branch) APP_REPO_BRANCH="$2"; shift ;;
    --use-existing-cos) USE_EXISTING_COS="true"; ;;
    --api-key) IBM_CLOUD_API_KEY="$2"; shift ;;
    --help) usage ;;
    *) echo "Unknown parameter passed: $1"; usage ;;
  esac
  shift
done

# Check for required parameters
if [[ -z "$RESOURCE_GROUP" || -z "$REGION" || -z "$COS_INSTANCE_NAME" || -z "$COS_BUCKET_NAME" || -z "$APP_USER_SERVICE_ID_NAME" || -z "$USERS_CONTAINER_SERVICE_ID_NAME" || -z "$CODE_ENGINE_PROJECT_NAME" ]]; then
  echo "Error: Missing required parameters."
  usage
fi

# Check for IBM Cloud API key
if [[ -z "$IBM_CLOUD_API_KEY" ]]; then
  echo "Error: IBM_CLOUD_API_KEY environment variable is not set and --api-key is not provided."
  exit 1
fi

# Login to IBM Cloud
ibmcloud login --apikey $IBM_CLOUD_API_KEY -r $REGION -g $RESOURCE_GROUP

# Create or select existing Cloud Object Storage instance
if [[ "$USE_EXISTING_COS" == "true" ]]; then
  echo "Using existing Cloud Object Storage instance: $COS_INSTANCE_NAME"
else
  ibmcloud resource service-instance-create $COS_INSTANCE_NAME cloud-object-storage standard global
fi

# Create a new bucket in Cloud Object Storage
ibmcloud cos bucket-create --bucket $COS_BUCKET_NAME --ibm-service-instance-id $(ibmcloud resource service-instance $COS_INSTANCE_NAME --id)

# Create a new Service ID for the application
ibmcloud iam service-id-create $APP_USER_SERVICE_ID_NAME -d "Service ID for app user"
APP_USER_SERVICE_ID=$(ibmcloud iam service-id $APP_USER_SERVICE_ID_NAME --uuid)

# Create an API key for the Service ID
APP_USER_API_KEY=$(ibmcloud iam service-api-key-create app-user-api-key $APP_USER_SERVICE_ID_NAME -d "API key for app user" --output JSON | jq -r .apikey)

# Assign write access to the Cloud Object Storage instance
ibmcloud iam service-policy-create $APP_USER_SERVICE_ID --roles Writer --service-name cloud-object-storage --service-instance $COS_INSTANCE_NAME

# Assign IAM Identity keys inspection to the Service ID
ibmcloud iam service-policy-create $APP_USER_SERVICE_ID --roles Operator --service-name iam-identity

# Create another Service ID for user management
ibmcloud iam service-id-create $USERS_CONTAINER_SERVICE_ID_NAME -d "Service ID for user management"
USERS_CONTAINER_SERVICE_ID=$(ibmcloud iam service-id $USERS_CONTAINER_SERVICE_ID_NAME --uuid)

# Create a Code Engine project
ibmcloud ce project create --name $CODE_ENGINE_PROJECT_NAME --region $REGION --resource-group $RESOURCE_GROUP

# Bind the Cloud Object Storage service to the Code Engine project
ibmcloud ce project select --name $CODE_ENGINE_PROJECT_NAME
ibmcloud ce secret create --name cos-binding --from-literal "cos_api_key=$APP_USER_API_KEY" --from-literal "cos_instance_id=$(ibmcloud resource service-instance $COS_INSTANCE_NAME --id)"

# Create an application within the Code Engine project
ibmcloud ce application create --name registry-app --image $APP_IMAGE_NAME --source $APP_REPO_URL --branch $APP_REPO_BRANCH --build-strategy buildpacks --env APP_BUCKET=$COS_BUCKET_NAME --env APP_USER_SERVICE_ID=$USERS_CONTAINER_SERVICE_ID_NAME

# Deploy the application
ibmcloud ce application deploy --name registry-app

echo "Setup complete. Your application is now running."

#### Running the Script with Parameters
##1. Save the script as `cloud-setup.sh`.
#2. Make the script executable:
#   ```sh
#   chmod +x cloud-setup.sh
#   ```
#3. Run the script with named parameters, including the API key:
#   ```sh
#   ./cloud-setup.sh --resource-group my-resource-group --region us-east --cos-instance-name my-cos-instance --cos-bucket-name my-bucket --app-user-service-id my-app-user --users-container-service-id my-users-container --code-engine-project my-registry --app-image-name my-app-image --app-repo-url https://github.com/my-repo.git --app-repo-branch develop --use-existing-cos --api-key my-ibm-cloud-api-key
#   ```


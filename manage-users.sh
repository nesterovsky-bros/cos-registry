#!/bin/bash

# Function to display help message
usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --action <action>                         Action to perform (create, delete, lock, unlock, change-role) (required)"
  echo "  --role <role>                             Role (reader, writer, owner) (required for create)"
  echo "  --users-container <users-container>       Users container name (required)"
  echo "  --user <user>                             Name of API key (required)"
  echo "  --api-key <api-key>                       IBM Cloud API key (optional, can also be set via IBM_CLOUD_API_KEY environment variable)"
  echo "  --help                                    Display this help message"
  exit 1
}

# Parse named parameters
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --action) ACTION="$2"; shift ;;
    --role) ROLE="$2"; shift ;;
    --users-container) USERS_CONTAINER="$2"; shift ;;
    --user) USER="$2"; shift ;;
    --api-key) IBM_CLOUD_API_KEY="$2"; shift ;;
    --help) usage ;;
    *) echo "Unknown parameter passed: $1"; usage ;;
  esac
  shift
done

# Check for required parameters
if [[ -z "$ACTION" || -z "$USERS_CONTAINER" || -z "$USER" ]]; then
  echo "Error: Missing required parameters."
  usage
fi

# Check for IBM Cloud API key
if [[ -z "$IBM_CLOUD_API_KEY" ]]; then
  echo "Error: IBM_CLOUD_API_KEY environment variable is not set and --api-key is not provided."
  exit 1
fi

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

# Login to IBM Cloud
echo "Logging in to IBM Cloud..."
ibmcloud login --apikey "$IBM_CLOUD_API_KEY" --quiet || { echo "Failed to login to IBM Cloud"; exit 1; }

# Get Service ID for users container
USERS_CONTAINER_SERVICE_ID=$(ibmcloud iam service-id "$USERS_CONTAINER" --uuid --quiet)

# Perform action
case $ACTION in
  create)
    if [[ -z "$ROLE" ]]; then
      echo "Error: --role is required for create action."
      usage
    fi
    echo "Creating API key for user..."
    API_KEY=$(ibmcloud iam service-api-key-create "$USER" "$USERS_CONTAINER" -d '{"role": "'$ROLE'", "include": ["*"], "exclude": [], "accesskey": ""}' --force --output JSON | jq -r .apikey) || { echo "Failed to create API key"; exit 1; }
    echo "Updating API key description with access key..."
    ibmcloud iam service-api-key-update "$USER" "$USERS_CONTAINER" -d '{"role": "'$ROLE'", "include": ["*"], "exclude": [], "accesskey": "'$API_KEY'"}' --force || { echo "Failed to update API key description"; exit 1; }
    echo "Access key: $API_KEY"
    ;;
  delete)
    echo "Deleting API key for user..."
    ibmcloud iam service-api-key-delete "$USER" "$USERS_CONTAINER" --force || { echo "Failed to delete API key"; exit 1; }
    ;;
  lock)
    echo "Locking API key for user..."
    ibmcloud iam service-api-key-lock "$USER" "$USERS_CONTAINER" --force || { echo "Failed to lock API key"; exit 1; }
    ;;
  unlock)
    echo "Unlocking API key for user..."
    ibmcloud iam service-api-key-unlock "$USER" "$USERS_CONTAINER" --force || { echo "Failed to unlock API key"; exit 1; }
    ;;
  change-role)
    if [[ -z "$ROLE" ]]; then
      echo "Error: --role is required for change-role action."
      usage
    fi
    echo "Changing role for API key..."
    DESCRIPTION=$(ibmcloud iam service-api-key "$USER" "$USERS_CONTAINER" --output JSON | jq -r .description)
    UPDATED_DESCRIPTION=$(echo "$DESCRIPTION" | jq '.role = "'$ROLE'"')
    ibmcloud iam service-api-key-update "$USER" "$USERS_CONTAINER" -d "$UPDATED_DESCRIPTION" --force || { echo "Failed to update API key description"; exit 1; }
    echo "Role updated to $ROLE"
    ;;
  *)
    echo "Unknown action: $ACTION"
    usage
    ;;
esac

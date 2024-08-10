import "dotenv-expand/config";

const error = (message: string) => { throw message };
const local = toBoolean(process.env.APP_LOCAL);
const region = process.env.CE_REGION ?? error("CE_REGION");
const port = toNumber(process.env.PORT) ?? 8080;

const url = process.env.APP_URL ??
  (local || !process.env.CE_APP || !process.env.CE_SUBDOMAIN || !process.env.CE_DOMAIN ? 
    `http://localhost:${port}/` : 
    `https://${process.env.CE_APP}.${process.env.CE_SUBDOMAIN}.${process.env.CE_DOMAIN}/`);

const cosPrefix = process.env.APP_COS_PREFIX ?? "CLOUD_OBJECT_STORAGE";

export const options =
{
  local,
  port,
  url,
  title: process.env.APP_TITLE ?? "Registry",
  region,

  // Clould Object Storage binding is required.
  cos:
  {
    endpoints: process.env[`${cosPrefix}_ENDPOINTS`] ?? "https://control.cloud-object-storage.cloud.ibm.com/v2/endpoints",
    resourceInstanceId: process.env[`${cosPrefix}_RESOURCE_INSTANCE_ID`] ??
      error(`${cosPrefix}_RESOURCE_INSTANCE_ID`),
    apiKey: process.env[`${cosPrefix}_APIKEY`] ?? error(`${cosPrefix}_APIKEY`),
  },

  // Bucket is required.
  bucket: process.env.APP_BUCKET ?? error("APP_BUCKET"),

  iamApiUrl: process.env.IAM_API_URL ?? "https://iam.cloud.ibm.com/v1/",
  apiKey: process.env.APP_APIKEY ?? process.env[`${cosPrefix}_APIKEY`],
  
  // Users Service ID is required.
  usersServiceId: process.env.APP_USERS_SERVICE_ID ?? error("APP_USERS_SERVICE_ID"),

  authCacheSize: toNumber(process.env.APP_AUTH_CACHE_SIZE) ?? 1000,
  authCacheExpirationInMinutes: toNumber(process.env.APP_AUTH_CACHE_TTL_MINUTES) ?? 10 * 60 * 1000,
  github: process.env.APP_GITHUB ?? "https://github.com/nesterovsky-bros/cos-registry",

  api: [] as 
  {
    name: string;
    url: string;
    description?: string;
  }[],
};

function toBoolean(value: any)
{
  if (typeof value === "string")
  {
    value = value.trim().toLowerCase();

    return value === "1" || value === "true" || value === "yes";
  }

  if (typeof value === "number")
  {
    return value > 0;
  }

  return null;
}

function toNumber(value: any)
{
  if (typeof value == "string")
  {
    value = Number(value);
  }

  if (typeof value === "number" && !isNaN(value))
  {
    return  value;
  }

  return null
}

# Registry application

Registry is a web application with primitive UI to support virtual file system.  
Supports HTTP GET, PUT, and DELETE, used by maven, to browse and manipulate the data.  
Implements Nuget and NPM REST API.  
Access to the application is authorized.

Registry stores data in IBM Cloud Object Storage instance accessed by dedicated Service ID not exposed to the end user.  
Users are granted access rights by the owner who manages them in IAM API Keys dashboard of another dedicated Service ID.    
Access rights are granted for read or write and are subject of directory filtering.

# TODO: Explain following in details.

# User

Given a url and an access token users configure https endpoints in maven, nuget, npm or in other tool.

# Owner

## Steps to create and manage registry application.

1. Create or select existing IBM Cloud Object Storage instance.
2. Create or select new bucket.
3. Create a Service ID (called later `APP_USER`) that should be used to access Cloud Object Storage and IAM Identity service to inspect keys.
4. Create Access Key for the `APP_USER`.
5. Assign Cloud Object Storage write access to the `APP_USER`.
6. Assign IAM Identity keys inspection to then `API_USER`. It should be either role Operator or a custom role containing action `iam-identity.apikey.get`
7. Create another Service ID (called later `USERS_CONTAINER`) that will be used create access keys with grants to access application.
8. Create a Code Engine project.
9. Create service binding to Cloud Object Storage using Access Key for `APP_USER`. Make sure service binding prefix is default - `CLOUD_OBJECT_STORAGE`.
10. Create application either from existing image or from GitHub sources.
11. Define following environment variables:
  `APP_BUCKET` - with the bucket name.
  `APP_USER_SERVICE_ID` - with the `USERS_CONTAINER`.
12. Run application.
13. Create API Keys within `USERS_CONTAINER` to grant access to users. 
Give access keys to the users.

While creating API Key for a new user use description to configure access rights.
It should contain valid JSON object in format:

```JSON
{
  "role": "reader"|"writer"|"owner", // If not specified then "reader" is assumed.
  "include": string[], // optional array of glob patterns of included folders; defaults to whole tree.
  "exclude": string[], // optional array of glob patterns of excluded folders; defaults to none.
  ... // any other field, e.g. accesskey to memorize.
}
```

# Developer

There are more environment variable to play with.

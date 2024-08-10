# Registry Application

- The Registry is a web application with a basic UI to support a virtual file system.
- It supports HTTP GET, PUT, and DELETE methods, used by Maven, to browse and manipulate data.
- It implements NuGet and NPM REST APIs.
- Access to the application is authorized.

- The Registry stores data in an IBM Cloud Object Storage instance accessed by a dedicated Service ID, which is not exposed to the end user.
- Users are granted access rights by the owner, who manages them in the IAM API Keys dashboard of another dedicated Service ID.
- Access rights are granted for read or write and are subject to directory filtering.

# User

Users can configure Maven, NuGet, NPM, or other tools to use the application as a private registry.

## Steps to Configure Maven

### 1. Configure `settings.xml`
Define repositories and credentials in the `settings.xml` file, which is typically located in the `${MAVEN_HOME}/conf` directory or the `${USER_HOME}/.m2` directory.

#### Adding Repositories
Add repositories in the `profiles` section of the `settings.xml` file. Here’s an example:

```xml
<settings>
  <servers>
    <server>
      <id>my-private-repo</id>
      <username>your-username</username>
      <password>your-password</password>
    </server>
  </servers>

  <profiles>
    <profile>
      <id>private-repo-profile</id>
      <repositories>
        <repository>
          <id>my-private-repo</id>
          <url>https://your-private-repo-url/repository/</url>
        </repository>
      </repositories>
    </profile>
  </profiles>

  <activeProfiles>
    <activeProfile>private-repo-profile</activeProfile>
  </activeProfiles>
</settings>
```

Replace `my-private-repo`, `your-username`, `your-password`, and `https://your-private-repo-url/repository/` with your repository ID, credentials, and URL.

### 2. Deploying Artifacts
To deploy artifacts, use the `deploy:deploy-file` goal to specify the repository URL and credentials directly in the command line or in a profile.

Here’s an example of how to deploy an artifact using the `deploy:deploy-file` goal:

```sh
mvn deploy:deploy-file -DgroupId=com.example -DartifactId=my-artifact -Dversion=1.0.0
  -Dpackaging=jar -Dfile=path-to-your-artifact.jar
  -DrepositoryId=my-private-repo
  -Durl=https://your-private-repo-url/repository/maven-releases/
```

### 3. Using the Private Repository in Other Projects
To use the private repository in other projects, ensure that the `settings.xml` file on the machines where these projects are built includes the profile with the repository configuration.

## Steps to Configure NuGet

### 1. Add the Private NuGet Source
Use the `dotnet nuget add source` command to add your private NuGet source. Replace `source-name`, `https://your-private-repo-url/nuget/v3/index.json`, `your-username`, and `your-password` with your repository name, URL, and credentials.

```sh
dotnet nuget add source --name source-name
  --username your-username
  --password your-password
  --store-password-in-clear-text https://your-private-repo-url/nuget/v3/index.json
```

# Owner

## Steps to Create and Manage the Registry Application

### TL;DR
The following are lengthy steps on the IBM Cloud site to configure and manage a new registry application. If you prefer not to follow detailed instructions, you can use the [cloud-setup.sh](cloud-setup.sh) and [manage-users.sh](manage-users.sh) that will do all the work for you.

### Detailed Steps

1. Create or select an existing IBM [Cloud Object Storage](https://cloud.ibm.com/objectstorage) instance (referred to later as `CLOUD_OBJECT_STORAGE`).

- Cloud Object Storage  
  <img src="docs/images/cos_create.png" alt="Cloud Object Storage" width="400">

- Create Instance  
  <img src="docs/images/cos_create_instance.png" alt="Create Instance" width="400">  

- Storage Configuration   
  <img src="docs/images/cos_instance_configuration.png" alt="Storage Configuration" width="400">

2. Create a new bucket in "Cloud Object Storage"/"Instances"/`CLOUD_OBJECT_STORAGE` (referred to later as `APP_BUCKET`).

- Create Bucket  
  <img src="docs/images/create-bucket.png" width="400">

- Use Simple Bucket Configuration  
  <img src="docs/images/simple_bucket_configuration.png" width="200">

- Select Bucket Parameters  
  <img src="docs/images/bucket_parameters.png" width="400">

- Mutable Without Versioning  
  <img src="https://github.com/user-attachments/assets/563cbd34-b2dd-42f1-8d58-c3a1627659e7" width="400">

- Don't Expose It as a Static Site  
  <img src="docs/images/cos_no_static_site.png" width="400">

- If you get lost after creation, go to the Resource List and  
  <img src="docs/images/resource_list.png" width="200">

- Select Storage  
  <img src="docs/images/resource_list_storage.png" width="200">

3. Create a new [Service ID](https://cloud.ibm.com/iam/serviceids) (referred to later as `APP_USER`) that will be used to access Cloud Object Storage and IAM Identity service to validate users.
Take note of the `ID` of `APP_USER` by clicking "Details".

- Service ID  
  <img src="docs/images/serviceids.png" width="400">

- Create Service ID  
  <img src="docs/images/create_serviceid.png" width="400">

4. Click API Keys of the `APP_USER` Service ID, and create an Access Key. Note its name and access key.

- Service ID API Keys  
  <img src="docs/images/serviceid_api_keys.png" width="400">
  
- Create API Key  
  <img src="docs/images/create_api_key.png" width="400">

- API Key Created  
  <img src="docs/images/api_key_created.png" width="400">
   
5. Assign write access for `APP_USER` to `CLOUD_OBJECT_STORAGE`.

- Click "Assign Access" in the Access tab of the Service ID `APP_USER`  
  <img src="docs/images/serviceid_access_policies.png" width="400">
  
- Follow the "Assign Access" wizard and select the `CLOUD_OBJECT_STORAGE` service  
  <img src="docs/images/assign_policies_to.png" width="400">
  
- All Resources, and "Writer" Role  
  <img src="docs/images/cos_access_policy_review.png" width="400">
  
- Verify, Add, and then assign the access.  
  <img src="docs/images/cas_policy_assign.png" width="400">
  
6. Assign IAM Identity keys inspection to the `API_USER`.

- Click "Assign Access" in the Access tab of the Service ID `APP_USER`  
  <img src="docs/images/serviceid_access_policies.png" width="400">
  
- Follow the "Assign Access" wizard and select the `IAM Identity Service` service, All Resources, and "Operator" role or a custom role containing the action `iam-identity.apikey.get`. Verify, Add, and then assign the access.  
  <img src="docs/images/create_iam_identity_access.png" width="400">

7. Create another [Service ID](https://cloud.ibm.com/iam/serviceids) (referred to later as `USERS_CONTAINER`) that will be used to create access keys with grants to access the application.

- Create Service ID  
  <img src="docs/images/user_container.png" width="400">
  
8. Create a [Code Engine project](https://cloud.ibm.com/codeengine/projects) (referred to later as `MY_REGISTRY`). During project creation, make sure you select the correct project location and a resource group. In general, it should be the same as for `CLOUD_OBJECT_STORAGE`.

- Cloud Engine Projects  
  <img src="docs/images/cloud_engine_projects.png" width="400">

- Create Project  
  <img src="docs/images/cloud_engine_create_project.png" width="300">

- Click Create and then follow the project link to go to the project page  
  <img src="docs/images/code_engine_registry_project.png" width="400">
  
9. Go to the "Project Settings"/"Integrations"

- to configure service bindings and connect it to a resource group and then to configure "Container Registry" - this is the place where application images are stored  
  <img src="docs/images/code_engine_integrations.png" width="400">

10. Inside the `MY_REGISTRY` project, create a new "service binding" to Cloud Object Storage using the Access Key for `APP_USER`. 
- Service Binding  
  <img src="docs/images/code_engine_project_service_binding.png" width="400">

- Select Service  
  <img src="docs/images/code_engine_project_select_service_binding.png" width="400">
  
- Make sure the service binding prefix is an empty value. During service binding, select `APP_USER` as the service credential, and verify that the role is `Writer`.  
  <img src="docs/images/code_engine_service_binding_properties.png" width="400"/>
  
11. Create an application within the project 

- Select "Applications" and click "Create"  
<img src="docs/images/code_engine_create_application.png" width="400">

- Configure the image to build from source, and click "Specify Build Details"  
<img src="docs/images/code_engine_create_application_properties.png" width="400">

- where you put repository details  
<img src="docs/images/code_engine_application_source.png" width="400">

- select "Cloud Native Buildpack" build strategy  
<img src="docs/images/code_engine_application_build.png" width="400">

- Select a registry server (e.g., private.icr.io), select or create a registry secret (e.g., "Code Engine managed secret"), select namespace and define image name  
<img src="docs/images/code_engine_application_build_output.png" width="400">

- In the Resources & Scaling section, set "Scale-down delay" to a non-zero value (e.g., 120 seconds).  
<img src="docs/images/code_engine_application_scaling_delay.png" width="400">

In the environment variable section, add the following variables:   
  - `APP_BUCKET` - with the bucket name.  
  - `APP_USER_SERVICE_ID` - with the `USERS_CONTAINER`.  
<img src="docs/images/code_engine_application_environment.png" width="400">

Create the instance  
<img src="docs/images/code_engine_application_create_instance.png" width="400">

12. Build and deploy the application image.

- In "Image Builds" of the application, you can see existing build runs  
  <img src="docs/images/code_engine_application_image_build.png" width="400">

- or create a new build  
  <img src="docs/images/code_engine_application_create_image.png" width="400">

- go into the application (notice the "**Open URL**" link), and  
  <img src="docs/images/code_engine_application_page.png" width="400">

- then into configuration and click "Redeploy"  
  <img src="docs/images/code_engine_application_redeploy.png" width="400">
  
  After this step, the application is up and running, so you can open the application URL.
13. The final administrative step is to manage users.

- Go to Access (IAM)  
  <img src="docs/images/iam.png" width="400">

- into API Keys of the [Service ID](https://cloud.ibm.com/iam/serviceids) `USERS_CONTAINER`  
  <img src="docs/images/users_container_api_keys.png" width="400">
  
- Create an API Key for a user.  
  <img src="docs/images/create_user_key.png" width="400">

- The API key secret should be given to the users.
<img src="docs/images/user_key_secret.png" width="400">

- Use the Description to configure access rights. It should contain JSON in the format:

```JSON
{
  "role": "reader or writer or owner", 
  "include": ["glob"],
  "exclude": ["glob"]
}
```

- If "role" is not specified, then "reader" is assumed.
- If "include" is not specified, then access is permitted to the whole tree; otherwise, only to a subtree matched to some include glob.
- If "exclude" is not specified, then access is not additionally restricted; otherwise, it's restricted to subtrees matched to any exclude glob.
- Other properties are permitted, e.g., `"accesskey": "secret"` to memorize the API Key secret.  

<img src="docs/images/users_container_key_settings.png" width="400">

Repeat the last step for all users.  

That's all!

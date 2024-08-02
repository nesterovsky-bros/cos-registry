export interface Nuspec
{
  id: string;
  version: string;
  authors?: string|null;
  readme?: string|null;
  copyright?: string|null;
  requireLicenseAcceptance?: boolean|null;
  license?: string|null; 
  licenseUrl?: string|null; 
  title?: string|null;
  description?: string|null;
  icon?: string|null;
  releaseNotes?: string|null;
  tags?: string[]|null;
  projectUrl?: string|null;
  repository?: 
  {
    type?: string|null;
    url?: string|null;
    commit?: string|null;
  }|null;
  dependencyGroups?:
  {
    targetFramework: string;
    dependencies?:
    {
      id: string;
      version: string;
      exclude?: string|null;
    }[]|null
  }[]|null;
}

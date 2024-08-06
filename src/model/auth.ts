export interface Apikey
{
  id: string,
  locked?: boolean,
  disabled?: boolean,
  name?: string,
  description?: string,
  iam_id: string,
};

export type Role = "none" | "reader" | "writer" | "owner";

export interface AuthInfo
{
  apiKey?: Apikey|null,
  accessKey?: string|null;
  role: Role;
  settings?: any;
  match?: (path: string) => boolean;
  from?: "accessKey"|"authHeader";
}

declare global 
{
  namespace Express 
  {
    interface Request 
    {
      authInfo?: AuthInfo;
    }
  }
}


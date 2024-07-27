export interface AuthInfo
{
	apiKey?: Apikey|null,
	accessKey?: string|null;
	access: "read" | "write" | "none";
	settings?: any;
	match?: (path: string) => boolean;
	type?: "accessKey"|"authHeader";
}

export interface Apikey
{
	id: string,
	locked?: boolean,
	disabled?: boolean,
	name?: string,
	description?: string,
	iam_id: string,
};

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
import { NextFunction, Request, Response } from "express";
import { Apikey } from "./model/auth.js";
import { caching } from "cache-manager";
import { Minimatch } from "minimatch";

const error = (message: string) => { throw message };

const imaApiUrl = process.env.IAM_API_URL ?? error("No IAM_API_URL is defined.");
const serviceApiKey = process.env.SERVICE_API_KEY ?? error("No SERVICE_API_KEY is defined.");
const resourceIamId = process.env.RESOURCE_IAM_ID ?? error("No RESOURCE_IAM_ID is defined.");

const memoryCache = await caching('memory', 
{
    max: Number.isInteger(process.env.AUTH_CACHE_SIZE) ? 
        Number(process.env.AUTH_CACHE_SIZE) : 1000,
    ttl: (Number.isInteger(process.env.AUTH_CATCH_TTL_MINUTES) ? 
        Number(process.env.AUTH_CATCH_TTL_MINUTES) : 10) * 60 * 1000
});

export function unauthorized(request: Request, response: Response)
{
	response.status(401).set("WWW-Authenticate", "Basic").send("Unauthorized");
}

export function forbidden(request: Request, response: Response)
{
	response.status(403).send("Forbidden");
}

export function notfound(request: Request, response: Response)
{
	response.status(404).send("Not Found");
}

export function authorize(minAccess: "read" | "write", allowUnauthorized = false)
{
    return async (request: Request, response: Response, next: NextFunction) =>
    {
        let authInfo = request.authInfo;

Check:        
        if (!authInfo)
        {
            authInfo = request.authInfo = { access: "none" };

            let accessKey = request.query.accessKey;
    
            if (typeof accessKey === "string")
            {
                authInfo.type = "accessKey";
            }
            else
            {
                authInfo.type = "authHeader";

                const header = request.header("Authorization");
        
                if (!header)
                {
                    break Check;
                }
        
                if (header.startsWith("Bearer ")) 
                {
                    accessKey = header.substring("Bearer ".length);
                }
                else if (header.startsWith("Basic "))
                {
                    accessKey = Buffer.
                        from(header.substring("Basic ".length), "base64").
                        toString("utf-8");
        
                    const p = accessKey.indexOf(":");
        
                    if (p >= 0)
                    {
                        accessKey = accessKey.substring(p + 1);				
                    }
                }
                else
                {
                    break Check;
                }
            }
        
            if (!accessKey)
            {
                break Check;
            }

            authInfo.accessKey = accessKey;
        
            let apiKey: Apikey | undefined | null = await memoryCache.get(accessKey);
        
            if (apiKey === undefined)
            {
                const detailsResponse = await fetch(`${imaApiUrl}apikeys/details`, 
                {
                    headers: 
                    {
                        'IAM-Apikey': accessKey,
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + btoa(`apikey:${serviceApiKey}`)
                    }
                });
        
                if (detailsResponse.ok)
                {
                    apiKey =  await detailsResponse.json();
                }
        
                if (!apiKey)
                {
                    apiKey = null;			
                }
            
                memoryCache.set(accessKey, apiKey);
            }

            authInfo.apiKey = apiKey;
        
            if (!apiKey || apiKey.locked || apiKey.disabled || apiKey.iam_id !== resourceIamId)
            {
                break Check;
            }
        
            let settings: any = null;
        
            if (apiKey.description)
            {
                try
                {
                    authInfo.settings = settings = JSON.parse(apiKey.description);
                }
                catch
                {
                    // Continue without settings.
                }
            }
        
            const access = settings?.access ?? "read";
        
            if (access !== "read" && access !== "write")
            {
                break Check;
            }

            const includeMatches = !settings ? [] :
                typeof settings.include === "string" ? [new Minimatch(settings.include)] :
                Array.isArray(settings.include) ? 
                    (settings.include as []).
                        filter(item => typeof item === "string").
                        map(item => new Minimatch(item)) :
                [];
        
            const excludeMatches = !settings ? [] :
                typeof settings.exclude === "string" ? [new Minimatch(settings.exclude)] :
                Array.isArray(settings.exclude) ? 
                    (settings.exclude as []).
                        filter(item => typeof item === "string").
                        map(item => new Minimatch(item)) :
                [];
        
            const match = !includeMatches.length && !excludeMatches.length ?
                () => true :
                (path: string) => 
                    !includeMatches.length || includeMatches.some(match => match.match(path, true) &&
                    !excludeMatches.length || !excludeMatches.some(match => match.match(path, true)));

            authInfo.match = match;
        
            if (!match(request.path.substring(1)))
            {
                break Check;
            }
    
            if (access === "write" || access === "read" && (minAccess == "read"))
            {
                authInfo.access = access;
            }
        }

        if (authInfo.access == "none" && !allowUnauthorized)
        {
            if (authInfo.accessKey)
            {
                forbidden(request, response);
            }
            else
            {
                unauthorized(request, response);
            }
        }
        else
        {
            next();
        }
    };
}

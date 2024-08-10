import { NextFunction, Request, Response } from "express";
import { caching } from "cache-manager";
import { Minimatch } from "minimatch";
import { options } from "./options.js";
import { Apikey, AuthInfo, Role } from "./model/auth.js";

const memoryCache = await caching('memory', 
{
  max: options.authCacheSize,
  ttl: options.authCacheExpirationInMinutes
});

export function validpath(path: string|null|undefined)
{
  return !!path && 
    path !== "api" && 
    path !== "README" && 
    !path.startsWith("api/") && 
    !new Minimatch(path).hasMagic();
}

export function matchrole(authInfo: AuthInfo|undefined|null, role: Role)
{
  const authRole = authInfo?.role;

  switch(role)
  {
    case "reader":
    {
      return authRole === "reader" || authRole === "writer" || authRole === "owner";
    }
    case  "writer":
    {
      return authRole === "writer" || authRole === "owner";
    }
    case "owner":
    {
      return authRole === "owner";
    }
    default:
    {
      return true;      
    }
  }
}

export function unauthorized(_: Request, response: Response)
{
  response.status(401).set("WWW-Authenticate", "Basic").send("Unauthorized");
}

export function forbidden(_: Request, response: Response)
{
  response.status(403).send("Forbidden");
}

export function notfound(_: Request, response: Response)
{
  response.status(404).send("Not Found");
}

export function servererror(_: Request, response: Response, error?: Error|string)
{
  const statusCode: number|undefined = (error as any)?.statusCode;

  if (statusCode === 404)
  {
    notfound(_, response);
  } 
  else
  {
    response.status(statusCode ?? 500).
    send(typeof error === "string" ? error : error?.message);
  }
}

export async function authenticate(request: Request, _: Response, next: NextFunction)
{
  let authInfo = request.authInfo;

Check:  
  if (!authInfo)
  {
    authInfo = request.authInfo = { role: "none" };

    let accessKey = request.query.accessKey;
    
    if (typeof accessKey === "string")
    {
      authInfo.from = "accessKey";
    }
    else
    {
      authInfo.from = "authHeader";

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
      const detailsResponse = await fetch(`${options.iamApiUrl}apikeys/details`, 
      {
        headers: 
        {
          'IAM-Apikey': accessKey,
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + btoa(`apikey:${options.apiKey}`)
        }
      });
    
      apiKey =  detailsResponse.ok ? await detailsResponse.json() ?? null : null;
      memoryCache.set(accessKey, apiKey);
    }

    authInfo.apiKey = apiKey;

    const owner = accessKey === options.apiKey;
    
    if (!apiKey || apiKey.locked || apiKey.disabled || 
      !owner && 
      apiKey.iam_id !== options.usersServiceId &&
      apiKey.iam_id !== `iam-${options.usersServiceId}`)
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

    const role: Role = owner ? "owner" : settings?.role ?? "reader";
    
    if (role !== "reader" && role !== "writer" && role !== "owner")
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
  
    const match = owner || !includeMatches.length && !excludeMatches.length ?
      () => true :
      (path: string) => 
        !includeMatches.length || includeMatches.some(match => match.match(path, true) &&
        !excludeMatches.length || !excludeMatches.some(match => match.match(path, true)));

    authInfo.match = match;
    authInfo.role = role;
  }

  next();
}

export function authorize(role: Role)
{
  return (request: Request, response: Response, next: NextFunction) => 
    authenticate(request, response, () =>
    {
      const authInfo = request.authInfo!;

      if (authInfo?.match?.(request.path.substring(1)) !== false && 
        matchrole(authInfo, role))
      {
        next();
      }
      else if (authInfo.accessKey)
      {
        forbidden(request, response);
      }
      else
      {
        unauthorized(request, response);
      }
    });
}

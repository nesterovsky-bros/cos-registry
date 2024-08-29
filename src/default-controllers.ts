import fs from "fs";
import zlib from "node:zlib";
import tar from "tar-stream";
import { Express, NextFunction, Request, Response } from "express";
import { authenticate, authorize, forbidden, matchrole, notfound, servererror, validpath } from "./authorize.js";
import { copy, copyOne, deleteObjects, getObjectHeader, getObjectStream, getZipDirectory, listObjects, setObjectStream } from "./store.js";
import multer from "multer";
import { listDirectory } from "./directory-list.js";
import { options } from "./options.js";

const upload = multer({ dest: 'uploads/', preservePath: true })

export function defaultControllers(app: Express)
{
  app.get("/README", readme);
  app.get("/favicon.ico", authenticate, favicon);
  app.get("*", authorize("reader"), read);
  app.put("*", authorize("writer"), put);  
  app.delete("*", authorize("writer"), delete_);  
  app.post("*", authorize("reader"), upload.any(), post);

  options.api.push(
  {
    name: "http",
    url: options.url,
    description: "Http GET, PUT, DELETE and primitive UI. Also used by maven."
  });
}

function readme(_: Request, response: Response) 
{
  response.redirect(`${options.github}#readme`);
}

function favicon(request: Request, response: Response) 
{
  response.set("Cache-Control", "max-age=604800");

  if (matchrole(request.authInfo, "reader"))
  {
    getObjectStream(decodeURI(request.path).substring(1)).
      on("error", error => (error as any)?.statusCode === 404 ? 
        defaultFavicon(request, response) :
        servererror(request, response, error)).
      pipe(response);
  }
  else
  {
    defaultFavicon(request, response);
  }
}

function defaultFavicon(_: Request, response: Response)
{
  response.sendFile("favicon.svg", { root: import.meta.dirname });
}

async function read(request: Request, response: Response) 
{
  response.set("Cache-Control", "max-age=60");

  const path = decodeURI(request.path);
  const zipIndex = path.toLowerCase().indexOf(".zip");

  if (zipIndex >= 0)
  {
    const zip = path.substring(0, zipIndex + 4);
    const entry = path.substring(zipIndex + 4);

    try
    {
      const header = await getObjectHeader(zip.substring(1));

      if (header?.DeleteMarker !== false)
      {
        if (!entry)
        {
          listDirectory(request, response, zip, "/", header);
        }
        else if (entry.endsWith("/"))
        {
          listDirectory(request, response, zip, entry);
        }
        else
        {
          const entryPath = entry.substring(1);
          const directory = await getZipDirectory(zip.substring(1), header);
          const file = directory.files.find(file => file.path === entryPath);

          if (!file)
          {
            notfound(request, response);
          }
          else
          {
            contentType(path, response);

            file.stream().
              on("error", error => servererror(request, response, error)).
              pipe(response);
          }
        }

        return;
      }
    }
    catch(e)
    {
      // No object found. Continue regular.
    }
  }

  if (path.endsWith("/"))
  {
    try
    {
      await listDirectory(request, response, path);
    }
    catch(error)
    {
      servererror(request, response, error as Error);
    }
  }
  else
  {
    streamObject(path.substring(1), request, response);
  }
}

function contentType(path: string, response: Response)
{
  path = path.toLowerCase();

  const p = path.lastIndexOf(".");

  if (p >= 0)
  {
    const extension = path.substring(p);

    switch(extension)
    {
      case ".pom":
      case ".nuspec":
      {
        response.contentType("text/xml");
    
        return true;
      }
      case ".md":
      {
        response.contentType("text/html");
    
        return true;
      }
      case ".ab":
      case ".cob":
      case ".cpy":
      {
        response.type(".txt");
    
        return true;
      }
      default:
      {
        response.type(extension);

        return true;
      }
    }
  }

  return false;
}

function streamObject(path: string, request: Request, response: Response)
{
  contentType(path, response);

  getObjectStream(path).
    on("error", error => servererror(request, response, error)).
    pipe(response);
}

async function put(request: Request, response: Response) 
{
  const path = decodeURI(request.path);

  if (!path.endsWith("/"))
  {
    await setObjectStream(path.substring(1), request);
  }

  response.send();
}

async function delete_(request: Request, response: Response)
{
  const path = decodeURI(request.path);

  if (path.endsWith("/"))
  {
    const size = 100;
    const paths: string[] = [];

    for await(let item of listObjects(path.substring(1), request.authInfo, true))
    {
      const filepath = (path + item.name).substring(1);

      if (item.file && validpath(filepath))
      {
        paths.push(filepath);  
        
        if (paths.length >= size)
        {
          await deleteObjects(paths);
          paths.length = 0;
        }
      }
    }
  
    if (paths.length)
    {
      await deleteObjects(paths);
    }
  }
  else
  {
    await deleteObjects([path.substring(1)]);
  }

  response.send();
}

async function post(request: Request, response: Response, next: NextFunction)
{
  const files = request.files;

  try
  {
    const authInfo = request.authInfo;
    const path = decodeURI(request.path);

    if (!path.endsWith("/"))
    {
      forbidden(request, response);

      return;
    }

    const paths: string[] = typeof request.body.path === "string" ? [request.body.path] :
      Array.isArray(request.body.path) ? request.body.path : [];

    async function* list() 
    {
      for(let name of paths.length ? paths : [""])
      {
        const fullpath = (path + name).substring(1);

        for await(let item of listObjects(fullpath, request.authInfo, true))
        {
          const itempath = fullpath + item.name;

          if (item.file && validpath(itempath))
          {
            yield { path: itempath, size: item.size! };
          }
        }
      }
    }

    const size = 100;
    const fullpaths: string[] = [];

    switch(request.body.action)
    {
      case "delete":
      {
        if (!matchrole(authInfo, "writer"))
        {
          forbidden(request, response);
      
          return;        
        }

        for await(let item of list())
        {
          fullpaths.push(item.path);  
          
          if (fullpaths.length >= size)
          {
            await deleteObjects(fullpaths);
            fullpaths.length = 0;
          }
        }
    
        if (fullpaths.length)
        {
          await deleteObjects(fullpaths);
        }

        read(request, response);
  
        return;
      }
      case "upload":
      {
        if (!matchrole(authInfo, "writer"))
        {
          forbidden(request, response);
      
          return;        
        }

        if (Array.isArray(files))
        {
          for(let file of files)
          {
            const fullpath = (path + file.originalname).substring(1);

            if (validpath(fullpath))
            {
              await setObjectStream(fullpath, fs.createReadStream(file.path));
            }
          }
        }
      
        read(request, response);
  
        return;
      }
      case "download":
      {
        const name = 
          path.substring(path.lastIndexOf("/", path.length - 2) + 1, path.length - 1) + 
          ".tar.gz";

        response.set("Content-disposition", `attachment; filename=${name}`);
        response.set("Content-type", "application/gzip");
          
        const pack = tar.pack();
  
        pack.pipe(zlib.createGzip()).pipe(response);

        for await(let item of list())
        {
          getObjectStream(item.path).
            on("error", error => response.status(500).send(error.message)).
            pipe(
              pack.entry(
              {
                name: item.path.substring(path.length - 1),
                size: item.size
              }));
        }

        pack.finalize();

        return;
      }
      case "copy":
      {
        const target = request.body.target;

        if (target?.startsWith("/") && paths.length)
        {
          try
          {
            await Promise.all(paths.map(async name => 
            {
              const from = (path + name).substring(1);
              const to = (paths.length > 1 && target.endsWith("/") ? target + name : target).substring(1);

              await (to.endsWith("/") ? copy(from, to, authInfo) : copyOne(from, to, authInfo));
            }));

          }
          catch(error)
          {
            servererror(request, response, error as Error);

            return;
          }
        }

        read(request, response);
  
        return;
      }
      default:
      {
        next();
  
        return;
      }
    }
  }
  finally
  {
    if (Array.isArray(files))
    {
      for(let file of files)
      {
        fs.unlink(
          file.path, 
          e => e && console.log(`Cannot delete file: ${file.path}\n${e.message}`));
      }
    }
  }
}

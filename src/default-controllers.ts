import fs from "fs";
import zlib from "node:zlib";
import tar from "tar-stream";
import { Express, NextFunction, Request, Response } from "express";
import { authorize, forbidden, notfound } from "./authorize.js";
import { deleteObjects, getObjectStream, listObjects, setObjectStream } from "./store.js";
import { listDirectory } from "./directory-list.js";
import multer from "multer";
import { ApiEntry } from "./model/api-entry.js";

const upload = multer({ dest: 'uploads/', preservePath: true })

export function defaultControllers(app: Express): ApiEntry[]
{
	app.get("/favicon.ico", authorize("read", true), favicon);
	app.get("*", authorize("read"), read);
	app.put("*", authorize("write"), put);	
	app.delete("*", authorize("write"), delete_);	
	app.post("*", authorize("read"), upload.any(), post);

	return [];
}

function favicon(request: Request, response: Response) 
{
	response.set("Cache-Control", "max-age=604800");

	if (request.authInfo && request.authInfo.access !== "none")
	{
		getObjectStream(request.path.substring(1)).
			on("error", error => (error as any)?.statusCode === 404 ? 
				defaultFavicon(request, response) :
				response.status((error as any)?.statusCode ?? 500).send(error.message)).
			pipe(response);
	}
	else
	{
		defaultFavicon(request, response);
	}
}

function defaultFavicon(request: Request, response: Response)
{
	response.sendFile("favicon.svg", { root: import.meta.dirname });
}

function read(request: Request, response: Response) 
{
	const path = request.path;

	if (path.endsWith("/"))
	{
		listDirectory(request, response);
	}
	else
	{
		streamObject(path.substring(1), request, response);
	}
}

function streamObject(path: string, request: Request, response: Response)
{
	getObjectStream(path).
		on("error", error => (error as any)?.statusCode === 404 ? 
			notfound(request, response) :
			response.status((error as any)?.statusCode ?? 500).send(error.message)).
		pipe(response);
}

async function put(request: Request, response: Response) 
{
	const path = request.path;

	if (!path.endsWith("/"))
	{
		await setObjectStream(path.substring(1), request);
	}

	response.send();
}

async function delete_(request: Request, response: Response)
{
	const path = request.path;

	if (path.endsWith("/"))
	{
		const size = 100;
		const paths: string[] = [];

		for await(let item of listObjects(path.substring(1), request.authInfo, true))
		{
			const filepath = path + item.name;

			if (item.file && !filepath.startsWith("api/"))
			{
				paths.push(filepath.substring(1));	
				
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
		const path = request.path;

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
				const fullpath = path + name;

				for await(let item of listObjects(fullpath.substring(1), request.authInfo, true))
				{
					const itempath = fullpath + item.name;

					if (item.file && !itempath.startsWith("api/"))
					{
						yield { path: itempath.substring(1), size: item.size! };
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
				if (authInfo?.access !== "write")
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

				await read(request, response);
	
				return;
			}
			case "upload":
			{
				if (authInfo?.access !== "write")
				{
					forbidden(request, response);
			
					return;				
				}

				if (Array.isArray(files))
				{
					for(let file of files)
					{
						const fullpath = path + file.originalname;

						if (!fullpath.startsWith("/api/"))
						{
							await setObjectStream(fullpath, fs.createReadStream(file.path));
						}
					}
				}
			
				await read(request, response);
	
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
					getObjectStream(item.path.substring(1)).pipe(
						pack.entry(
						{
							name: item.path.substring(path.length),
							size: item.size
						})).
						on("error", error => response.status(500).send(error.message));
				}

				pack.finalize();

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

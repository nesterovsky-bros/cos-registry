import fs from "fs";
import zlib from "node:zlib";
import tar from "tar-stream";
import { Express, NextFunction, Request, response, Response } from "express";
import { authorize, forbidden, servererror, validpath } from "./authorize.js";
import { deleteObjects, getObjectStream, listObjects, setObjectStream } from "./store.js";
import { listDirectory } from "./directory-list.js";
import multer from "multer";
import { Options } from "./model/options.js";
import { marked } from "marked";

const upload = multer({ dest: 'uploads/', preservePath: true })

export function defaultControllers(app: Express, options: Options)
{
	app.get("/README", (request, response) => readme(request, response, options));
	app.get("/favicon.ico", authorize("read", true), favicon);
	app.get("*", authorize("read"), read);
	app.put("*", authorize("write"), put);	
	app.delete("*", authorize("write"), delete_);	
	app.post("*", authorize("read"), upload.any(), post);

	options.api.push(
	{
		name: "http",
		url: options.url,
		description: "Http GET, PUT, DELETE and primitive UI. Also used by maven."
	});
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


async function readme(request: Request, response: Response, options: Options)
{
	const readme = await fs.promises.readFile(`${import.meta.dirname}/../README.md`, { encoding: "utf8" });

	response.send(`<html lang="en">
<head>
	<meta charset="utf-8">
  <title>${options.title}</title>
</head>
<body>
  ${marked.parse(readme)}
</body>
</html>`);
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
	if (path.endsWith(".pom") || path.endsWith(".nuspec"))
	{
		response.contentType("text/xml");
	}

	getObjectStream(path).
		on("error", error => servererror(request, response, error)).
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
				const fullpath = (path + name).substring(1);

				for await(let item of listObjects(fullpath, request.authInfo, true))
				{
					const itempath = fullpath + item.name;

					if (item.file && validpath(itempath))
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
						const fullpath = (path + file.originalname).substring(1);

						if (validpath(fullpath))
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

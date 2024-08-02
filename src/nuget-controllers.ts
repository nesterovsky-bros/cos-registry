import fs from "fs";
import { Express, Request, Response } from "express";
import semver from "semver";
import unzip, { Entry } from "unzip-stream";
import { deleteObjects, getObject, getObjectStream, listObjects, setObjectStream } from "./store.js";
import { authorize, forbidden, notfound, servererror } from "./authorize.js";
import { NextFunction } from "express-serve-static-core";
import { XMLParser } from "fast-xml-parser";
import { Nuspec } from "./model/nuspec.js";
import { Options } from "./model/options.js";
import multer from "multer";

const xmlParser = new XMLParser({ignoreAttributes: false});
const upload = multer({ dest: 'uploads/' })

export function nugetControllers(app: Express, options: Options)
{
	app.get("/api/nuget/:feed/index.json", //authorize("read"), 
		(request, response) => index(request, response, options));

	app.get("/api/nuget/:feed/query", //authorize("read"), 
		(request, response) => query(request, response, options));
	app.get("/api/nuget/:feed/autocomplete", //authorize("read"), 
		(request, response) => autocomplete(request, response, options));
	
	app.get("/api/nuget/:feed/package/:lowerId/index.json", //authorize("read"), 
		packageIndex);
	app.get("/api/nuget/:feed/package/:lowerId/:lowerVersion/:name.nupkg",// authorize("read"), 
		packageDownload);

	app.get("/api/nuget/:feed/registration/:lowerId/index.json", //authorize("read"), 
		(request, response) => registrationIndex(request, response, options));
	app.get("/api/nuget/:feed/registration/:lowerId/page.json", //authorize("read"), 
		(request, response) => registrationPage(request, response, options));
	app.get("/api/nuget/:feed/registration/:lowerId/:lowerVersion/index.json", //authorize("read"), 
		(request, response) => registrationLeaf(request, response, options));

	app.put("/api/nuget/:feed/publish", 
		//authHeader, authorize("write"), 
		upload.any(), put);
	app.delete("/api/nuget/:feed/publish/:id/:version", authHeader, authorize("write"), delete_);

	options.api.push(
	{
		name: "nuget",
		url: `${options.url}api/nuget/{feed}/index.json`,
		description: "Nuget feeds, where {feed} is substituted with feed name."
	});
}

// {
// 	"@id": `${options.url}api/nuget/${feed}/symbolpublish`,
// 	"@type": "SymbolPackagePublish/4.9.0",
// 	"comment": "The gallery symbol publish endpoint."
// }

function authHeader(request: Request, response: Response, next: NextFunction)
{
	const accessKey = request.headers["X-NuGet-ApiKey"];

	if (typeof accessKey === "string")
	{
		request.query.accessKey = accessKey;
	}

	next();
}

function index(request: Request, response: Response, options: Options)
{
	const feed = request.params.feed;

	response.json(
	{
    "version": "3.0.0",
    "resources": 
		[
			{
				"@id": `${options.url}api/nuget/${feed}/query`,
				"@type": "SearchQueryService",
				"comment": "Query endpoint of NuGet Search service"
			},
			{
				"@id": `${options.url}api/nuget/${feed}/query`,
				"@type": "SearchQueryService/3.0.0-beta",
				"comment": "Query endpoint of NuGet Search service"
			},

			{
				"@id": `${options.url}api/nuget/${feed}/autocomplete`,
				"@type": "SearchAutocompleteService",
				"comment": "Autocomplete endpoint of NuGet Search service"
			},
			{
				"@id": `${options.url}api/nuget/${feed}/autocomplete`,
				"@type": "SearchAutocompleteService/3.0.0-beta",
				"comment": "Autocomplete endpoint of NuGet Search service"
			},

			{
					"@id": `${options.url}api/nuget/${feed}/registration`,
					"@type": "RegistrationsBaseUrl",
					"comment": "Base URL of NuGet package registration info"
			},
			{
					"@id": `${options.url}api/nuget/${feed}/package`,
					"@type": "PackageBaseAddress/3.0.0",
					"comment": `Base URL of where NuGet packages are stored, in the format ${options.url
						}api/nuget/${feed}/package/{id-lower}/{version-lower}/{id-lower}.{version-lower}.nupkg`
			},
			{
				"@id": `${options.url}api/nuget/${feed}/publish`,
				"@type": "PackagePublish/2.0.0"
			},
			// {
			// 	"@id": `${options.url}api/nuget/${feed}/symbolpublish`,
			// 	"@type": "SymbolPackagePublish/4.9.0",
			// 	"comment": "The gallery symbol publish endpoint."
			// }
		],
    "@context": 
		{
			"@vocab": "http://schema.nuget.org/services#",
			"comment": "http://www.w3.org/2000/01/rdf-schema#comment"
    }
	});
}

async function query(request: Request, response: Response, options: Options)
{
	const feed = request.params.feed;
	const q = typeof request.query.q === "string" ? request.query.q.replace(" ", "") : null;
	const regex = q ? new RegExp([...q].map(c => `[${c}]`).join(".*"), "i") : null;
	const path = `nuget/${feed}/`;
	let matches: { [name: string]: { [version: string]: boolean } } = {};

	for await(let item of listObjects(path, request.authInfo, true))
	{
		if (item.file && item.name?.endsWith(".nupkg"))
		{
			const parts = item.name.split("/");

			if (parts.length === 3 && 
				`${parts[0]}.${parts[1]}.nupkg` === parts[2] &&
				regex?.test(item.name) != false)
			{
				const versions = matches[parts[0]] ??= {};

				versions[parts[1]] = true;
			}
		}
	}

	const entries = Object.
		entries(matches).
		sort((f, s) => f[0].localeCompare(s[0])).
		map(([id, versions]) => (
		{
			id,
			versions: Object.keys(versions).sort((f, s) => -semver.compare(f, s)),
			nuspec: null as Nuspec|null
		}));

	await Promise.all(entries.map(async entry => 
		entry.nuspec = await getNuspec(feed, entry.id, entry.versions[0])));

	response.json(
	{
		"totalHits": entries.length,
		"data": entries.map(entry => (
		{
			"registration": `${options.url}api/nuget/${feed}/registration/${entry.id}/index.json`,
			"id": entry?.nuspec?.id ?? entry.id,
			"version": entry.nuspec?.version ?? entry.versions[0],
      "description": entry?.nuspec?.description,
      "title": entry.nuspec?.title,
      "licenseUrl": entry.nuspec?.licenseUrl,
      "tags": entry.nuspec?.tags,
      "authors": entry.nuspec?.authors,
			"versions": entry.versions.map(version =>(
			{
				"version": version,
				"@id": `${options.url}api/nuget/${feed}/registration/${entry.id}/${version}/index.json`
			}))
		}))
	});
}

async function autocomplete(request: Request, response: Response, options: Options)
{
	const feed = request.params.feed;
	const q = typeof request.query.q === "string" ? request.query.q.replace(" ", "") : null;
	const regex = q ? new RegExp([...q].map(c => `[${c}]`).join(".*"), "i") : null;
	const matches: string[] = [];

	for await(let item of listObjects(`nuget/${feed}/`, request.authInfo))
	{
		if (!item.file && item.name?.endsWith("/"))
		{
			const name = item.name.substring(0, item.name.length - 1);

			if (regex?.test(name) != false)
			{
				matches.push(name);
			}
		}
	}

	response.json({ "totalHits": matches.length, "data": matches });
}

async function packageIndex(request: Request, response: Response)
{
	const feed = request.params.feed;
	const lowerId = request.params.lowerId.toLowerCase();
	const versions: string[] = [];

	for await(let item of listObjects(`nuget/${feed}/${lowerId}/`, request.authInfo))
	{
		if (!item.file && item.name?.endsWith("/"))
		{
			versions.push(item.name.substring(0, item.name.length - 1));
		}
	}

	response.json({ versions });
}

async function packageDownload(request: Request, response: Response)
{
	const feed = request.params.feed;
	const lowerId = request.params.lowerId.toLowerCase();
	const lowerVersion = request.params.lowerVersion.toLowerCase();
	const name = request.params.name.toLowerCase();

	if (`${lowerId}.${lowerVersion}` !== name)
	{
		notfound(request, response);

		return;
	}

	const path = `nuget/${feed}/${lowerId}/${lowerVersion}/${name}.nupkg`;

	if (request.authInfo?.match?.(path) === false)
	{
		forbidden(request, response);

		return;
	}

	streamObject(path, request, response);
}

function streamObject(path: string, request: Request, response: Response)
{
	getObjectStream(path).
		on("error", error => servererror(request, response, error)).
		pipe(response);
}

async function registrationIndex(request: Request, response: Response, options: Options)
{
	const feed = request.params.feed;
	const lowerId = request.params.lowerId.toLowerCase();
	const entries: {version: string, nuspec?: Nuspec|null}[] = [];

	for await(let item of listObjects(`nuget/${feed}/${lowerId}/`, request.authInfo))
	{
		if (!item.file && item.name?.endsWith("/"))
		{
			entries.push({version: item.name.substring(0, item.name.length - 1)});
		}
	}

	if (entries.length)
	{
		entries.sort((f, s) => -semver.compare(f.version, s.version));

		await Promise.all(entries.map(async entry => 
			entry.nuspec = await getNuspec(feed, lowerId, entry.version)));

		response.json(
		{
			"count": 1,
			"items": 
			[
				{
					"@id": `${options.url}api/nuget/${feed}/registration/${lowerId}/page.json`,
					"count": entries.length,
					"items": entries.map(entry => (
					{
						"@id": `${options.url}api/nuget/${feed}/registration/${lowerId}/${entry}/index.json`,
						"catalogEntry": 
						{
							"@id": `${options.url}api/nuget/${feed}/registration/${lowerId}/${entry}/index.json`,
							"authors": entry.nuspec?.authors,

							"dependencyGroups": entry.nuspec?.dependencyGroups?.map(dependencyGroup => (
							{
								"@id": `${options.url}api/nuget/${feed}/registration/${lowerId}/${entry}/index.json#dependencygroup`,
								"targetFramework": dependencyGroup.targetFramework,
								"dependencies": dependencyGroup.dependencies?.map(dependency => (
								{
									"@id": `${options.url}api/nuget/${feed}/registration/${lowerId}/${entry}/index.json#dependencygroup/${dependency.id.toLowerCase()}`,
									"id": dependency.id,
									"range": dependency.version,
									"registration": `${options.url}api/nuget/${feed}/registration/${lowerId}/index.json`
								}))
							})),
							"description": entry.nuspec?.description,
							"iconUrl": entry.nuspec?.icon,
							"id": entry.nuspec?.id ?? lowerId,
							"licenseUrl": entry.nuspec?.licenseUrl,
							"packageContent": `${options.url}api/nuget/${feed}/package/${lowerId}/${entry}/${lowerId}.${entry}.nupkg`,
							"projectUrl": entry.nuspec?.projectUrl,
							"requireLicenseAcceptance": entry.nuspec?.requireLicenseAcceptance,
							"tags": entry.nuspec?.tags,
							"title": entry.nuspec?.title,
							"version": entry.version,
						},
						"packageContent": `${options.url}api/nuget/${feed}/package/${lowerId}/${entry}/${lowerId}.${entry}.nupkg`,
						"registration": `${options.url}api/nuget/${feed}/registration/${lowerId}/index.json`
					})),					
					"lower": entries[entries.length - 1].version,
					"upper": entries[0].version
				}
			]
		});
	}
	else
	{
		response.json({ "count": 1, "items": []});
	}
}

async function registrationPage(request: Request, response: Response, options: Options)
{
	const feed = request.params.feed;
	const lowerId = request.params.lowerId.toLowerCase();
	const entries: {version: string, nuspec?: Nuspec|null}[] = [];

	for await(let item of listObjects(`nuget/${feed}/${lowerId}/`, request.authInfo))
	{
		if (!item.file && item.name?.endsWith("/"))
		{
			entries.push({version: item.name.substring(0, item.name.length - 1)});
		}
	}

	if (entries.length)
	{
		entries.sort((f, s) => -semver.compare(f.version, s.version));

		await Promise.all(entries.map(async entry => 
			entry.nuspec = await getNuspec(feed, lowerId, entry.version)));

		response.json(
		{
			"count": entries.length,
			"parent": `${options.url}api/nuget/${feed}/registration/${lowerId}/index.json`,
			"lower": entries[0],
			"upper": entries[0],
			"items": entries.map(entry =>(
				{
					"@id": `${options.url}api/nuget/${feed}/registration/${lowerId}/${entry}/index.json`,
					"@type": "Package",
					"commitId": entry.nuspec?.repository?.commit,
					"catalogEntry": 
					{
						"@id": `${options.url}api/nuget/${feed}/registration/${lowerId}/${entry}/index.json`,
						"@type": "PackageDetails",
						"id": entry.nuspec?.id ?? lowerId,
						"packageContent": `${options.url}api/nuget/${feed}/package/${lowerId}/${entry}/${lowerId}.${entry}.nupkg`,
						"version": entry,
						"authors": entry.nuspec?.authors,
						"iconUrl": entry.nuspec?.icon,
						"licenseUrl": entry.nuspec?.licenseUrl,
						"projectUrl": entry.nuspec?.projectUrl,
						"requireLicenseAcceptance": entry.nuspec?.requireLicenseAcceptance,
						"title": entry.nuspec?.title
					},
					"packageContent": `${options.url}api/nuget/${feed}/package/${lowerId}/${entry}/${lowerId}.${entry}.nupkg`,
					"registration": `${options.url}api/nuget/${feed}/registration/${lowerId}/index.json`
				}))
		});
	}
	else
	{
		response.json({});
	}
}

async function registrationLeaf(request: Request, response: Response, options: Options)
{
	const feed = request.params.feed;
	const lowerId = request.params.lowerId.toLowerCase();
	const lowerVersion = request.params.lowerVersion.toLowerCase();
	let found = false;
	const path = `nuget/${feed}/${lowerId}/${lowerVersion}/${lowerId}.${lowerVersion}.nupkg`;

	for await(let item of listObjects(path, request.authInfo))
	{
		if (item.file)
		{
			found = true;

			break;
		}
	}

	if (found)
	{
		response.json(
		{
			"@id": `${options.url}api/nuget/${feed}/registration/${lowerId}/${lowerVersion}/index.json`,
			"packageContent": `${options.url}api/nuget/${feed}/package/${lowerId}/${lowerVersion}/${lowerId}.${lowerVersion}.nupkg`,
			"registration": `${options.url}api/nuget/${feed}/registration/${lowerId}/index.json`
		});
	}
	else
	{
		response.json({});
	}
}

async function put(request: Request, response: Response)
{
	const files = request.files;

	if (!Array.isArray(files) || !files.length)
	{
		response.end();

		return;
	}

	const feed = request.params.feed;
	let processing = true;
	let closed = false;
	
	const close = () =>
	{
		if (!closed)
		{
			for(let file of files)
			{
				fs.unlink(
					file.path, 
					e => e && console.log(`Cannot delete file: ${file.path}\n${e.message}`));
			}

			closed = true;
		}
	};

	fs.
		createReadStream(files[0].path).
		on("end", () => !processing && close()).
		on("error", error => 
		{
			close();
			servererror(request, response, error);
		}).
		pipe(unzip.Parse()).
		on("error", error => servererror(request, response, error)).
		on('entry', async (entry: Entry) =>
		{    
			if (entry.path.endsWith(".nuspec") && !entry.path.includes("/")) 
			{
				const chunks: any[] = [];

				entry.on("data", chunk => chunks.push(chunk));
				entry.on("end", async () =>
				{
					const data = Buffer.concat(chunks);
					const nuspec = await getNuspecFromData(data);

					if (nuspec)
					{
						const id = nuspec.id.toLocaleLowerCase();
						const version = nuspec.version.toLocaleLowerCase();
						const root = `nuget/${feed}/${id}/${version}/`;

						if (request.authInfo?.match?.(root) == false)
						{
							forbidden(request, response);

							return;
						}

						await deleteItem(root, request);

						await Promise.all(
						[
							setObjectStream(`${root}${id}.nuspec`, data),
							setObjectStream(
								`${root}${id}.${version}.nupkg`, 
								fs.
									createReadStream(files[0].path).
									on("error", close))
						]);
						
						processing = false;
						close();
						response.end();
					}
				});				
			} 
			else 
			{
				entry.autodrain();
			}
		});
}

async function delete_(request: Request, response: Response)
{
	const feed = request.params.feed;
	const id = request.params.id.toLowerCase();
	const version = request.params.version.toLowerCase();

	await deleteItem(`nuget/${feed}/${id}/${version}/`, request);

	response.send();
}

async function deleteItem(path: string, request: Request) 
{
	const paths: string[] = [];

	for await(let item of listObjects(path, request.authInfo, true))
	{
		if (item.file)
		{
			paths.push(path + item.name)
		}
	}

	if (paths.length)
	{
		await deleteObjects(paths);
	}
}

async function getNuspec(feed: string, id: string, version: string): Promise<Nuspec|null>
{
	try
	{
		const result = await getObject(`nuget/${feed}/${id}/${version}/${id}.nuspec`).promise();

		return getNuspecFromData(result.Body as string|Buffer);
	}
	catch
	{
		// Continue without nuspec.
	}

	return null;
}

async function getNuspecFromData(data: string|Buffer): Promise<Nuspec|null>
{
	try
	{
		const xml = xmlParser.parse(data)?.package?.metadata;

		if (xml)
		{
			const nuspec: Nuspec = 
			{
				id: xml.id,
				version: xml.version,
				title: xml.title,
				authors: typeof xml.authors !== "string" ? null :
					xml.authors.split(",").map((author: string) => author.trim()).filter((author: string) => author),
				copyright: xml.copyright,
				readme: xml.readme,
				description: xml.description,
				releaseNotes: xml.releaseNotes,
				icon: xml.icon,
				tags: typeof xml.tags !== "string" ? null :
					xml.tags.split(",").map((tag: string) => tag.trim()).filter((tag: string) => tag),
				projectUrl: xml.projectUrl,
				requireLicenseAcceptance: xml.requireLicenseAcceptance,
				license: xml.license?.["#text"],
				licenseUrl: xml.licenseUrl,
				repository: !xml.repository ? null :
				{
					type: xml.repository["@_type"],
					url: xml.repository["@_url"],
					commit: xml.repository["@_commit"]
				},
				dependencyGroups: !xml.dependencies ? null :
					(Array.isArray(xml.dependencies) ? xml.dependencies : [xml.dependencies]).
					filter((group: any) => group.group).
					map((group: any) => (
					{
						targetFramework: group.group["@_targetFramework"],
						dependencies: !Array.isArray(group.dependency) ? null :
							group.dependency.map((dependency: any) => (
							{
								id: dependency["@_id"],
								version: dependency["@_version"],
								exclude: dependency["@_exclude"],
							}))
					}))
			};
			
			return nuspec;
		}
	}
	catch(error)
	{
		// Continue without nuspec.
	}

	return null;
}

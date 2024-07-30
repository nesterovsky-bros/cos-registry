import { Express, NextFunction, Request, Response } from "express";
import { getObjectStream, listObjects } from "./store.js";
import { authorize, forbidden, notfound } from "./authorize.js";
import { ApiEntry } from "./model/api-entry.js";

const siteUrl = process.env.SITE_URL;

export function nugetControllers(app: Express): ApiEntry[]
{
	if (!siteUrl)
	{
		console.warn("No site url is set.");

		return [];
	}

	app.get("/api/nuget/:feed/index.json", authorize("read"), index);
	app.get("/api/nuget/:feed/package/:lowerId/index.json", authorize("read"), packageIndex);
	app.get("/api/nuget/:feed/package/:lowerId/:lowerVersion/:name.nupkg", authorize("read"), packageDownload);
	console.log(`Nuget controllers are registered at "${siteUrl}api/nuget/:feed/query" locations.`);

	const entries: ApiEntry[] =
	[
		{
			name: "nuget",
			url: `${siteUrl}api/nuget/{feed}/index.json`,
			description: "Nuget feeds, where {feed} is substituted with feed name."
		}
	];

	return entries;
}

function index(request: Request, response: Response)
{
	const feed = request.params.feed;

	response.json(
	{
    "version": "3.0.0",
    "resources": 
		[
			{
					"@id": `${siteUrl}api/nuget/${feed}/query`,
					"@type": "SearchQueryService",
					"comment": "Query endpoint of NuGet Search service"
			},
			// {
			//     "@id": `${siteUrl}api/nuget/${feed}/autocomplete`,
			//     "@type": "SearchAutocompleteService",
			//     "comment": "Autocomplete endpoint of NuGet Search service"
			// },
			{
					"@id": `${siteUrl}api/nuget/${feed}/registration`,
					"@type": "RegistrationsBaseUrl",
					"comment": "Base URL of NuGet package registration info"
			},
			{
					"@id": `${siteUrl}api/nuget/${feed}/package`,
					"@type": "PackageBaseAddress/3.0.0",
					"comment": `Base URL of where NuGet packages are stored, in the format ${siteUrl}api/nuget/${feed}/package/{id-lower}/{version-lower}/{id-lower}.{version-lower}.nupkg`
			},
			{
				"@id": `${siteUrl}api/nuget/${feed}/publish`,
				"@type": "PackagePublish/2.0.0"
			},
			// {
			// 	"@id": `${siteUrl}api/nuget/${feed}/symbolpublish`,
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
		on("error", error => (error as any)?.statusCode === 404 ? 
			notfound(request, response) :
			response.status((error as any)?.statusCode ?? 500).send(error.message)).
		pipe(response);
}


import dotenv from "dotenv";
import express, { Request } from "express";
import { caching } from "cache-manager";
import { Minimatch } from "minimatch";
import ibm from "ibm-cos-sdk";

dotenv.config();

const error = (message: string) => { throw message };

// Express.
const app = express();
const port = Number.isInteger(process.env.PORT) ? Number(process.env.PORT) : 3000;

// Authorization.
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

// S3
const s3Bucket = process.env.COS_BUCKET ?? error("No COS_BUCKET is defined.");

const s3 = new ibm.S3(
{
	endpoint: process.env.COS_ENDPOINT ?? error("No COS_ENDPOINT is defined."),
	apiKeyId: process.env.COS_API_KEY ?? error("No COS_API_KEY is defined."),
	serviceInstanceId: process.env.COS_RESOURCE_INSTANCE_ID ?? 
		error("No COS_RESOURCE_INSTANCE_ID is defined.")
});

app.get('*', async (request, response, next) => 
{
	const path = request.path;
	const info = await authorize(request, path);

	if (!info)
	{
		response.status(401).send("Unauthorized");

		return;				
	}

	if (path.endsWith("/"))
	{
		listDirectory(path);
	}
	else
	{
		getObject(path);
	}

	function getObject(path: string)
	{
		s3.getObject({ Bucket: s3Bucket, Key: path.substring(1)}).
			createReadStream().
			on("error", error => (error as any)?.statusCode === 404 ? 
				listDirectory(path + "/", true) : next(error)).
			pipe(response);
	}

	async function listDirectory(path: string, errorOnNotFound = false)
	{
		let first = true;
		let last: string|undefined;

		while(true)
		{
			const result = await s3.listObjectsV2(
			{
				Bucket: s3Bucket,
				Delimiter: "/",
				MaxKeys: 100,
				Prefix: path.substring(1),
				StartAfter: last
			}).promise();

			if (first)
			{
				first = false;

				if (errorOnNotFound && !result.KeyCount)
				{
					response.status(404).send("Not Found");

					return;
				}

				response.type("html");

				response.write(
		`<html><head>
		  <title>Index of ${path}</title>
		  <style>
			body 
			{
			  font-family: sans-serif;
			  font-size: 14px;
			}
			
			header h1 
			{
			  font-family: sans-serif;
				font-size: 28px;
				font-weight: 100;
				margin-top: 5px;
				margin-bottom: 0px;
			}
			
			#index 
			{
				border-collapse: separate;
				border-spacing: 0;
				margin: 0 0 20px; 
			}
			
			#index th 
			{
				vertical-align: bottom;
				padding: 10px 5px 5px 5px;
				font-weight: 400;
				color: #a0a0a0;
				text-align: center; 
			}
			
			#index td { padding: 3px 10px; }
			
			#index th, #index td 
			{
				border-right: 1px #ddd solid;
				border-bottom: 1px #ddd solid;
				border-left: 1px transparent solid;
				border-top: 1px transparent solid;
				box-sizing: border-box; 
			}
			
			#index th:last-child, #index td:last-child 
			{
				border-right: 1px transparent solid; 
			}
			
			#index td.length, td.modified { text-align:right; }
			a { color:#1ba1e2;text-decoration:none; }
			a:hover { color:#13709e;text-decoration:underline; }
		  </style>
		</head>
		<body>
		  <section id="main">
			<header><h1>Index of ${
				path.substring(0, path.length - 1).split("/").map((part, index, parts) =>
					`<a href="${'../'.repeat(parts.length - index - 1)}?accessKey=${info!.accessKey}">${part}/</a>`).
				join("")}
				</h1></header>
			<table id="index">
			<thead>
			  <tr><th abbr="Name">Name</th><th abbr="Size">Size</th><th abbr="Modified">Last Modified</th></tr>
			</thead>
			<tbody>
		`);
			}

			result.CommonPrefixes?.forEach(item =>
			{
				if (item.Prefix && info?.match?.(item.Prefix))
				{
					response.write(
`     <tr class="directory">
		<td class="name"><a href="../${item.Prefix?.substring(path.length - 1)}?accessKey=${info!.accessKey
			}">${item.Prefix?.substring(path.length - 1)}</a></td>
		<td></td>
		<td class="modified">15/02/2024 11:16:14 +00:00</td>
		</tr>
`);
				}
					
				last = item.Prefix;
			});

			result.Contents?.forEach(item =>
			{
				if (item.Key && info?.match?.(item.Key))
				{
					response.write(
`      <tr class="file">
        <td class="name"><a href="./${item.Key?.substring(path.length - 1)}?accessKey=${info!.accessKey}">${
			item.Key?.substring(path.length - 1)}</a></td>
        <td class="length">${item.Size?.toLocaleString()}</td>
        <td class="modified">${item.LastModified?.toLocaleString()}</td>
      </tr>
`);
				}

				last = item.Key;
			});

			if (!result.IsTruncated)
			{
				break;
			}
		}

		response.write(
`    </tbody>
    </table>
  </section>

</body></html>`);

		response.end();
	}
});

app.listen(port, () => 
{
    console.log(`Server is running on http://localhost:${port}`);
});

interface AuthInfo
{
	apiKey: Apikey,
	accessKey: string;
	settings?: any;
	match?: (path: string) => boolean;
}

interface Apikey
{
	id: string,
	locked?: boolean,
	disabled?: boolean,
	name?: string,
	description?: string,
	iam_id: string,
};

async function authorize(request: Request, path: string): Promise<AuthInfo|null>
{
	let accessKey = request.query.accessKey;

	if (!(typeof accessKey === 'string'))
	{
		const authHeader = request.header("Authorization");

		if (!authHeader?.startsWith("Bearer ")) 
		{
			return null;
		}

		accessKey = authHeader.substring("Bearer ".length);
	}

	if (!accessKey)
	{
		return null;		
	}

	let apiKey: Apikey | undefined | null = await memoryCache.get(accessKey);
	let settings: any = null;

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
		else
		{
			if (apiKey.description)
			{
				try
				{
					settings = JSON.parse(apiKey.description);
				}
				catch
				{
					// continue without settings.
				}
			}
		}
	
		memoryCache.set(accessKey, apiKey);
	}

	if (!apiKey || apiKey.locked || apiKey.disabled || apiKey.iam_id !== resourceIamId)
	{
		return null;
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

	if (!match(path))
	{
		return null;	
	}

	return { apiKey, accessKey, settings, match };
}

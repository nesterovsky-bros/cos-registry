import * as stream from 'stream';
import ibm, { Request } from "ibm-cos-sdk";
import { AuthInfo } from './model/auth.js';
import { DirectoryItem } from './model/directory-item.js';
import { options } from './options.js';

async function getEndpoint(): Promise<string|undefined>
{
	const response = await fetch(options.cos.endpoints);
	const data = response.ok && await response.json();
	
	return data?.["service-endpoints"]?.
		["regional"]?.
		[options.region]?.
		//[options.local ? "public" : "private"]?.
		["public"]?.
		[options.region];
}

const s3 = new ibm.S3(
{
	endpoint: await getEndpoint(),
	apiKeyId: options.cos.apiKey,
	serviceInstanceId: options.cos.resourceInstanceId
});

export type GetObjectOutput = ibm.S3.Types.GetObjectOutput;

export function getObject(path: string): Request<ibm.S3.Types.GetObjectOutput, ibm.AWSError>
{
	return s3.getObject({ Bucket: options.bucket, Key: path });
}

export function getObjectStream(path: string): stream.Readable
{
	return getObject(path).createReadStream();
}

export async function setObjectStream(path: string, data: stream.Readable|Buffer, contentType?: string)
{
	await s3.upload(
	{
		Bucket: options.bucket, 
		Key: path,
		ContentType: contentType,
		Body: data
	}).promise();
}

export async function* listObjects(path: string, authInfo?: AuthInfo, nested = false): AsyncGenerator<DirectoryItem>
{
	let last: string|undefined;

	while(true)
	{
		const result = await s3.listObjectsV2(
		{
			Bucket: options.bucket,
			Delimiter: nested ? undefined : "/",
			MaxKeys: 100,
			Prefix: path,
			StartAfter: last
		}).promise();

		if (result.CommonPrefixes)
		{
			for(let item of result.CommonPrefixes)
			{
				if (item.Prefix && (!authInfo || authInfo.match?.(item.Prefix)))
				{
					const name = item.Prefix.substring(path.length);
	
					if (name)
					{
						yield { name };
					}
						
					last = item.Prefix;
				}
			}
		}

		if (result.Contents)
		{
			for(let item of result.Contents)
			{
				if (item.Key && (!authInfo || authInfo.match?.(item.Key)))
				{
					const name = item.Key.substring(path.length);
	
					yield { name, file: true, size: item.Size, lastModified: item.LastModified };
						
					last = item.Key;
				}
			}
		}
	
		if (!result.IsTruncated)
		{
			break;
		}
	}
}

export async function deleteObjects(paths: string[])
{
	if (!paths?.length)
	{
		return;        
	}

	for(let index = 0, step = 100; index < paths.length; index += step)
	{
		await s3.deleteObjects(
		{
			Bucket: options.bucket,
			Delete: 
			{
				Objects: paths.slice(index, 100).map(path => ({ Key: path }))
			}
		}).promise();
	}
}

import * as stream from 'stream';
import ibm, { Request } from "ibm-cos-sdk";
import { AuthInfo } from './model/auth.js';
import { DirectoryItem } from './model/directory-item.js';

const error = (message: string) => { throw message };

// S3
const s3Bucket = process.env.COS_BUCKET ?? error("No COS_BUCKET is defined.");

const s3 = new ibm.S3(
{
	endpoint: process.env.COS_ENDPOINT ?? error("No COS_ENDPOINT is defined."),
	apiKeyId: process.env.COS_API_KEY ?? error("No COS_API_KEY is defined."),
	serviceInstanceId: process.env.COS_RESOURCE_INSTANCE_ID ?? 
		error("No COS_RESOURCE_INSTANCE_ID is defined.")
});

export type GetObjectOutput = ibm.S3.Types.GetObjectOutput;

export function getObject(path: string): Request<ibm.S3.Types.GetObjectOutput, ibm.AWSError>
{
	return s3.getObject({ Bucket: s3Bucket, Key: path.substring(1)});
}

export function getObjectStream(path: string): stream.Readable
{
	return getObject(path).createReadStream();
}

export async function setObjectStream(path: string, data: stream.Readable, contentType?: string)
{
    await s3.upload(
    {
        Bucket: s3Bucket, 
        Key: path.substring(1),
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
			Bucket: s3Bucket,
			Delimiter: nested ? undefined : "/",
			MaxKeys: 100,
			Prefix: path.substring(1),
			StartAfter: last
		}).promise();

		if (result.CommonPrefixes)
		{
			for(let item of result.CommonPrefixes)
			{
				if (item.Prefix && (!authInfo || authInfo.match?.(item.Prefix)))
				{
					const name = item.Prefix.substring(path.length - 1);
	
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
					const name = item.Key.substring(path.length - 1);
	
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
            Bucket: s3Bucket,
            Delete: 
            {
                Objects: paths.slice(index, 100).map(path => ({ Key: path.substring(1) }))
            }
        }).promise();
    }
}

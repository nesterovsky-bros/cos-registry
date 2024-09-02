import * as stream from 'stream';
import ibm, { Request } from "ibm-cos-sdk";
import { AuthInfo } from './model/auth.js';
import { DirectoryItem } from './model/directory-item.js';
import { options } from './options.js';
import unzipper, { CentralDirectory } from "unzipper";

async function getEndpoint(): Promise<string|undefined>
{
  const response = await fetch(options.cos.endpoints);
  const data = response.ok && await response.json();
  
  return data?.["service-endpoints"]?.
    ["regional"]?.
    [options.region]?.
    [options.local ? "public" : "direct"]?.
    //["public"]?.
    [options.region];
}

const s3 = new ibm.S3(
{
  endpoint: await getEndpoint(),
  apiKeyId: options.cos.apiKey,
  serviceInstanceId: options.cos.resourceInstanceId
});

export type GetObjectOutput = ibm.S3.Types.GetObjectOutput;
export type HeadObjectOutput = ibm.S3.Types.HeadObjectOutput;

export async function getObjectHeader(path: string): Promise<HeadObjectOutput>
{
  return await s3.headObject({ Bucket: options.bucket, Key: path }).promise();
}

export function getObject(path: string): Request<ibm.S3.Types.GetObjectOutput, ibm.AWSError>
{
  return s3.getObject({ Bucket: options.bucket, Key: path });
}

export function getZipDirectory(path: string, header?: HeadObjectOutput): Promise<CentralDirectory>
{
  const source = 
  {
    size: async () => 
    {
      const head = header ?? await getObjectHeader(path);

      if (!head.ContentLength) 
      {
        return 0;
      }

      return head.ContentLength;
    },
    
    stream: (offset: number, length: number) => 
    {
      return s3.getObject(
      {
        Bucket: options.bucket,
        Key: path,
        Range: `bytes=${offset}-${length ? offset + length : ""}`
      }).createReadStream();
    }
  };

  return (unzipper.Open as any).custom(source, options);
}

export async function* listDirectoryItems(path: string, entry?: string, authInfo?: AuthInfo, header?: HeadObjectOutput): AsyncGenerator<DirectoryItem>
{
  if (entry)
  {
    const directory = await getZipDirectory(path.substring(1), header);
    const prefix = entry.substring(1);

    for(let file of directory.files.sort((f, s) => f.path.localeCompare(s.path)))
    {
      if (file.type === "File" && (!prefix || file.path?.startsWith(prefix)))
      {
        const item: DirectoryItem = 
        { 
          name: `${path}/${file.path}`, 
          stream: () => file.stream(), 
          lastModified: file.lastModifiedDateTime,
          size: file.uncompressedSize,
        };

        yield item;
      }
    }
  }
  else
  {
    for await(let item of listObjects(path.substring(1), authInfo, true))
    {
      if (item.name && item.file)
      {
        const filepath = `${path}${item.name}`;

        yield { ...item, name: filepath, stream: () => getObjectStream(filepath.substring(1)) };

        if (filepath.toLowerCase().endsWith(".zip"))
        {
          for await(let item of listDirectoryItems(filepath, "/"))
          {
            yield item;
          }
        }
      }
    }
  }
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

export async function copy(source: string, target: string, authInfo?: AuthInfo): Promise<void>
{
  if (authInfo?.match?.(target) === false)
  {
    return;
  }

  await s3.copyObject(
  { 
    CopySource: `${options.bucket}/${source}`,
    Bucket: options.bucket,  
    Key: target
  }).promise();
}

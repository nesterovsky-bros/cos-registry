import * as stream from 'stream';

export interface DirectoryItem
{
  name: string;
  file?: boolean;
  size?: number;
  lastModified?: Date;
  selecable?: boolean;
  href?: string;
  stream?: stream.Readable|null;
}

import * as stream from 'stream';
import * as readline from 'node:readline/promises';
import { Request, Response } from "express";
import { DirectoryItem } from "./model/directory-item.js";
import { getObjectStream, getZipDirectory, HeadObjectOutput, listObjects } from "./store.js";
import { render } from "preact-render-to-string";
import { options } from "./options.js";
import { matchrole } from "./authorize.js";
import { version } from "../package.json";
import { Minimatch } from "minimatch";

export async function listDirectory(request: Request, response: Response, path: string, entry?: string, header?: HeadObjectOutput)
{
  const authInfo = request.authInfo;
  const fullpath = entry ? path + entry : path;
  const accessKeySuffix = authInfo?.from === "accessKey" ?
    `?accessKey=${authInfo!.accessKey}` : ``;

  const search = !!request.query.f || !!request.query.s;

  const fileMatch = (typeof request.query.f == "string" ? [request.query.f] :
    Array.isArray(request.query.f) ? request.query.f : []).
    flatMap(item => typeof item === "string" ? item.split(".") : []).
    map(item => 
    {
      const pattern = item?.trim();

      if (!pattern)
      {
        return null;
      }

      try
      {
        return new Minimatch(pattern);
      }
      catch
      {
        return null;
      }
    }).
    filter(item => !!item);
    
  const contentMatch = (typeof request.query.s == "string" ? [request.query.s] :
    Array.isArray(request.query.s) ? request.query.s : []).
    map(item => 
    {
      if (typeof item != "string")
      {
        return null;
      }

      const pattern = item.trim();

      if (!pattern)
      {
        return null;
      }

      try
      {
        return new RegExp(item, "i");
      }
      catch
      {
        return null;
      }
    }).
    filter(item => !!item);
        
  response.type("html");

  response.write(
`<html lang="en">
${render(head())}
<body onload="init()">
<form id="main" method="POST" enctype="multipart/form-data">
<input type="hidden" name="action"/>
<input type="hidden" name="target"/>
<input type="file" name="files" hidden multiple onchange="onFilesChange()"/>
${render(bodyHeader())}
<table id="index">
${render(tableHead())}
<tbody>
`);

  if (path === "/")
  {
    response.write(render(row({ name: "README", selecable: false })));
    response.write(render(row({ name: "api/", selecable: false })));
  }

  if (search)
  {
    if (fileMatch.length || contentMatch.length)
    {
      const batch: Promise<void>[] = [];

      for await(let item of list(path.substring(1), entry))
      {
        if (contentMatch.length && item.stream)
        {
          batch.push(step(item));

          if (batch.length >= 1000)
          {
            await Promise.all(batch);
            batch.length = 0;
          }
        }
      }

      if (batch.length)
      {
        await Promise.all(batch);
      }
    }

    async function step(item: DirectoryItem)
    {
      const reader = readline.createInterface(item.stream!);

      try
      {
        for await(const line of reader) 
        {
          if (contentMatch.some(match => match.test(line)))
          {
            response.write(render(row({...item, name: item.name.substring(path.length)})));

            break;
          }
        }
      }
      finally
      {
        reader.close();
      }
    }

    async function* list(path: string, entry?: string): AsyncGenerator<DirectoryItem>
    {
      if (entry)
      {
        const directory = await getZipDirectory(path, header);
        const prefix = entry.substring(1);

        for(let file of directory.files.sort((f, s) => f.path.localeCompare(s.path)))
        {
          if (file.type === "File" && 
            (!prefix || file.path?.startsWith(prefix)))
          {
            const filepath = `${path}/${file.path}`;

            if (fileMatch.length && !fileMatch.some(item => item.match(filepath)))
            {
              continue;
            }

            const item: DirectoryItem = 
            { 
              name: filepath, 
              stream: contentMatch.length ? file.stream() : null, 
              lastModified: file.lastModifiedDateTime,
              size: file.uncompressedSize
            };

            yield item;
          }
        }
      }
      else
      {
        for await(let item of listObjects(path, authInfo))
        {
          if (item.name && item.file)
          {
            const filepath = `${path}${item.name}`;

            if (fileMatch.length && !fileMatch.some(item => item.match(filepath)))
            {
              continue;
            }

            if (filepath.toLowerCase().endsWith(".zip"))
            {
              for await(let item of list(filepath, "/"))
              {
                yield item;
              }
            }
            else
            {
              yield { ...item, name: filepath, stream: contentMatch.length ? getObjectStream(filepath) : null };
            }
          }
        }
      }
    }
  }
  else if (entry)
  {
    const prefix = entry.substring(1);
    const directory = await getZipDirectory(path.substring(1), header);
    const folders: { [path: string]: boolean } = {};

    for(let file of directory.files.sort((f, s) => f.path.localeCompare(s.path)))
    {
      if (file.type === "File" && 
        (!prefix || file.path?.startsWith(prefix)))
      {
        let name = file.path.substring(prefix.length);
        const p = name.indexOf("/");

        if (p >= 0)
        {

          name = name.substring(0, p + 1);

          if (!folders[name])
          {
            folders[name] = true;

            response.write(render(row({ name, file: false})));
          }
        }
      }
    }

    for(let file of directory.files)
    {
      if (file.type === "File" && 
        (!prefix || file.path?.startsWith(prefix)))
      {
        let name = file.path.substring(prefix.length);

        if (name.indexOf("/") === -1)
        {
          response.write(render(row(
          {
            name: file.path.substring(prefix.length),
            file: true,
            size: file.uncompressedSize,
            lastModified: file.lastModifiedDateTime
          })));
        }
      }
    }
  }
  else
  {
    for await(let item of listObjects(path.substring(1), authInfo))
    {
      if (item.name)
      {
        response.write(render(row(item)));
      }
    }
  }

  response.write(
`</tbody>
</table>
<hr>
<div class="copyright">©2024 A&V. <a href="${options.github}?tab=MIT-1-ov-file#readme">MIT License</a>. Version ${version}</div>
</form>
<dialog id="searchDialog">
  <h4>Search content</h4>
  <form>
    <main>
      <div>
        <label>
          Files pattern (comma separated globs):<br>
          <input name="f" type="text"/>
        </label>
      </div>
      <div>
        <label>
          Content regex:<br>
          <input name="s" type="text"/>
        </label>
      </div>
    </main>
    <div class="dialog-footer">
      <button value="cancel" formmethod="dialog">Cancel</button>
      <button value="default" type="submit">Search</button>
    </div>
  </form>
</dialog>
${render(script())}
</body></html>`);

  response.end();

  function head()
  {
    const style = `
body 
{
  font-family: sans-serif;
  font-size: 14px;
}

#header
{
  margin: 0;
}

#header h1 
{
  font-family: sans-serif;
  font-size: 28px;
  font-weight: 100;
  margin: 0;
}

.toolbar button
{
  margin: .25em;
}

#index 
{
  border-collapse: separate;
  border-spacing: 0;
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

#main
{
  display: inline-block;
}

dialog
{
  padding: 0;
  border: 0;
}

dialog h4
{
  font-weight: normal;
  padding: 0 .25em;
  margin: 0 0 .5em 0;
  background: lightgrey; 
}

dialog>form
{
  margin: 0;
  padding: 0 .5em;
}

dialog>form input[type=text]
{
  margin: 3px 0 7px 2em;
  width: 25em;
}

.dialog-footer
{
  padding: .5em;
  text-align: right;
}

.copyright 
{
  color: rgb(78, 78, 78);
  font-size: small;
}
`;

    const element = 
<head>
  <base href={fullpath}/>
  <title>Index of {fullpath}</title>
  <style dangerouslySetInnerHTML={{ __html:style }}></style>
</head>;

    return element;
  }

  function script()
  {
    const script = `
const writer = ${matchrole(authInfo, "writer") && !entry};
const form = document.getElementById("main");

function updateSelections()
{
  const selections = document.querySelector("#index .selections");
  const selectionSelector = document.querySelectorAll("#index .selection");
  const checked = selections.checked;

  selectionSelector.forEach(element => element.checked = checked);
  updateSelection();
}

function updateSelection()
{
  const selections = document.querySelector("#index .selections");
  const selectionSelector = document.querySelectorAll("#index .selection");
  const count = selectionSelector.length;
  let selected = 0;

  selectionSelector.forEach(element => element.checked && ++selected);

  selections.disabled = !count;
  selections.checked = count && count === selected;
  selections.indeterminate = selected && count !== selected;

  const canUpdate = writer && selected > 0;

  form.copy.disabled = !canUpdate;
  form.delete.disabled = !canUpdate;
}

function getSelection()
{
  const selections = document.querySelectorAll("#index tr:has(.selection:checked) .name a");

  const paths = [];

  selections.forEach(element => paths.push(element.textContent));

  return paths;
}

function delete_()
{
  if (!getSelection().length || 
    !confirm("Please confirm deletion of files or folders."))
  {
    return;
  }

  form.files.disabled = true;
  form.action.value = "delete";
  form.submit();
  history.replaceState(null, "", location.url);
}

function copy_()
{
  const selection = getSelection();

  if (!selection.length)
  {
    return;
  }

  let target = prompt(
    "Enter target name", 
    "${fullpath}" + (selection.length > 1 ? "Folder/": "Copy of " + selection[0]));

  target = target?.trim();

  if (!target || target === selection[0])
  {
    return;
  }

  form.files.disabled = true;
  form.action.value = "copy";
  form.target.value = target;
  form.submit();
}

async function download(folder)
{
  form.files.disabled = true;
  form.action.value = "download";
  form.submit();
  history.replaceState(null, "", location.url);
}

function upload(folder)
{
  form.files.disabled = false;
  
  if ("webkitdirectory" in form.files)
  {
    form.files.webkitdirectory = !!folder;
  }

  const newFiles = form.files.cloneNode();

  form.files.parentNode.replaceChild(newFiles, form.files);
  form.action.value = "upload";
  newFiles.click();
}

function onFilesChange()
{
  if (form.files.disabled || form.action.value !== "upload" || !form.files.files.length)
  {
    return;
  }

  form.submit();
  history.replaceState(null, "", location.url);
}

function search_()
{
  const dialog = document.getElementById("searchDialog");

  dialog.showModal();
}

function init()
{
  if ("webkitdirectory" in form.files)
  {
    form.uploadFolder.disabled = !writer;
  }
  else
  {
    form.uploadFolder.hidden = true;
  }

  form.uploadFiles.disabled = !writer;

  updateSelection();
}
`;        

    return <script dangerouslySetInnerHTML={{ __html:script}}></script>;
  }

  function bodyHeader()
  {
    const element = 
<header id="header">
  <h1>Index of {
  fullpath.substring(0, fullpath.length - 1).split("/").map((part, index, parts) =>
    <><a href={`${'../'.repeat(parts.length - index - 1)}${accessKeySuffix}`}>{part}/</a> </>)}
  </h1>
  <div class="toolbar">
    <button name="downloadFile" type="button" {...{onclick: "download()"}} disabled={search || !!entry}>Download</button>
    <button name="uploadFiles" type="button" {...{onclick: "upload()"}} disabled>Upload</button>
    <button name="uploadFolder" type="button" {...{onclick: "upload(true)"}} disabled>Upload folder</button>
    <button name="copy" type="button" {...{onclick: "copy_()"}} disabled>Copy</button>
    <button name="delete" type="button" {...{onclick: "delete_()"}} disabled>Delete</button>
    <button name="search" type="button" {...{onclick: "search_()"}}>Search</button>
  </div>
</header>

    return element;
  }

  function tableHead()
  {
    const element = 
<thead>
  <tr>
    <th><input type="checkbox" class="selections" {...{onclick: "updateSelections()"}}/></th>
    <th>Name</th>
    <th>Size</th>
    <th>Last Modified</th>
  </tr>
</thead>;

    return element;
  }

  function row(item: DirectoryItem) 
  {
    const element = 
  <tr class={item.file ? "file" : "directory"}>
    <td>
    {
      entry || item.selecable === false ? null :
      <input type="checkbox" name="path" value={item.name} class="selection" {...{onclick: "updateSelection()"}}/>
    }
    </td>
    <td class="name"><a href={item.href ?? item.name + accessKeySuffix}>{item.name}</a></td>
    <td class="length">{item.size?.toLocaleString()}</td>
    <td class="modified">{item.lastModified?.toLocaleString()}</td>
  </tr>;
  
    return element;
  } 
}

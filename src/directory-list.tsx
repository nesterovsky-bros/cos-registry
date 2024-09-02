import * as readline from 'node:readline/promises';
import { Request, Response } from "express";
import { Minimatch } from "minimatch";
import { version } from "../package.json";
import { DirectoryItem } from "./model/directory-item.js";
import { getZipDirectory, HeadObjectOutput, listDirectoryItems, listObjects } from "./store.js";
import { render } from "preact-render-to-string";
import { options } from "./options.js";
import { matchrole } from "./authorize.js";

export interface ListOptions
{
  path: string;
  entry?: string;
  header?: HeadObjectOutput;
  alert?: string;
  search?: boolean;
}

export async function listDirectory(request: Request, response: Response, listOptions: ListOptions)
{
  const {path, entry, header, alert } = listOptions;

  let flushTime: number|null = null; 
  const authInfo = request.authInfo;
  const fullpath = listOptions.entry ? path + entry : path;
  const accessKeySuffix = authInfo?.from === "accessKey" ?
    `?accessKey=${authInfo!.accessKey}` : ``;

  const query = request.query.s ?? request.query.q;
  const search = listOptions.search !== false && !!request.query.f || !!query;

  const fileMatch = (typeof request.query.f == "string" ? [request.query.f] :
    Array.isArray(request.query.f) ? request.query.f : []).
    flatMap(item => typeof item === "string" ? item.split(/[;,]/) : []).
    map(item => 
    {
      const pattern = item?.trim();

      if (!pattern)
      {
        return null;
      }``

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
  
  const contentMatch = (typeof query == "string" ? [query] :
    Array.isArray(query) ? query : []).
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
    write({ name: "README", selecable: false });
    write({ name: "api/", selecable: false });
  }

  if (search)
  {
    if (fileMatch.length || contentMatch.length)
    {
      const batch: Promise<void>[] = [];

      for await(let item of list(path, entry))
      {
        if (contentMatch.length)
        {
          batch.push(step(item));

          if (batch.length >= 1000)
          {
            await Promise.all(batch);
            batch.length = 0;
          }
        }
        else
        {
          write({...item, name: item.name.substring(path.length)});
        }
      }

      if (batch.length)
      {
        await Promise.all(batch);
      }
    }

    async function step(item: DirectoryItem)
    {
      const reader = readline.createInterface(item.stream!());

      try
      {
        for await(const line of reader) 
        {
          if (contentMatch.some(match => match.test(line)))
          {
            write({...item, name: item.name.substring(path.length)});

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
      for await(let item of listDirectoryItems(path, entry, authInfo, header))
      {
        flush();

        const filepath = `${path}/${item.name}`;

        if (!fileMatch.length || fileMatch.some(item => item.match(filepath)))
        {
          yield item;
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
      flush();

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
            write({ name, file: false });
          }
        }
      }
    }

    for(let file of directory.files)
    {
      flush();

      if (file.type === "File" && 
        (!prefix || file.path?.startsWith(prefix)))
      {
        let name = file.path.substring(prefix.length);

        if (name.indexOf("/") === -1)
        {
          write(
          {
            name: file.path.substring(prefix.length),
            file: true,
            size: file.uncompressedSize,
            lastModified: file.lastModifiedDateTime,
            selecable: false
          });
        }
      }
    }
  }
  else
  {
    for await(let item of listObjects(path.substring(1), authInfo))
    {
      flush();

      if (item.name)
      {
        write(item);
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
          <input name="q" type="text"/>
        </label>
      </div>
    </main>
    <div class="dialog-footer">
      <button value="default" type="submit">Search</button>
      <button value="cancel" type="button" onclick="searchDialog.close()">Cancel</button>
    </div>
  </form>
</dialog>
</body></html>`);

  response.end();

  function write(item: DirectoryItem)
  {
    response.write(render(row(item)));
    flushTime = Date.now() + 1000;
  }

  function flush()
  {
    if (flushTime != null && flushTime < Date.now())
    {
      flushTime = null;
      response.flush();
    }
  }

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
  box-shadow: rgba(0, 0, 0, 0.35) 0px 5px 15px;
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

    const element = <>
<head>
  <base href={fullpath}/>
  <title>Index of {fullpath}</title>
  <style dangerouslySetInnerHTML={{ __html:style }}></style>
</head>
{script()}
  </>;

    return element;
  }

  function script()
  {
    const script = `
const writer = ${matchrole(authInfo, "writer") && !entry};
let form;
let searchDialog;

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
    ${JSON.stringify(fullpath)} + (selection.length > 1 ? "Folder/": "Copy of " + selection[0]));

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

function init()
{
  form = document.getElementById("main");
  searchDialog = document.getElementById("searchDialog");

  if ("webkitdirectory" in form.files)
  {
    form.uploadFolder.disabled = !writer;
  }
  else
  {
    form.uploadFolder.hidden = true;
  }

  form.uploadFiles.disabled = !writer;
  form.downloadFile.disabled = false;

  updateSelection();

  ${alert && `alert(${JSON.stringify(alert)});`}
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
    <button name="downloadFile" type="button" {...{onclick: "download()"}} disabled>Download</button>
    <button name="uploadFiles" type="button" {...{onclick: "upload()"}} disabled>Upload</button>
    <button name="uploadFolder" type="button" {...{onclick: "upload(true)"}} disabled>Upload folder</button>
    <button name="copy" type="button" {...{onclick: "copy_()"}} disabled>Copy</button>
    <button name="delete" type="button" {...{onclick: "delete_()"}} disabled>Delete</button>
    <button name="search" type="button" {...{onclick: "searchDialog.showModal()"}}>Search</button>
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

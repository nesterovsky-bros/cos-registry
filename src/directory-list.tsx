import { Request, Response } from "express";
import { DirectoryItem } from "./model/directory-item.js";
import { listObjects } from "./store.js";
import { render } from "preact-render-to-string";
import { options } from "./options.js";
import { matchrole } from "./authorize.js";
import { version } from "../package.json";

export async function listDirectory(request: Request, response: Response)
{
  const path = request.path;
  const authInfo = request.authInfo;
  const accessKeySuffix = authInfo?.from === "accessKey" ?
    `?accessKey=${authInfo!.accessKey}` : ``;

  response.type("html");

  response.write(
`<html lang="en">
${render(head())}
<body>
<form id="main" method="POST" enctype="multipart/form-data">
<input type="hidden" id="action" name="action"/>
<input type="file" name="files" hidden id="files" multiple onchange="onFilesChange()"/>
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

  for await(let item of listObjects(path.substring(1), authInfo))
  {
    if (item.name)
    {
      response.write(render(row(item)));
    }
  }

  response.write(
`</tbody>
</table>
<hr>
<div class="copyright">©2024 A&V. <a href="${options.github}?tab=MIT-1-ov-file#readme">MIT License</a>. Version ${version}</div>
</form>
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

.copyright 
{
  color: rgb(78, 78, 78);
  font-size: small;
}
`;

    const element = 
<head>
  <base href={path}/>
  <title>Index of {path}</title>
  <style dangerouslySetInnerHTML={{ __html:style }}></style>
</head>;

    return element;
  }

  function script()
  {
    const script = `
const writer = ${matchrole(authInfo, "writer")};

function toggleSelections()
{
  const selections = document.querySelector("#index .selections");
  const selectionSelector = document.querySelectorAll("#index .selection");
  const deleteButton = document.querySelector("#delete");
  const checked = selections.checked;

  selectionSelector.forEach(element => element.checked = checked);
  
  if (deleteButton)
  {
    deleteButton.disabled = !writer || !checked;
  }
}

function toggleSelection()
{
  const selections = document.querySelector("#index .selections");
  const selectionSelector = document.querySelectorAll("#index .selection");
  const deleteButton = document.querySelector("#delete");
  const count = selectionSelector.length;
  let selected = 0;

  selectionSelector.forEach(element => element.checked && ++selected);

  selections.checked = count === selected;
  selections.indeterminate = selected && count !== selected;
  deleteButton.disabled = selected === 0;
}

function getSelection()
{
  const selections = document.querySelectorAll("#index tr:has(.selection:checked) .name a");

  const paths = [];

  selections.forEach(element => paths.push(element.textContent));

  return paths;
}

function deleteSelection()
{
  const form = document.getElementById("main");
  const action = document.getElementById("action");
  const files = document.getElementById("files");

  if (!form || !action)
  {
    return;
  }

  if (!getSelection().length || !confirm("Please confirm deletion of files or folders."))
  {
    return;
  }

  if (files)
  {
    files.disabled = true;
  }

  action.value = "delete";
  form.submit();
  history.replaceState(null, "", location.url);
}

async function download(folder)
{
  const form = document.getElementById("main");
  const action = document.getElementById("action");
  const files = document.getElementById("files");

  if (!form || !action)
  {
    return;
  }

  if (files)
  {
    files.disabled = true;
  }

  action.value = "download";
  form.submit();
  history.replaceState(null, "", location.url);
}

function upload(folder)
{
  const form = document.getElementById("main");
  const action = document.getElementById("action");
  const files = document.getElementById("files");

  if (!form || !action || !files)
  {
    return;
  }

  files.disabled = false;
  
  if ("webkitdirectory" in files)
  {
    files.webkitdirectory = !!folder;
  }

  const newFiles = files.cloneNode();

  files.parentNode.replaceChild(newFiles, files);
  action.value = "upload";
  newFiles.click();
}

function onFilesChange()
{
  const form = document.getElementById("main");
  const action = document.getElementById("action");
  const files = document.getElementById("files");

  if (!form || !action || !files)
  {
    return;
  }

  if (files.disabled || action.value !== "upload" || !files.files.length)
  {
    return;
  }

  form.submit();
  history.replaceState(null, "", location.url);
}

function init()
{
  const uploadFolderButton = document.getElementById("uploadFolder");
  const uploadFilesButton = document.getElementById("uploadFiles");
  const filesInput = document.getElementById("files");

  if (uploadFolderButton)
  {
    if (filesInput && "webkitdirectory" in filesInput)
    {
      uploadFolderButton.disabled = !writer;
    }
    else
    {
      uploadFolderButton.hidden = true;
    }
  }

  if (uploadFilesButton)
  {
    uploadFilesButton.disabled = !writer;
  }

  toggleSelection();
}

init();
`;        

    return <script dangerouslySetInnerHTML={{ __html:script}}></script>;
  }

  function bodyHeader()
  {
    const element = 
<header id="header">
  <h1>Index of {
  path.substring(0, path.length - 1).split("/").map((part, index, parts) =>
    <><a href={`${'../'.repeat(parts.length - index - 1)}${accessKeySuffix}`}>{part}/</a> </>)}
  </h1>
  <div class="toolbar">
    <button id="downloadFile" type="button" {...{onclick: "download()"}}>Download</button>
    <button id="uploadFiles" type="button" {...{onclick: "upload()"}} disabled>Upload</button>
    <button id="uploadFolder" type="button" {...{onclick: "upload(true)"}} disabled>Upload folder</button>
    <button id="delete" type="button" {...{onclick: "deleteSelection()"}} disabled>Delete</button>
  </div>
</header>

    return element;
  }

  function tableHead()
  {
    const element = 
<thead>
  <tr>
    <th><input type="checkbox" class="selections" {...{onclick: "toggleSelections()"}}/></th>
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
      item.selecable == false ? null :
      <input type="checkbox" name="path" value={item.name} class="selection" {...{onclick: "toggleSelection()"}}/>
    }
    </td>
    <td class="name"><a href={item.href ?? item.name + accessKeySuffix}>{item.name}</a></td>
    <td class="length">{item.size?.toLocaleString()}</td>
    <td class="modified">{item.lastModified?.toLocaleString()}</td>
  </tr>;
  
    return element;
  } 
}

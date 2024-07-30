import { Request, Response } from "express";
import { DirectoryItem } from "./model/directory-item.js";
import { listObjects } from "./store.js";
import { render } from "preact-render-to-string";

export async function listDirectory(request: Request, response: Response)
{
    const path = request.path;
    const authInfo = request.authInfo;
    const accessKeySuffix = authInfo?.type === "accessKey" ?
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

	for await(let item of listObjects(path, authInfo))
	{
        if (item.name)
        {
            response.write(render(row(item)));
        }
	}

	response.write(
`</tbody>
</table>
</form>
${render(script())}
</body></html>`);

	response.end();

    function head()
    {
        const style = 
`
body 
{
	font-family: sans-serif;
	font-size: 14px;
}

#header
{
  display: flex;
  align-items: center;
  gap: .5em;
  margin: 0;
}

#header h1 
{
  flex-grow: 1;
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
function toggleSelections()
{
	const selections = document.querySelector("#index .selections");
	const selectionSelector = document.querySelectorAll("#index .selection");
	const deleteButton = document.querySelector("#delete");
	const checked = selections.checked;

	selectionSelector.forEach(element => element.checked = checked);
	deleteButton.disabled = !checked;
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
  const uploadFilesInput = document.getElementById("uploadFiles");

  if (uploadFolderButton && uploadFilesInput && !("webkitdirectory" in uploadFilesInput))
  {
    uploadFolderButton.hidden = true;
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
        {authInfo!.access !== "write" ? null :
        <>
        <button id="uploadFile" type="button" {...{onclick: "upload()"}}>Upload</button>
        <button id="uploadFolder" type="button" {...{onclick: "upload(true)"}}>Upload folder</button>
        <button id="delete" type="button" {...{onclick: "deleteSelection()"}} disabled>Delete</button>
        </>}
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
            <input type="checkbox" name="path" value={item.name} class="selection" {...{onclick: "toggleSelection()"}}/>
        </td>
        <td class="name"><a href={item.name + accessKeySuffix}>{item.name}</a></td>
        <td class="length">{item.size?.toLocaleString()}</td>
        <td class="modified">{item.lastModified?.toLocaleString()}</td>
    </tr>;
    
        return element;
    } 
}

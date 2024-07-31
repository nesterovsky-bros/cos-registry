import { Express } from "express";
import { ApiEntry } from "./model/api-entry.js";

export function apiControllers(app: Express, siteUrl: string|undefined, apiEntires: ApiEntry[])
{
	app.use("/api", (request, response) => response.json(apiEntires));
}

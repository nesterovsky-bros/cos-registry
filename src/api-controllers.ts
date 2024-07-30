import { Express } from "express";
import { ApiEntry } from "./model/api-entry.js";

export function apiControllers(app: Express, entries?: ApiEntry[]): ApiEntry[]
{
	app.use("/api", (request, response) => response.json(entries ?? []));

	return [];
}

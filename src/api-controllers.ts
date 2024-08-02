import { Express } from "express";
import { Options } from "./model/options.js";

export function apiControllers(app: Express, options: Options)
{
	app.use("/api", (request, response) => response.json(options.api));
}

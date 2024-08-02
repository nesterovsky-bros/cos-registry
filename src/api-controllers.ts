import { Express } from "express";
import { Options } from "./model/options.js";
import { authorize } from "./authorize.js";

export function apiControllers(app: Express, options: Options)
{
	app.get("/api/env", 
		authorize("owner"),
		(request, response) => response.json(process.env));

	app.use("/api", (request, response) => response.json(options.api));
}

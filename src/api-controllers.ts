import { Express } from "express";
import { options } from "./options.js";

export function apiControllers(app: Express)
{
  //app.get("/api/env", authorize("owner"), (_, response) => response.json(process.env));
  app.use("/api", (_, response) => response.json(options.api));
}

import { Express } from "express";
import { getRequestPath, options } from "./options.js";

export function apiControllers(app: Express)
{
  // app.get("/api/test", (request, response) =>
  //   response.json(
  //     {
  //       headers: request.headers,
  //       query: request.query,
  //       params: request.params,
  //       env: process.env
  //     }));

  app.use("/api", (request, response) =>
    response.json(options.api.map(api => ({
      name: api.name,
      url: getRequestPath(request, api.url, false),
      description: api.description
    }))));
}

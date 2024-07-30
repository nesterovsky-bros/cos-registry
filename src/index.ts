import "dotenv-expand/config";
import express from "express";
import compression from "compression";
import { defaultControllers } from "./default-controllers.js";
import { nugetControllers } from "./nuget-controllers.js";
import { apiControllers } from "./api-controllers.js";
import { ApiEntry } from "./model/api-entry.js";

const app = express();
const port = Number.isInteger(Number(process.env.PORT)) ? Number(process.env.PORT) : 8080;

app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const apiEntires: ApiEntry[] = [];

apiEntires.push(...nugetControllers(app));
apiEntires.push(...apiControllers(app, apiEntires));
apiEntires.push(...defaultControllers(app));

app.listen(port, () => console.log(`Server is running on http://localhost:${port}`));

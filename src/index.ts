import "dotenv/config";
import express from "express";
import compression from "compression";
import { defaultControllers } from "./default-controllers.js";

const app = express();
const port = Number.isInteger(Number(process.env.PORT)) ? Number(process.env.PORT) : 8080;

app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

defaultControllers(app);

app.listen(port, () => console.log(`Server is running on http://localhost:${port}`));



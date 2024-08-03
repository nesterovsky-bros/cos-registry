import express from "express";
import compression from "compression";
import { defaultControllers } from "./default-controllers.js";
import { nugetControllers } from "./nuget-controllers.js";
import { apiControllers } from "./api-controllers.js";
import { options } from "./options.js";

const app = express();

app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

nugetControllers(app);
apiControllers(app);
defaultControllers(app);

const server = app.listen(options.port, () => console.log(`Server is running on http://localhost:${options.port}`));

process.on('SIGTERM', () => 
{
  console.info('SIGTERM signal received.');
  server.close(() => console.log('Http server closed.'));
});
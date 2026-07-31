import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
const config = loadConfig(process.env);
createApp(config).listen(config.port, () => console.log(`listening on ${config.port}`));

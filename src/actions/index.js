// Importing this registers every action, in the order tools are listed.
import "./catalogue.js";
import "./data.js";
import "./answers.js";
import "./workspace.js";
import "./dashboards.js";
import "./events.js";
import "./settings.js";
import "./explore.js";

export { actionsFor, callAction, contextFor, inputJsonSchema, registry, toolDefinitions } from "./registry.js";

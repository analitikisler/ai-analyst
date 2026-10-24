// Hash routing, so the static build works from any sub-path (and needs no server rewrite). When the app
// moves into ai-analyst behind a server that falls back to index.html, swap in createBrowserRouter.
import { createHashRouter } from "react-router";
import { routes } from "./routes";

export const router = createHashRouter(routes);

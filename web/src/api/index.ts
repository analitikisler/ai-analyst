// Which API the app talks to. The default build talks to the ai-analyst server on the same origin (`http`); the demo
// build (`bun run build:demo`, `VITE_API=fixtures`) answers from the mock server on the real demo mart, as the
// published prototype does. `DEMO` is a build-time constant, so the demo-only parts drop out of the server build.
import type { Api } from "./client";
import { createFixtureApi } from "./fixtures";
import { createHttpApi } from "./http";

/** True only in the fixtures (demo) build: the reviewer menu, the tour and the simulations exist only there. */
export const DEMO: boolean = __DEMO__;

export const api: Api = __DEMO__ ? createFixtureApi() : createHttpApi();

export { ApiError, isApiError } from "./client";
export type { Api, AskHandle } from "./client";
export * from "./types";

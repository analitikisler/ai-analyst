// The one switch that keeps this process off the network: with AI_ANALYST_NO_CLOUD=1 every real outbound path
// (the BigQuery client and tester, the Anthropic client, the fetch used for OpenAI-compatible providers) refuses
// with code no_cloud before anything is sent. It is checked where the real clients are made, so a stub a test
// injects still works and nothing real can slip past. Tests, `bun run dev` and the smoke server set it by default.
import { AppError } from "./errors.js";

export const noCloud = (env = process.env) => env.AI_ANALYST_NO_CLOUD === "1" || env.AI_ANALYST_NO_CLOUD === "true";

/** Throws no_cloud when outbound calls are switched off. what: the service, in plain words ("BigQuery"). */
export function assertCloudAllowed(what) {
  if (noCloud()) {
    throw new AppError("no_cloud", `${what} was not called: AI_ANALYST_NO_CLOUD is set, so this process makes no calls to outside services. Unset it (or set it to 0) to connect.`, { params: { service: what } });
  }
}

/** fetch, refused when outbound calls are switched off. */
export function cloudFetch(what) {
  return (...args) => {
    assertCloudAllowed(what);
    return fetch(...args);
  };
}

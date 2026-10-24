// Who answers: a model (the provider set in Settings, a key in the environment, or a client a test injects)
// or the built-in planner. Exploratory answers need a model and the switch not turned off.
import { MODEL_DEFAULT, MODEL_LABEL, PROVIDER_LABEL } from "../config.js";
import { preferences } from "../settings.js";

export function agentMode(app) {
  const c = app.config;
  const prefs = app.store ? preferences(app.store) : {};
  const p = c.provider.value;
  if (app.modelClient) {
    const provider = app.modelClient.provider ?? (p !== "planner" ? p : "anthropic");
    const model = c.model || MODEL_DEFAULT[provider];
    return { mode: "model", provider, model, provider_label: PROVIDER_LABEL[provider] ?? provider, model_label: MODEL_LABEL[model] ?? model, exploratory: prefs.exploratory !== "off" };
  }
  if (p === "planner" || !c.providers[p]?.set) return { mode: "planner", provider: null, model: null, provider_label: null, model_label: null, exploratory: false };
  const model = c.model || MODEL_DEFAULT[p];
  return { mode: "model", provider: p, model, provider_label: PROVIDER_LABEL[p], model_label: MODEL_LABEL[model] ?? model, exploratory: prefs.exploratory !== "off" };
}

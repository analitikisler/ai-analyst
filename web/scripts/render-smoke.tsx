// Renders the shell and every route to HTML with the query cache filled from the mock server, in both languages,
// to catch render errors, unfilled {placeholders} and English left on a Turkish screen. Part of `bun run smoke`.
import { QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { callAction, getState } from "../src/api/mock/server";
import { createQueryClient, keys } from "../src/api/queries";
import type { ActionName } from "../src/api/types";
import { AskProvider } from "../src/ask/AskStore";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { LanguageProvider } from "../src/i18n";
import { routes } from "../src/routes";

const PATHS = ["/ask", "/dashboards/db_example", "/dashboards/db_example?edit=1", "/dashboards/db_example?check=ga4_vs_orders", "/dashboards/db_example?check=nope", "/settings/activity", "/settings/events", "/metrics", "/metrics/orders", "/settings/data", "/settings/model", "/settings/chat-apps/claude-desktop", "/settings/language", "/tour", "/nowhere"];

async function resolveLazy(list: typeof routes): Promise<typeof routes> {
  return Promise.all(
    list.map(async (r) => {
      const lazy = typeof r.lazy === "function" ? await (r.lazy as () => Promise<object>)() : {};
      const children = r.children ? await resolveLazy(r.children) : undefined;
      return { ...r, ...lazy, lazy: undefined, children } as (typeof routes)[number];
    }),
  );
}

const ENGLISH_CHROME = />(Dashboards|Checks|Activity|Settings|Metrics|Events|Tracking health|Demo data|Built-in planner|Ask about|Make it yours|Run all checks|Edit dashboard)</g;
/** "check" or "kontrol" as the feature's name, where "Tracking health" / "Ölçüm sağlığı" applies (ids and URLs allowed). */
const OLD_NAME = { en: /(?<![Tt]racking |ai-analyst |update |-)\b[Cc]hecks?\b(?![-_])/g, tr: /(?<![Öö]lçüm )\b[Kk]ontrol(?:ler|leri|lerin|ü|ün|ünü|e|de)?\b(?! edil)/g };

export async function renderSmoke(check: (name: string, ok: boolean, detail?: unknown) => void) {
  const resolved = await resolveLazy(routes);
  for (const lang of ["en", "tr"] as const) {
    const qc = createQueryClient();
    qc.setQueryData(keys.state(), getState());
    const fill = <N extends ActionName>(name: N, input: Parameters<typeof callAction<N>>[1]) => qc.setQueryData(keys.action(name, input), callAction(name, input, lang));
    fill("get_dashboard", { dashboard_id: "db_example" });
    fill("get_check", { check: "ga4_vs_orders", days: 14, run_id: undefined });
    const dashPeriod = callAction("get_dashboard", { dashboard_id: "db_example" }, lang);
    fill("get_check", { check: "ga4_vs_orders", from: dashPeriod.from, to: dashPeriod.to, run_id: undefined });
    fill("get_settings", {});
    fill("list_metric_entries", {});
    fill("get_metric", { metric: "orders" });
    fill("list_suggestions", {});
    fill("list_sources", {});
    fill("get_chat_app_setup", { client: "claude-desktop" });
    fill("list_chat_app_calls", {});
    for (const path of PATHS) {
      try {
        const router = createMemoryRouter(resolved, { initialEntries: [path] });
        const html = renderToString(
          <QueryClientProvider client={qc}>
            <LanguageProvider lang={lang}>
              <TooltipProvider>
                <AskProvider>
                  <RouterProvider router={router} />
                </AskProvider>
              </TooltipProvider>
            </LanguageProvider>
          </QueryClientProvider>,
        );
        const gaps = html.match(/\{[a-z_]+\}/g);
        const mixed = lang === "tr" ? html.match(ENGLISH_CHROME) : null;
        const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const old = text.match(OLD_NAME[lang]);
        check(`render ${lang} ${path}: no old "check" feature name`, !old, old && text.slice(Math.max(0, text.search(OLD_NAME[lang]) - 60), text.search(OLD_NAME[lang]) + 40));
        check(`render ${lang} ${path}`, html.length > 500 && !gaps && !mixed, gaps ?? mixed ?? text.slice(0, 160));
        if (path === "/settings/model") {
          const reason = lang === "en" ? "Needs a model. The built-in planner cannot write SQL." : "Model gerekir. Yerleşik planlayıcı SQL yazamaz.";
          check(`render ${lang} exploratory switch disabled without a model, with the reason`, html.includes(reason) && /id="explore-switch"[^>]*(disabled|data-disabled)|(disabled|data-disabled)[^>]*id="explore-switch"/.test(html), html.match(/<[^>]*explore-switch[^>]*>/)?.[0]);
        }
        if (process.env.SMOKE_VERBOSE) console.log(`     ${text.slice(0, 300)}`);
      } catch (err) {
        check(`render ${lang} ${path}`, false, String(err));
      }
    }
  }
}

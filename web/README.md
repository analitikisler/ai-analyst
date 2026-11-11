# ai analyst web app

React 19, Vite, Tailwind 4 and shadcn on Base UI. Bun ≥1.4. Run everything from `web/`.

```sh
bun install
```

## Develop

```sh
bun run dev        # http://localhost:5190, /api proxied to the server
bun run dev:demo   # http://localhost:5190 on the fixtures demo, no server needed
```

`bun run dev` expects `ai-analyst serve` on http://127.0.0.1:8788. Set `API_URL` to proxy elsewhere. If nothing
answers there, the app says the server is not running.

## Build

```sh
bun run build       # web/dist, talks to the server on the same origin; ai-analyst serve serves it
bun run build:demo  # web/dist-demo, the static fixtures demo (the approved prototype), for a hosted demo page
```

Both run `typecheck` and `lint:tokens` first. The builds open from any sub-path (`base: "./"`, hash routes).

## The API switch

`VITE_API=fixtures` at build or dev time picks the in-browser mock server (`src/api/mock`) on the demo mart; without
it the app uses `src/api/http.ts` against the server. The contract is `src/api/types.ts` (docs/CONTRACT.md 0.2);
change it only through the lead engineer.

The fixtures build alone has the reviewer menu, the tour (`#/tour`), "Simulate a model key", "Simulate the tracking
fix" and "Reset prototype". They sit behind the build-time constant `__DEMO__`, so the http build does not contain
them or the mock server.

## Checks

```sh
bun run smoke                         # every flow on the mock server, plus a render pass
bun run smoke:http                    # the same flows against a running server (SMOKE_URL, default :8788)
```

`smoke:http` writes data (pins, dashboards, events, settings), so point it at a freshly seeded throwaway data dir,
never at a workspace in use, and start that server with `--no-cloud`:

```sh
node src/cli.js serve --port 8788 --data-dir "$(mktemp -d)" --no-cloud   # from the repo root
```

It accepts loopback addresses only and skips the fixture-only steps. With `--no-cloud` the BigQuery and model-key
flows are checked to be refused (`no_cloud`); without it they are skipped, and the driver refuses to send them.

`bun run stub [port] [own|local|error]` serves the mock with server-only states laid over it (own data with no
dashboards or events, env-locked settings, a non-loopback address, failed BigQuery and key tests, the audit handoff,
a 502). Use it with `API_URL=http://127.0.0.1:8790 bun run dev` to look at those screens.

## Fixtures

The mock runs the server's rules on two files in `src/api/fixtures`: `mart.json`, the demo mart (`fixtures:mart`
exports it from the demo's DuckDB file, default `web/.capture/data/demo.duckdb`), and `shop.json`, the demo shop's
own tables.

## Brand

Colour, type, the Pano pattern and the logos come from the Çini · Mercan kit of Analitik İşler, copied as-is into
`src/cini` (its `README.md` has the rules; `VERSION` names the build). Don't edit those files: copy a new build of
the kit over them. `src/index.css` imports the kit's `tokens.css`, `fonts.css` (Gabarito and Azeret Mono) and
`tailwind.css`, which point shadcn's names at the kit's roles. Names, logos and voice are in `../brand/ai/BRAND.md`.

The logo components in `src/components/art/BrandLogos.tsx` are generated from `src/cini/logos` with
`bun run brand` (ink as currentColor, the point as `--color-brand-point`). The favicons and the app icon in
`public/brand` are copies of `src/cini/logos/icons`; the 180 px `apple-touch-icon.png` is made on macOS with
`sips -s format png ai-analyst-512.svg --out ai-512.png && sips -z 180 180 ai-512.png --out apple-touch-icon.png`.

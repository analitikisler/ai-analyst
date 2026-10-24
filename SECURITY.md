# Security

AI Analyst is in alpha. Security reports are welcome and taken seriously.

## Reporting a problem

Email hello@analitikisler.com with the subject "AI Analyst security". Please do not open a public issue for a
security problem. Include what you found, how to reproduce it, and the version (Settings › About, or `version`
in `package.json`).

You will get a reply within five working days. Once a fix is released, the report can be credited in the release
notes if you wish.

## Supported versions

Only the latest release on `main` gets security fixes while the project is in alpha.

## What is in scope

- the HTTP server and its API (`src/server.js`, `src/actions/`)
- the exploratory SQL guard and runners (`src/explore/`)
- handling of settings and model keys (`src/settings.js`, `secrets.json`)
- the MCP server (`src/mcp.js`)
- the web app (`web/`)

The security design is described in `docs/CONTRACT.md`: the server listens on 127.0.0.1 by default, other
addresses need a token, requests from other websites are refused, settings change only from the machine running
the app, and model-written SQL may read only the mart table. A way around any of these is in scope.

Out of scope: problems that need someone who already controls the machine, its user account or the warehouse
credentials, and reports about third-party services (BigQuery, model providers) themselves.

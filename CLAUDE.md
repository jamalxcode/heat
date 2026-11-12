# CLAUDE.md

This file guides Claude Code when working in this repository.

## Overview

heat.sala.company (live at https://heat.sala.company) is a set of market heatmaps: crypto top 100 (home page) with RSI, MA trend, point & figure, momentum, relative strength, volume and suggested stop-losses, plus `/forex/`, `/metals/`, `/energy/`, `/etfs/`, `/rates/` (official bond yield curves) and `/predictions/` (Polymarket, Kalshi, PredictIt, Manifold, Betfair). A daily scorecard checks the signals against what happened next, and a weekly tuner adjusts settings. Front end is vanilla JS ES modules (`app/*.mjs`) with no bundler; data is built by Node 22 scripts in GitHub Actions and published as JSON alongside the page. Beta, not financial advice.

## Commands

```sh
npm test                                  # node --test: unit tests in tests/*.test.mjs
npm install && npx playwright install chromium
npm run test:e2e                          # playwright test: browser tests in tests/e2e/ (starts tests/e2e/serve.mjs)
npm run dev                               # node tests/e2e/serve.mjs: local preview on :4173 with deterministic fixture data
node scripts/build-data.mjs data.json     # build crypto data locally (live APIs)
node scripts/score.mjs --tune             # scorer + tuner (uses the live data.json via SITE_URL)
node scripts/check-fresh.mjs [site URL]   # freshness check of the live site
```

No lint script. `package-lock.json` is gitignored.

## Architecture

- `index.html`: page markup, CSS, SEO/JSON-LD, loads `/app/main.mjs`. It is also the template for every market page.
- `app/`: page script modules. `main.mjs` (startup/refresh), `markets.mjs` (one adapter per market), `core.mjs` (helpers, state, localStorage prefs as JSON), `data.mjs` (per-tile indicators), `render.mjs`, `interact.mjs` (popup/hover/phone bottom sheet), `scorecard.mjs`, `rates.mjs`, `predictions.mjs`, `fuel.mjs`, `dxy.mjs` (imports `scripts/build-forex.mjs`), `names.mjs`.
- `signals.mjs`: the shared signal engine (indicators, 🚀/😢 rules, scoring stats, tuner, `provenSignals`). Used by the page, scorer and tuner so they agree; change it with care and run tests.
- `scripts/build-*.mjs`: builders for `data.json` (crypto, with fallbacks CoinGecko/CoinLore and Binance/Gate.io/OKX/MEXC/KuCoin), `forex.json`, `metals.json`, `energy.json`, `fuel.json`, `etfs.json`, `rates.json`, `predictions.json`. Each reuses the previous published file via `PREV_URL`.
- `scripts/score.mjs`, `scripts/score-forex.mjs`: daily scorecards and Sunday tuning -> `data/scorecard.json`, `data/forex-scorecard.json`, `params.json`, `params-forex.json` (missing params = defaults in `signals.mjs`).
- `scripts/market-page.mjs` + `seo/<market>-{head,about,sources}.html`: generates `/forex/` etc. from `index.html`. `scripts/question-pages.mjs`: static `/predictions/q/<slug>/` pages. `scripts/tradingview.mjs`: chart-link symbols (`tv.json`; also imported by the page). `scripts/health.mjs`: sources health line (`health.json`).
- `data/`: committed state: `scorecard.json`, `pairs.json`, `universe-history.json`, `forex-scorecard.json`, `forex-extras.json`, `backfill-cache.json`.
- Built JSON files (`data.json`, `forex.json`, ... and generated market dirs) are gitignored and exist only in the deployed site.
- In-browser fallback: if `data.json` is missing or older than 45 min, the page runs `scripts/build-data.mjs` itself (at most once per 10 min per browser).
- `tests/`: unit tests (`signals`, `scoring`, per-market, `deploy.test.mjs`); `tests/e2e/` Playwright spec, fixtures and local server.
- `docs/rebuild-prompts.md`: the prompts that built the project, in order (one per feature). `docs/DECISIONS.md`: why things work as they do (prediction-market fetching and tiles, the site-wide rules such as fallbacks, timers, the shared engine, the honest scorecard, colour and deploy safety, and how the repo is worked on). Read it before changing behaviour.

## Deployment

- `.github/workflows/update-data.yml` ("Update heatmap data") runs every 10 min (`7-59/10 * * * *`, plus cron-job.org dispatches), on push to `main`, and manually. It appends `?v=<sha>` to module imports via `sed`, copies an explicit list of files into `_site/`, runs all builders (a failing builder republishes the last live JSON), writes `sitemap.xml`, and deploys with GitHub Pages Actions (Pages source: GitHub Actions). Pushing to `main` deploys live. The deploy does not commit.
- Custom domain `heat.sala.company` is configured in the Pages settings/DNS; there is no `CNAME` file or `.nojekyll` in the repo.
- `score-signals.yml`: daily 00:20 UTC scoring (Sunday tuning), commits results to `main` (also keeps schedules from being paused). Expect bot commits; pull before pushing.
- `test.yml` and `e2e.yml` run on push to every branch and PRs. `freshness.yml`: hourly live-data check. `backfill-universe.yml`: manual one-off.
- Secrets: `COINGECKO_API_KEY`; optional `BETFAIR_APP_KEY`/`BETFAIR_USERNAME`/`BETFAIR_PASSWORD`.
- README workflow: work on a branch (Claude sessions use their `claude/...` branch), merge to `main` only when unit and browser tests pass. Pull `main` first (the scorer's daily bot commits).

## Conventions and gotchas

- Any new file the page loads must be added to the `cp` lines in `update-data.yml`; `tests/deploy.test.mjs` checks every imported `/scripts/...` and root module is published (a missing copy once broke every page). Also keep import specifiers in the form the version `sed` expects (`from '...mjs'`, dynamic imports listed in the workflow), or the workflow's grep check fails.
- Cache busting is automatic (`?v=<sha>`); don't add manual version strings.
- Keep the GoatCounter snippet at the end of `index.html` intact (endpoint `https://salacompany.goatcounter.com/count`); market pages inherit it from `index.html`.
- Fonts are self-hosted (`fonts/inter-latin.woff2`); no calls to Google.
- Browser tests must make no outside API calls (fixtures only). Phone layout (bottom sheet, sideways-scrolling tabs) and 13-inch popup fit are tested; check both when changing UI.
- Keep FAQ JSON-LD in sync with the visible About text. Line endings are LF (`.gitattributes`).
- Docs move with the code: a behaviour change updates `README.md`, adds a decision to `docs/DECISIONS.md` (append, numbered) when the reason is worth keeping, and adds a prompt to `docs/rebuild-prompts.md` for a new feature.
- Plain words in page text, code and docs (see decision 27 in `docs/DECISIONS.md`).

# 🔥 heat.sala.company

**Live: https://heat.sala.company**

A crypto heatmap of the top 50 coins by market cap. Every tile combines the price move with three technical signals, and a daily scorecard checks whether those signals actually predicted anything.

> ⚠️ **Work in progress. Use at your own risk.** Data can be late, wrong or missing, and nothing here is financial advice. Prices are **not real-time**: they refresh every 10 minutes.

## What's on a tile

- **Heat color**: 24h, 7d or 30d price change. Falling gets darker and gloomier red, down to near-black. Near flat is white. Rising goes from whitish blue through bright blue to a rich sea blue.
- **RSI**: a 0–100 gauge, tagged *Oversold* / *Overbought* at the current thresholds (default 30 / 70).
- **Trend**: fast vs slow moving average (default 50 / 200-day), plus whether price agrees (*strong*) or not (*pullback* / *bounce*). A ✦ marks a golden or death cross in the last 14 days.
- **Bollinger Band width (20, 2)**: ranked against its last 180 days. The bottom 25% is tagged *Squeeze*: volatility is compressed and a big move often follows, in either direction.
- **🚀 / 😢 next to the name**: one per active signal. By default:
  - 🚀 for a strong uptrend or RSI oversold
  - 😢 for a strong downtrend, RSI overbought, or a wide band (top 20%)
  - ⚡ for a very tight band (bottom 10%): a big move is likely, but not its direction, so ⚡ never counts as a 🚀 or 😢

  The weekly tuner can change the thresholds, flip a signal from 🚀 to 😢, or switch it off. The legend always shows the current rules.
- **Recommended stop-loss** for **long** and **short** positions (the STOP row):
  - distance = **2× the coin's average daily move** over the last 20 days: about 3% for BTC, about 7% for a typical coin
  - set once a day from the last daily close: exit a long below it, or a short above it
  - ⚠️ when price is within a quarter of the distance, and 🛑 **crossed: get out** with a red tile border once price is past it
  - shown in the tile, the table, and the detail chart (as lines). These are suggested levels only: the page isn't real-time, so set stops on your exchange.

- **✓ / ? next to the ticker**: ✓ means the coin's price history comes from an exchange pair confirmed by its CoinGecko ID. ? means it was matched by ticker only (a best guess, checked against the price). Hover the mark to see the exchange and pair.

**Coin details.** Hover a tile to open its details. On laptops they appear in a two-column popup, sized to fit a 13-inch screen:
- **Left:** a 120-day chart of price, both moving averages, the Bollinger band and the recommended stop lines, plus RSI below it.
- **Right:** the key numbers, the long and short stop cards, and where the price history comes from (✓ or ?).

The popup stays on the coin you opened while the mouse is on it. Crossing other tiles only switches it if you stop on one for about 0.2 seconds. Click the popup (or the tile) to pin it open, and click outside it to close it. On phones, tapping a tile opens the same details as a bottom sheet.

**Filters.** The Highlight buttons (Oversold, Overbought, Uptrend, Downtrend, Squeeze, Recent cross, 🛑 Stop crossed) show only the matching coins, in both grid and table. Each button shows its count. **All coins** (or clicking the active button again) brings everything back.

The **Table** view sorts by any column, including the recommended stops. The **Scorecard** view shows how the signals have actually performed.

## Scorecard: are the 🚀 / 😢 right?

Every day at **00:20 UTC** a GitHub job scores the previous day:

- **Yesterday's calls**: for coins with more 🚀, how many went up; for coins with more 😢, how many went down. Each is measured in absolute terms and against the average of all 50 coins.
- **Last 60 days chart**: what holding each day's 🚀 coins, 😢 coins or all coins for one day would have compounded to, with a hover tooltip per day.
- **Track record** over the last 30 days, 90 days and all history (about 2.7 years), judged over the **next day, 3 days or 7 days**:
  - whether more 🚀 meant bigger moves
  - how each signal did on its own, flagged "⚠ pointing the wrong way" when the data disagrees with its role
  - a verdict based on the daily rank correlation between score and the move (for 3 and 7 days, where moves overlap from day to day, t-values are divided by √days so they aren't overstated)
  - whether a ⚡ squeeze was really followed by bigger moves than usual
  - for the recommended stops: how often they were crossed, and whether, after getting out, price kept going the wrong way (a good exit) or came back (shaken out)

**Self-tuning, every Sunday.** The tuner tries other RSI periods and levels, moving-average pairs (20/50, 20/100, 50/200) and wide-band thresholds. For each signal it decides whether it should count as a 🚀, a 😢, or be switched off, judging it over the next 1, 3 and 7 days. The newest half of history is cut into **three check periods**. For each one, settings are chosen using only the days before it, then compared with the current settings on that period. New settings are written to `params.json` **only if they win at least 2 of the 3 periods and do better on average**. Because many variants get tried, a signal needs t ≥ 2.5 (not the usual 2) to be switched on. The site picks new settings up automatically, and every change is logged on the Scorecard.

Statistics cap moves at ±30% a day (wider for 3 and 7 days), so a bad price print can't dominate the averages. The Scorecard still shows each coin's real move. A signal needs at least 20 firings before it gets a verdict.

*Honest baseline (first runs, Sept 2026):* the default signals showed **no reliable next-day edge**. The daily rank correlation was about 0, and 🚀 coins went up 48% of the time, the same as all coins. Two signals pointed the wrong way: overbought and wide-band coins tended to *keep* outperforming (momentum). So far the tuner has kept the defaults, because the momentum settings didn't hold up on the most recent months. And ⚡ squeezes (bottom 10% of band width) were followed by *smaller* moves than usual (about 0.85×), not bigger ones. The recommended stops were crossed about 22% of the time within 3 days, and after an exit the next move was roughly a coin flip. That's typical: a stop doesn't predict direction, it caps how much you can lose.

## How it works

```
GitHub Actions: every 10 min (via cron-job.org)      Visitors (browser)
  scripts/build-data.mjs                                 index.html + signals.mjs
    ├─ rankings: CoinGecko → CoinLore → last copy          ├─ reads data.json and scorecard.json
    ├─ daily candles: Binance → Gate.io → OKX              │   (no market API calls, no rate limits)
    │    → MEXC → KuCoin → CoinGecko                       └─ same signal engine as the scorer
    ├─ tuned settings from params.json
    └─ data.json + scorecard.json ──► GitHub Pages

GitHub Actions: daily 00:20 UTC (via cron-job.org)
  scripts/score.mjs ─► data/scorecard.json (+ params.json on Sundays, if the tuner adopts new settings)
```

| File | What it is |
|---|---|
| `index.html` | The whole site (HTML, CSS and JS in one page) |
| `signals.mjs` | The shared signal engine: indicators, 🚀/😢/⚡ rules, scoring stats, tuner. Used by the page, the scorer and the tuner, so they always agree. |
| `tests/signals.test.mjs` | Unit tests: RSI against the StockCharts worked example, Bollinger/SMA against hand-computed values, scoring and tuning sanity checks |
| `scripts/build-data.mjs` | Builds `data.json`: top-100 rankings plus 260 daily closes per coin, with fallbacks across six data sources |
| `scripts/score.mjs` | Daily scorecard and weekly tuning (about 1,000 days of candles per coin) |
| `params.json` | Signal settings chosen by the tuner. Missing means the defaults in `signals.mjs` are used. |
| `data/scorecard.json` | Latest scorecard, committed daily by the bot |
| `data/pairs.json` | Each coin's exact USDT pair on Binance, Gate.io, OKX, MEXC and KuCoin, from CoinGecko's per-coin tickers. Refreshed weekly by the scorer (and for coins new to the top 50), so a ticker shared by two coins, or a renamed coin (Toncoin now trades as GRAM), can't pull in the wrong price history. |
| `.github/workflows/update-data.yml` | Builds `data.json` and deploys the site to GitHub Pages every 10 minutes and on every push to `main` |
| `.github/workflows/score-signals.yml` | Daily scoring (plus Sunday tuning). It commits the results, which also keeps the schedules from being paused for inactivity. |
| `.github/workflows/test.yml` | Runs the unit tests on every push |

**How the data stays safe and fresh:**
- The deploy job publishes to Pages without committing. The daily scorecard commit keeps the repo active, since GitHub pauses scheduled workflows after 60 days without commits.
- Each build reuses the previous `data.json`. Candles are refetched hourly (every 6 h for coins that come from CoinGecko). In between, the page updates today's candle with the latest price.
- If `data.json` is missing or more than 45 minutes old, the page runs the **same build script** (`scripts/build-data.mjs`, published with the site) in the browser, without the slow CoinGecko candle fallback. It does this **at most once per 10 minutes per browser** and caches the result, so reloads and other tabs make no extra API calls.
- Stablecoins, tokenized gold, wrapped/staked copies and fund tokens are excluded. A checkbox brings them back.

## Running it yourself

- **Rebuild from scratch:** [`docs/rebuild-prompts.md`](docs/rebuild-prompts.md) has the 12 prompts, in order, that built this project with Claude.
- **Manual runs:** go to **Actions → Update heatmap data → Run workflow**, or **Actions → Score signals → Run workflow**. Tick *"Run the tuner now"* to tune immediately.
- **Locally:** `node scripts/build-data.mjs data.json`, then serve the folder (for example `npx serve .`). Scoring: `node scripts/score.mjs --tune` (needs the live `data.json`, via `SITE_URL`). Tests: `node --test`.
- **Timers:** GitHub's own schedules proved unreliable (about 1 run in 15, and no daily runs), so **cron-job.org** starts both workflows through GitHub's API, using a fine-grained token limited to this repo (Actions: read and write). The token expires in September 2027 and must then be renewed in both cron-job.org jobs. GitHub's schedules stay on as a backup, and the page's in-browser fallback covers any gaps.

## Hosting setup

1. **Settings → Pages → Source: GitHub Actions.**
2. Custom domain `heat.sala.company`:
   - At GoDaddy, add a `CNAME` record from `heat` to `jamalxcode.github.io`.
   - **Enforce HTTPS** is on.
3. `sala.company` is a **verified domain** on the GitHub account, via the TXT record `_github-pages-challenge-jamalxcode`. Keep that record: it stops anyone else from using the domain on GitHub Pages.
4. The main site `sala.company` and `www` stay on Shopify. Only the `heat` subdomain points to GitHub.

*Not financial advice. Don't trust anyone, ever, including this page.*

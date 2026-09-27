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
  - 🚀 for a strong uptrend, RSI oversold, or a very tight band (bottom 10%)
  - 😢 for a strong downtrend, RSI overbought, or a wide band (top 20%)

  The weekly tuner can change the thresholds, flip a signal from 🚀 to 😢, or switch it off. The legend always shows the current rules.

Hover a tile (tap on a phone) to see a 120-day chart with price, both moving averages, the Bollinger band and RSI. The **Table** view sorts by any column. The **Scorecard** view shows how the signals have actually performed.

## Scorecard: are the 🚀 / 😢 right?

Every day at **00:20 UTC** a GitHub job scores the previous day:

- **Yesterday's calls**: for coins with more 🚀, how many went up; for coins with more 😢, how many went down. Each is measured in absolute terms and against the average of all 50 coins.
- **Track record** over the last 30 days, 90 days and all history (about 2.7 years):
  - whether more 🚀 meant bigger moves
  - how each signal did on its own, flagged "⚠ pointing the wrong way" when the data disagrees with its role
  - a verdict based on the daily rank correlation between score and next-day move

**Self-tuning, every Sunday.** The tuner tries other RSI periods and levels, moving-average pairs (20/50, 20/100, 50/200) and Bollinger thresholds. For each signal it decides whether it should count as a 🚀, a 😢, or be switched off. It tunes on the **older 70%** of the history and checks on the **newest 30%**, which it never saw. New settings are written to `params.json` **only if they beat the current ones on that unseen 30%**. The site picks them up automatically, and every change is logged on the Scorecard.

Statistics cap each day's move at ±30%, so a bad price print can't dominate the averages. The Scorecard still shows each coin's real move. A signal needs at least 20 firings before it gets a verdict.

*Honest baseline (first runs, Sept 2026):* the default signals showed **no reliable next-day edge**. The daily rank correlation was about 0, and 🚀 coins went up 48% of the time, the same as all coins. Two signals pointed the wrong way: overbought and wide-band coins tended to *keep* outperforming (momentum). So far the tuner has kept the defaults, because the momentum settings didn't hold up on the most recent months.

## How it works

```
GitHub Actions: every 10 min (:07, :17, :27 …)       Visitors (browser)
  scripts/build-data.mjs                                 index.html + signals.mjs
    ├─ rankings: CoinGecko → CoinLore → last copy          ├─ reads data.json and scorecard.json
    ├─ daily candles: Binance → Gate.io → OKX              │   (no market API calls, no rate limits)
    │    → MEXC → KuCoin → CoinGecko                       └─ same signal engine as the scorer
    ├─ tuned settings from params.json
    └─ data.json + scorecard.json ──► GitHub Pages

GitHub Actions: daily 00:20 UTC
  scripts/score.mjs ─► data/scorecard.json (+ params.json on Sundays, if the tuner adopts new settings)
```

| File | What it is |
|---|---|
| `index.html` | The whole site (HTML, CSS and JS in one page) |
| `signals.mjs` | The shared signal engine: indicators, 🚀/😢 rules, scoring stats, tuner. Used by the page, the scorer and the tuner, so they always agree. |
| `scripts/build-data.mjs` | Builds `data.json`: top-100 rankings plus 260 daily closes per coin, with fallbacks across six data sources |
| `scripts/score.mjs` | Daily scorecard and weekly tuning (about 1,000 days of candles per coin) |
| `params.json` | Signal settings chosen by the tuner. Missing means the defaults in `signals.mjs` are used. |
| `data/scorecard.json` | Latest scorecard, committed daily by the bot |
| `.github/workflows/update-data.yml` | Builds `data.json` and deploys the site to GitHub Pages every 10 minutes and on every push to `main` |
| `.github/workflows/score-signals.yml` | Daily scoring (plus Sunday tuning). It commits the results, which also keeps the schedules from being paused for inactivity. |

**How the data stays safe and fresh:**
- The deploy job publishes to Pages without committing. The daily scorecard commit keeps the repo active, since GitHub pauses scheduled workflows after 60 days without commits.
- Each build reuses the previous `data.json`. Candles are refetched hourly (every 6 h for coins that come from CoinGecko). In between, the page updates today's candle with the latest price.
- If `data.json` is missing or more than 45 minutes old, the page fetches live in the browser. That path has its own rate limiter:
  - per-API request budgets shared across tabs
  - automatic backoff (1 → 15 min) after a block
  - a countdown clock that decides when a refresh is allowed
- Stablecoins, tokenized gold, wrapped/staked copies and fund tokens are excluded. A checkbox brings them back.

## Running it yourself

- **Manual runs:** go to **Actions → Update heatmap data → Run workflow**, or **Actions → Score signals → Run workflow**. Tick *"Run the tuner now"* to tune immediately.
- **Locally:** `node scripts/build-data.mjs data.json`, then serve the folder (for example `npx serve .`). Scoring: `node scripts/score.mjs --tune` (needs the live `data.json`, via `SITE_URL`).
- GitHub runs scheduled workflows on a best-effort basis: runs can start late, and on new repos the first one can take a while to appear. The page's live fallback covers any gaps.

## Hosting setup

1. **Settings → Pages → Source: GitHub Actions.**
2. Custom domain `heat.sala.company`:
   - At GoDaddy, add a `CNAME` record from `heat` to `jamalxcode.github.io`.
   - **Enforce HTTPS** is on.
3. `sala.company` is a **verified domain** on the GitHub account, via the TXT record `_github-pages-challenge-jamalxcode`. Keep that record: it stops anyone else from using the domain on GitHub Pages.
4. The main site `sala.company` and `www` stay on Shopify. Only the `heat` subdomain points to GitHub.

*Not financial advice. Don't trust anyone, ever, including this page.*

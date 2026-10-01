# 🔥 heat.sala.company

**Live: https://heat.sala.company**

A crypto heatmap of the top 100 coins by market cap, with stablecoins, tokenized gold and wrapped/staked copies left out, and a [forex heatmap](https://heat.sala.company/forex/) of 48 currencies against the US dollar. Every tile combines the price move with technical indicators, and a daily scorecard checks whether the 🚀 / 😢 calls actually predicted anything.

> ⚠️ **Work in progress. Use at your own risk.** Data can be late, wrong or missing, and nothing here is financial advice. Prices are **not real-time**: they refresh every 10 minutes.

## What's on a tile

- **Heat color**: 24h, 7d or 30d price change. Falling gets darker and gloomier red, down to near-black. Near flat is white. Rising goes from whitish blue through bright blue to a rich sea blue.
- **RSI**: a 0–100 gauge, tagged *Oversold* / *Overbought* at the current thresholds (default 30 / 70).
- **Trend**: fast vs slow moving average (default 50 / 200-day), plus whether price agrees (*strong*) or not (*pullback* / *bounce*). A ✦ marks a golden or death cross in the last 14 days.
- **Bollinger Band width (20, 2)**: ranked against its last 180 days. The bottom 25% is tagged *Squeeze*: volatility is compressed and a big move often follows, in either direction.
- **🚀 / 😢 next to the name**: the **50/200 moving-average trend**. 🚀 is a strong uptrend (fast MA above slow, price above both), and 😢 is a strong downtrend. RSI and Bollinger width are shown in the tile rows and the chart, not as emoji.
- **🔥 / 🧊 at the end**: **30-day momentum**. 🔥 means the coin is up more than 20% over 30 days, and 🧊 means it's down more than 20%. Hover for the exact move.
- **What gets scored:** everything next to the name. The Scorecard judges the MA trend, the P&F trend and momentum: X📈 and 🔥 count as 🚀 calls, O📉 and 🧊 as 😢 calls. So its track record describes exactly what you see. For P&F, each past day is judged from the chart as it looked that day (its own 260 closes and box size), so the backtest never peeks ahead. The weekly tuner can change the MA pair and the momentum threshold, flip a role, or switch a signal off (its emoji then disappears). The legend line shows a track-record badge ("🚀/😢: no proven edge yet", linking to the Scorecard); **ⓘ How to read** opens the full legend with the current rules and the **90-day track record** (it stays open or closed per browser). While that shows no proven edge, the emoji are **dimmed**, as hints rather than calls.
- **X📈 / O📉 after the emoji**: the **point & figure trend**, from the same chart as the popup's P&F view. X📈 means the latest column is rising, and O📉 means it's falling. Hover it for the column's size, when it started, the price for the next box and for a flip, and the latest buy/sell signal. It counts as a 🚀 (X) or 😢 (O) call.
- **Recommended stop-loss** for **long** and **short** positions (the STOP row):
  - distance = **2× the coin's average daily move** over the last 20 days: about 3% for BTC, about 7% for a typical coin. The weekly tuner compares 1.5×, 2× and 2.5× and switches only if another distance's exits saved more in 2 of 3 check periods.
  - set once a day from the last daily close: exit a long below it, or a short above it
  - ⚠️ when price is within a quarter of the distance
  - **⚠ past the stop intraday** (amber border): the live price is beyond today's stop, but no daily close has confirmed it. Watch the 00:00 UTC close.
  - **🛑 closed past the stop** (red border): the last daily close finished beyond the stop that applied that day. This is the suggested exit, and it's what the scorecard measures. The **🛑 Past stop** filter lists these coins.
  - shown in the tile, the table, and the detail chart (as lines). These are suggested levels only: the page isn't real-time, so set stops on your exchange.

- **✓ / ? next to the ticker**: ✓ means the coin's price history comes from an exchange pair confirmed by its CoinGecko ID. ? means it was matched by ticker only (a best guess, checked against the price). Hover the mark to see the exchange and pair.

**Coin details.** Hover a tile to open its details. On laptops they appear in a two-column popup, sized to fit a 13-inch screen:
- **Left:** a 120-day chart of price, both moving averages, the Bollinger band and the recommended stop lines, plus RSI below it. A **Price / P&F** switch (remembered) swaps in a **point & figure** chart:
  - X columns rise and O columns fall, built from daily closes on a log scale
  - the box size is set per coin from its volatility (about 1.5% for BTC, 2–3% for a typical coin), with a 3-box reversal
  - **B** marks a double-top buy (an X column tops the previous X column) and **S** a double-bottom sell
  - a status line gives the price for the next X or O and for a flip in direction, and hovering a column shows its range and dates
- **Right:** the key numbers, the long and short stop cards, and where the price history comes from (✓ or ?).

Hovering is built so the popup never gets in the way of the coin you're reaching for:
- it opens once the mouse **rests** on a coin for about 0.7 seconds, so gliding across tiles opens nothing; or point at the small **ⓘ** in a tile’s corner to open it at once
- it opens on the **side the mouse came from** (to the left or above when you move right or down), leaving the tiles ahead of the mouse visible
- moving toward the popup keeps it open, even across other tiles, so you can reach it
- moving away toward another coin closes it quickly, and that coin opens once the mouse rests on it

Click the popup (or the tile) to pin it open, and click outside it to close it. On phones, tapping a tile opens the same details as a bottom sheet.

**Top of the page.** One slim bar: the title, when the data was last refreshed (and that it is **not real-time**), the coin count, the refresh countdown, theme and WIP buttons. Below it, one row of controls: color by 24h / 7d / 30d, Grid / Table / Scorecard, the filter buttons and the Stablecoins checkbox. On phones the filter buttons are one swipeable row.

**Filters.** The filter buttons (Oversold, Overbought, Uptrend, Downtrend, 🛑 Past stop, and under **More ▾** Squeeze and Recent cross; on phones all of them sit in one swipeable row) show only the matching coins, in both grid and table. Each button shows its count. **All coins** (or clicking the active button again) brings everything back. **Color scale:** click a range on the scale (e.g. "≤ −10" or "±1") to show only the coins in that color band. It combines with the filter buttons; click the range again, or **All coins**, to show everything.

The **Table** view sorts by any column, including the recommended stops. The **Scorecard** view shows how the signals have actually performed.

## Scorecard: are the 🚀 / 😢 right?

Every day at **00:20 UTC** a GitHub job scores the previous day:

- **Yesterday's calls**: for coins with more 🚀, how many went up; for coins with more 😢, how many went down. Each is measured in absolute terms and against the average of all 100 coins. **Click a coin** in the list to open its chart card beside it (the same card as a grid click, with the Price / P&F switch); click it again or × to close.
- **Last 60 days chart**: what holding each day's 🚀 coins, 😢 coins or all coins for one day would have compounded to, with a hover tooltip per day.
- **Track record** over the last 30 days, 90 days and all history (about 2.7 years), judged over the **next day, 3 days or 7 days**:
  - whether more 🚀 meant bigger moves
  - how each signal did on its own, flagged "⚠ pointing the wrong way" when the data disagrees with its role
  - a verdict based on the daily rank correlation between score and the move (for 3 and 7 days, where moves overlap from day to day, t-values are divided by √days so they aren't overstated)
  - whether a squeeze (bottom 10% band width) was really followed by bigger moves than usual
  - for the recommended stops: how often they were crossed, and whether, after getting out, price kept going the wrong way (a good exit) or came back (shaken out)

**Self-tuning, every Sunday.** The newest **90 days are never used for tuning**: the Scorecard shows how the current and the proposed settings did on that untouched stretch, a genuinely unseen check. The tuner tries moving-average pairs (20/50, 20/100, 50/200) and momentum thresholds (10%, 20%, 30%), and decides whether each trend, momentum and P&F signal should count as a 🚀, a 😢, or be switched off, judging it over the next 1, 3 and 7 days. It still measures RSI and wide-band variants and logs what it *would* do with them, but it keeps them off. Since Sept 2026 only the MA trend, P&F trend and momentum are scored; before that, RSI and Bollinger signals counted too, and momentum and P&F were off. The newest half of history is cut into **three check periods**. For each one, settings are chosen using only the days before it, then compared with the current settings on that period. New settings are written to `params.json` **only if they win at least 2 of the 3 periods and do better on average**. Because many variants get tried, a signal needs t ≥ 2.5 (not the usual 2) to be switched on. The site picks new settings up automatically, and every change is logged on the Scorecard.

Statistics cap moves at ±30% a day (wider for 3 and 7 days), so a bad price print can't dominate the averages. The Scorecard still shows each coin's real move. A signal needs at least 20 firings before it gets a verdict.

*Honest baseline (first runs, Sept 2026):* the default signals showed **no reliable next-day edge**. The daily rank correlation was about 0, and 🚀 coins went up 48% of the time, the same as all coins. Two signals pointed the wrong way: overbought and wide-band coins tended to *keep* outperforming (momentum). So far the tuner has kept the defaults, because the momentum settings didn't hold up on the most recent months. And ⚡ squeezes (bottom 10% of band width) were followed by *smaller* moves than usual (about 0.85×), not bigger ones. The recommended stops were crossed about 22% of the time within 3 days, and after an exit the next move was roughly a coin flip. Among the three distances, **2.5×** exits saved the most (about 0.43% over 3 days, vs 0.18% at 2×), so the tuner is set to switch to it at its next run. **30-day momentum** was the strongest single signal found (t ≈ 2.9), but the full set of proposed settings hasn't yet beaten the current ones on recent data. That's typical: a stop doesn't predict direction, it caps how much you can lose.

**How honest is the scorecard?** Some safeguards against fooling ourselves:
- **Conditions, not predictions:** the emoji describe a coin's current trend, point & figure column and momentum. The Scorecard tests whether they would have predicted anything, and the page says so (**ⓘ How to read**).
- **Costs:** results are also shown after an estimated round-trip trading cost: about 0.2% for crypto (0.1% each way on a large exchange) and about 0.05% for forex (the spread). A small edge can disappear after costs.
- **Untouched holdout:** the tuner never sees the newest 90 days (see Self-tuning).
- **Point-in-time list:** scoring today's top 100 flatters the 🚀, because coins make the list *by* rising. From Oct 2026 the scorer records each day's list (`data/universe-history.json`) and scores those coin-days separately. A verdict needs about 60 days of records.
- **Unusual jumps** in currency rates are flagged and left out (see Forex).

## Forex: heat.sala.company/forex/

The same heatmap for **48 currencies against the US dollar**. The **🪙 Crypto | 💱 Forex** switch at the start of the controls row moves between the two pages.

- **It's the same page.** `/forex/` is made from `index.html` at deploy (`scripts/forex-page.mjs`), with only the search tags, the About/FAQ text and the source credits swapped in (`seo/forex-*.html`). The page picks its market from its address, and everything market-specific sits in one `MARKETS` settings block at the top of the page script. So any change to tiles, popups, filters, the scorecard or the engine shows on both pages.
- **Rates:** official **ECB euro reference rates** (via the Frankfurter API) for 29 currencies, set once per business day around 14:15 Frankfurt time, with history back to 1999. Currencies the ECB doesn't publish (the ruble, the Gulf and other Arab currencies, the rial, the Syrian pound) come from the public-domain **exchange-api** feed and get the **?** mark. ECB rates get **✓**. Weekends have no rates, so charts and indicators use business days.
- **Quoting:** every pair **dollar first** by default (USD/EUR, USD/GBP, USD/JPY…), so all tiles read the same way: blue means the dollar gained against that currency. The **USD/… | …/USD** switch flips every pair to **currency first** (EUR/USD, GBP/USD, JPY/USD…), where blue means that currency gained. Rates, charts, stops and 🚀/😢 are all recalculated from the flipped history. `forex.json` and the Scorecard are always USD/… (the Scorecard says so in the …/USD view). Note that brokers quote EUR, GBP, AUD and NZD currency first (EUR/USD) and most other currencies dollar first (USD/JPY).
- **Flags:** real flag emoji on phones and Macs; on Windows, which has none, a small country-code badge (EU, JP …) instead.
- **Pegged currencies** (SAR, AED, QAR, BHD, OMR, JOD, IQD, LBP and HKD) are hidden unless you tick **Pegged**, and they're never scored. This setting is separate from crypto's Stablecoins checkbox.
- **Unusual jumps:** a one-day move at least 10× the currency’s typical move over the previous 60 days (and at least 2.5%) is flagged. In the last month it gets a **⚠** on the tile and an explanation in the popup. It may be a data glitch, or a real devaluation (EGP, LBP, SDG, the rial). Either way, that day and the 7 days before it are left out of the scorecard.
- **IRR and SYP:** their official and street rates differ a lot, so they're shown with **⚠** and a note in the popup, and never scored.
- **Forex-sized settings:** the color scale runs ±0.1% … ±1% for a day. Timeframes are **1d / 1w / 1m** (1, 5 and 21 business days). Momentum is a 21-business-day move above or below 3%. P&F boxes go down to 0.1%.
- **Scorecard and tuner:** `scripts/score-forex.mjs` runs in the same nightly job (and tunes on Sundays), on ECB history since 2010 plus the extra feed since March 2024. It writes `data/forex-scorecard.json`, `params-forex.json` (when the tuner adopts new settings) and `data/forex-extras.json` (a cache of the extra feed, so each run only fetches new days). *First run (Oct 2026):* about 116,000 currency-days, with no reliable edge for any scored signal.

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
| `index.html` | The page: HTML, CSS, and its search and link-preview tags |
| `app/` | The page script, as ES modules: `markets.mjs` (everything market-specific, one adapter per market), `core.mjs` (helpers and state), `data.mjs` (indicators per tile), `render.mjs` (tiles, legend, table), `scorecard.mjs`, `interact.mjs` (popup, hover, clicks, switches) and `main.mjs` (loading and refresh; it starts the page) |
| `og-image.png`, `og-image-forex.png`, `robots.txt` | The link-preview images (crypto and forex) and the robots file, published with the site (the deploy job also writes `sitemap.xml`) |
| `scripts/build-forex.mjs` | Builds `forex.json`: the currency list, both rate sources, business-day closes. Reuses the last file and refetches hourly |
| `scripts/score-forex.mjs` | Daily forex scorecard and weekly tuning |
| `scripts/forex-page.mjs`, `seo/` | Makes `/forex/` from `index.html`, swapping in the forex search tags, About/FAQ and source credits |
| `params-forex.json`, `data/forex-scorecard.json`, `data/forex-extras.json` | Forex signal settings, the latest forex scorecard, and the cached extra-feed rates |
| `signals.mjs` | The shared signal engine: indicators, 🚀/😢/⚡ rules, scoring stats, tuner. Used by the page, the scorer and the tuner, so they always agree. |
| `tests/signals.test.mjs` | Unit tests: RSI against the StockCharts worked example, Bollinger/SMA against hand-computed values, scoring and tuning sanity checks |
| `scripts/build-data.mjs` | Builds `data.json`: top-250 rankings plus 260 daily closes for the top 150 (enough for 100 after exclusions), with fallbacks across six data sources |
| `scripts/score.mjs` | Daily scorecard and weekly tuning (about 1,000 days of candles per coin) |
| `params.json` | Signal settings chosen by the tuner. Missing means the defaults in `signals.mjs` are used. |
| `data/scorecard.json` | Latest scorecard, committed daily by the bot |
| `data/pairs.json` | Each coin's exact USDT pair on Binance, Gate.io, OKX, MEXC and KuCoin, from CoinGecko's per-coin tickers. Refreshed weekly by the scorer (and for coins new to the top 100), so a ticker shared by two coins, or a renamed coin (Toncoin now trades as GRAM), can't pull in the wrong price history. |
| `.github/workflows/update-data.yml` | Builds `data.json` and deploys the site to GitHub Pages every 10 minutes and on every push to `main` |
| `.github/workflows/score-signals.yml` | Daily scoring (plus Sunday tuning). It commits the results, which also keeps the schedules from being paused for inactivity. |
| `.github/workflows/test.yml` | Runs the unit tests on every push to any branch |
| `.github/workflows/freshness.yml`, `scripts/check-fresh.mjs` | **Hourly freshness check** of the live site: fails (and GitHub emails you) if `data.json`, `forex.json` or a scorecard stops updating, even when every other job "succeeds" |
| `data/universe-history.json` | Each day's top-100 list, for the point-in-time scorecard |
| `.github/workflows/e2e.yml` | **Browser tests** (Playwright, headless Chrome) on every push to any branch: no outside API calls, filters, both stop states, the popup (fits a 13-inch screen, opens only on a resting mouse, closes when moving away, stays put when moving onto it, pins and closes), the phone bottom sheet, and the Scorecard view |
| `tests/e2e/` | The browser tests, deterministic test data (`fixtures.mjs`) and a local server (`serve.mjs`, also `npm run dev`) |

**How the data stays safe and fresh:**
- The deploy job publishes to Pages without committing. The daily scorecard commit keeps the repo active, since GitHub pauses scheduled workflows after 60 days without commits.
- Each build reuses the previous `data.json`. Candles are refetched hourly (every 6 h for coins that come from CoinGecko). In between, the page updates today's candle with the latest price.
- If `data.json` is missing or more than 45 minutes old, the page runs the **same build script** (`scripts/build-data.mjs`, published with the site) in the browser, without the slow CoinGecko candle fallback. It does this **at most once per 10 minutes per browser** and caches the result, so reloads and other tabs make no extra API calls.
- Stablecoins, tokenized gold, wrapped/staked copies and fund tokens are excluded. The checkbox next to **How to read** brings them back.

## Running it yourself

- **Making changes:** work on a branch. The unit and browser tests run on every push to any branch; merge into `main` only when both pass. Only `main` deploys.

- **Rebuild from scratch:** [`docs/rebuild-prompts.md`](docs/rebuild-prompts.md) has the 12 prompts, in order, that built this project with Claude.
- **Manual runs:** go to **Actions → Update heatmap data → Run workflow**, or **Actions → Score signals → Run workflow**. Tick *"Run the tuner now"* to tune immediately.
- **Locally:** `node scripts/build-data.mjs data.json`, then serve the folder (for example `npx serve .`). Scoring: `node scripts/score.mjs --tune` (needs the live `data.json`, via `SITE_URL`). Tests: `npm test` (unit) and `npm run test:e2e` (browser). Preview with test data: `npm run dev`.
- **Timers:** GitHub's own schedules proved unreliable (about 1 run in 15, and no daily runs), so **cron-job.org** starts both workflows through GitHub's API, using a fine-grained token limited to this repo (Actions: read and write). The token expires in September 2027 and must then be renewed in both cron-job.org jobs. GitHub's schedules stay on as a backup, and the page's in-browser fallback covers any gaps.

## Search engines and link previews

- **Title and description** are written for search results: "Crypto Heatmap: Top 100 Coins, RSI & Trend", under Google's length limits.
- **Canonical URL** `https://heat.sala.company/` and `robots` allowing indexing.
- **Link previews** (Open Graph and X): `og-image.png`, a 1200×630 screenshot of the heatmap. To refresh it, take a new 1200×630 screenshot of the page and replace the file.
- **Structured data** (JSON-LD): a `WebApplication` and an `FAQPage`. The FAQ questions are also shown as plain text in the **About this crypto heatmap** section at the bottom of the page, because Google wants FAQ markup to match visible text.
- **`robots.txt`** (in the repo) and **`sitemap.xml`** (written by the deploy job with today's date) are published with the site.
- To get it indexed faster, add the site in **Google Search Console** and submit `https://heat.sala.company/sitemap.xml`. The domain is already verified for GitHub, but Search Console needs its own verification (a TXT record at GoDaddy).

## Hosting setup

1. **Settings → Pages → Source: GitHub Actions.**
2. Custom domain `heat.sala.company`:
   - At GoDaddy, add a `CNAME` record from `heat` to `jamalxcode.github.io`.
   - **Enforce HTTPS** is on.
3. `sala.company` is a **verified domain** on the GitHub account, via the TXT record `_github-pages-challenge-jamalxcode`. Keep that record: it stops anyone else from using the domain on GitHub Pages.
4. The main site `sala.company` and `www` stay on Shopify. Only the `heat` subdomain points to GitHub.

*Not financial advice. Don't trust anyone, ever, including this page.*

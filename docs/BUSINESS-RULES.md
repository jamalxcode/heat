# Business rules

Every rule the site follows about **data and numbers**: where they come from, how often, what counts as what, and what happens when something breaks. How things *look* is in [`INTERFACE-RULES.md`](INTERFACE-RULES.md); *why* a rule is the way it is, in [`DECISIONS.md`](DECISIONS.md) (numbers in brackets point there). Keep this file in step with the code: the numbers below are the code's constants as of 16 Nov 2026.

## 1. Data, timing and failures

| Rule | Value |
|---|---|
| Update cycle | Every 10 minutes (`update-data.yml`, started by cron-job.org; GitHub's own schedule is the backup) [2, 14] |
| Who calls the market APIs | Only the GitHub Actions builders. Visitors' browsers read the published JSON [6, 12] |
| In-browser fallback (crypto only) | If `data.json` is missing or older than 45 min, the page runs `scripts/build-data.mjs` itself, at most once per 10 min per browser |
| A source fails | It keeps its last data, marked late ("⚠ not refreshed", "?") [7, 13] |
| A whole builder fails or times out | The last published file is republished [7, 13] |
| Freshness alarm | Hourly `check-fresh.mjs`: fails (GitHub emails) when a file stops updating, a prediction venue is stale for a day or has an empty tab, or a rates source keeps failing for a day [8] |
| Repeat visit | The browser draws its last copy (under a day old, under 3 MB) at once, marked "last visit's prices", then swaps in the fresh file [44] |
| Sharing a card | The page sends nothing: WhatsApp, Telegram, X and email links open the visitor's own app; the picture is drawn in the browser. Every message ends with the site and "not financial advice" [54] |
| `pulse.json` | `items`: BTC, ETH, gold, Brent for go.sala.company (unchanged); `xm`: each market's headline figure for the market tabs (BTC, DXY, gold, Brent, SPY, US 10-year in bp). A missing figure is left out, never guessed [26, 31] |

## 2. Which assets are listed

- **Crypto:** the top 100 by market cap from CoinGecko (CoinLore as backup), with stablecoins, tokenized gold, wrapped/staked copies and fund tokens left out (a checkbox brings them back). Each coin's price history comes from its exchange pair matched **by CoinGecko ID**, not ticker (✓ confirmed, ? ticker guess) [17].
- **Forex:** 48 currencies against the US dollar: ECB reference rates (✓) plus the public-domain exchange-api feed (?). Pegged currencies (SAR, AED, QAR, BHD, OMR, JOD, IQD, LBP, HKD) are hidden by default and **never scored**; IRR and SYP carry a warning and are never scored.
- **Metals:** gold, silver, platinum, palladium per troy ounce, plus PAXG, XAUT and Bitcoin for comparison. Copper is out (industrial, no free public-domain feed).
- **Energy:** WTI, Brent, NY Harbor diesel and gasoline, Henry Hub and Dutch TTF gas, front-month futures from Yahoo Finance. A benchmark with no free price about 10 minutes fresh is left out (Urals, Dubai, JKM…) [21].
- **ETFs:** 112 US stock ETFs, the most traded by dollars a day, **one fund per index**, none under $5m a day, no bond, cash, leveraged or inverse funds.
- **Rates:** 14 markets' official government yield curves plus a monthly Europe row (ECB convergence yields). Official sources only [21].
- **Predictions:** the most traded questions on Polymarket, Kalshi, PredictIt, Manifold and Betfair (Betfair only with its secrets). **Single games are left out of the build**; Polymarket's "Build your map" bundles too.

## 3. Signals (crypto settings; others noted)

Defaults live in `signals.mjs`; the weekly tuner may change some of them in `params.json` / `params-forex.json`.

| Signal | Rule |
|---|---|
| RSI | 14 days; oversold under 30, overbought over 70 |
| MA trend | 50-day vs 200-day; "strong" when the price agrees; ✦ a golden/death cross in the last 14 days. 🚀 strong uptrend, 😢 strong downtrend |
| Point & figure | Box size per asset from its volatility, 3-box reversal, daily closes, log scale; X📈 rising column = 🚀 call, O📉 = 😢 call |
| Momentum | 30-day move above +20% 🔥 (🚀 call), below −20% 🧊 (😢 call). Forex: 21 business days, ±3% |
| Relative strength (on trial) | 30-day move vs Bitcoin (forex: vs the basket; metals: gold; energy: Brent; ETFs: SPY); "beating/trailing" past ±10% (±1.5% forex). Scored, never counted |
| Volume surge (on trial) | Last 7 days' average volume ≥ 1.5× the 30 days before, with the price direction. Crypto and ETFs only. Scored, never counted |
| Year range | Highest and lowest close over the last 365 days of history; named by the span there is ("9-month" on crypto's 260 closes) [41] |
| Emoji size | Full size and colour only once the Scorecard shows that signal works (t ≥ 2, right direction, averaged over 1, 3 and 7 days, all history); small and grey until then [18] |

## 4. Recommended stops

- Distance = **2×** the asset's average daily move over the last **20** days (the tuner compares 1.5×, 2×, 2.5×), set once a day from the last completed close.
- **Near:** within a quarter of the distance (⚠️). **Intraday:** the live price is past today's stop, no close yet (amber, "watch"). **Closed past:** the last daily close finished past the stop that applied that day (🛑, the suggested exit, and what the scorecard measures).
- Suggested levels only: the page isn't real-time and can't exit a position.

## 5. Scorecard and tuner [18]

- Daily at 00:20 UTC; each day's signals scored against the next **1, 3 and 7** days, raw and against the average of all assets.
- Daily moves capped at **±30%** in statistics (wider for 3 and 7 days); t-values for 3 and 7 days divided by √days; a signal needs **20 firings** before a verdict.
- Costs shown: about **0.2%** round trip for crypto, **0.05%** for forex.
- **Fair figures first:** each day judged on that day's top 100 (point-in-time list, `data/universe-history.json`), including coins that later left it.
- **Tuner (Sundays):** the newest **90 days** are never used for tuning; new settings must win **2 of 3** walk-forward periods and do better on average; a signal needs **t ≥ 2.5** to be switched on; new signal settings must also hold on the fair days, and none are adopted until there are **60** of them.
- No scorecard for metals (4 assets) or energy (6); ETFs have enough assets but no scorecard yet [20].
- **Forex jumps:** a one-day move ≥ 10× the usual (and ≥ 2.5%), once there are 10 days to judge; community-feed jump days (and the 7 before) are left out of scoring, official ECB jumps stay in [19].

## 6. Cross-checks and sources

- **Metals:** exchange-api's daily close vs Swissquote's: within **1%** (2% for silver, platinum, palladium) = ✓, otherwise ? and ⚠.
- **TradingView links:** only symbols TradingView's lookup confirmed (`tv.json`); at most 80 lookups per deploy, 0.25 s apart; found symbols re-checked every 2 weeks, missing ones every 3 days.
- **Fuel tables:** refetched every 6 hours; marked weekly / a week behind.
- **Rates:** refetched every 3 hours; the weekly ten-year history once a week; China and India filled a few dates per run.

## 7. Rates readings

- **Curve:** 10-year minus 2-year (UK: minus Bank Rate; South Africa: minus the 3-month bill). **Normal** ≥ +0.5 pp, **Flat** 0 to +0.5, **Inverted** < 0; each gap also ranked against that country's own last ten years.
- **Real yield:** 10-year minus the latest yearly inflation. A card flags it only from **−0.05%** down [37].
- **Risk tag:** the gap to a benchmark (the US; Germany for the monthly European cards) ranked in that country's own last ten years: **High** wider than 75% of them, **Low** narrower than 75%, **Average** between; under 3 years of history: "building history". A card shows only **High**; the popup and table show all [37].

## 8. Prediction markets

| Rule | Value |
|---|---|
| Fetch | Every 10 min: Polymarket top 120 events by 24 h volume; Kalshi's 120 most traded refreshed, full list scanned **hourly**; PredictIt's whole feed (top 80); Manifold top 100; Betfair politics top 60 [1–5] |
| History backfill | Up to **80** Polymarket and **40** Kalshi markets per run (4 and 2 at a time), each at most once a day, until 25 days are there [5] |
| Common money | US dollars: Kalshi contracts × price; Manifold play money at M$100 = $1 and left out of "All" unless ticked; Betfair pounds at the day's rate. **Interest** = bet today + a 30th of bet in total |
| Thin market | Under **$1,000** of interest (real money; not PredictIt, which publishes no money): faded |
| Decided | Likeliest answer at **97%+**, or past its end date (then "Awaiting the result" until 97%) |
| Called | **90%+** after moving **30+ points** in a week: leaves the open questions for Just decided |
| Venues disagree | Prices **5+ points** apart (PredictIt **8+**, its fees pull favourites down) → ⚡ |
| Mixed topics | On Biggest bets, Surest bets, Close calls and Big movers each further question from the same topic counts **×0.65** (×0.42 the third…) |
| Big movers | Need at least **$10,000** of interest |
| Since your last visit | Compares with the saved visit when it's an hour or more old; shows moves of **5+ points** |
| Track record | A question logged once when it settles (an answer at 97%+, or yes/no at 3% or less) with every answer's chance a week before; only questions whose answers are all known count (one-winner lists need 85% coverage); last **3,000**; real money only |
| Question pages | The **80** most traded open questions, one per question, no single games or called races |
| Show more | 24 questions, then 24 more |
| Yes/no wording | The likelier side as a statement ("✗ No, it won't happen · 92% chance"); under 60% "Too close to call · leaning"; decided ones as results ("✓ Yes" / "✗ No") [47, 48] |

# Rebuild transcript: heat.sala.company

These 12 prompts cover everything we built. Paste them in order, and wait for each step to be live and verified before sending the next. The fixes we found along the way are folded in, so a rebuild skips those detours.

---

### 1. The heatmap
> Build a single-file crypto heatmap (`index.html`) of the **top 50 coins by market cap**, for GitHub Pages. Each tile is colored by the 24h change (with 7d and 30d as options) on one continuous scale: **near-black gloomy red** for the biggest drops → dark red → muted red → pale red, **white** for flat, then whitish blue → light blue → bright blue → **rich sea blue** for the biggest gains (9 steps). Inside each tile show:
> - **RSI(14)** as a small 0–100 gauge, tagged Oversold below 30 and Overbought above 70
> - **Trend** from the 50-day vs 200-day moving average (up/down, "strong" when price agrees, ✦ for a golden or death cross in the last 14 days)
> - **Bollinger Band width (20, 2)** ranked against its last 180 days (Squeeze / Normal / Expanded)
>
> Also add: hover or tap for a detail chart (price, both moving averages, Bollinger band, RSI), a sortable table view, highlight filters, and light/dark mode. Exclude stablecoins, tokenized gold, wrapped or staked copies and fund tokens (with a checkbox to show them). Prices and rankings come from CoinGecko; daily candles from Binance, then Gate.io, then OKX.

### 2. Signal emoji
> Next to each coin's name show one 🚀 for each of: strong uptrend, RSI oversold. Show one 😢 for each opposite: strong downtrend, RSI overbought, wide band (top 20%). Show a **⚡ for a very tight band (bottom 10%)**. It means a big move is likely but not its direction, so it never counts as 🚀 or 😢. Show the rules in the legend.

### 3. Branding, disclaimers, freshness
> Title the page **heat.sala.company**, with a glowing 🔥 logo and a flame favicon. Add:
> - a dismissible **"Work in progress, use at your own risk, don't trust anyone"** popup that floats at the top without blocking the page, is remembered for 30 days, and can be reopened from a ⚠ WIP button
> - a **"Last refreshed HH:MM (x min ago)"** banner that says prices are **not real-time and refresh every 10 minutes**, and turns amber when an update is late

### 4. Data pipeline (no API calls from visitors)
> Move all data fetching to **GitHub Actions**:
> - A Node script builds `data.json` (top-100 rankings plus 260 daily closes per coin) and **deploys it with the page to GitHub Pages every 10 minutes**, without committing.
> - Rankings: CoinGecko, then CoinLore, then the previous copy. Candles: Binance, Gate.io, OKX, then (server-side only) MEXC and KuCoin, then CoinGecko. Reuse the previous build's candles for an hour.
> - The page reads only `data.json`. If that's missing or more than 45 minutes old, the page runs the **same build script in the browser**, at most once per 10 minutes per browser.
> - Add unit tests (`node --test`) run on every push.

### 5. Hosting and timers
> Create the public repo `heat`, push, and deploy via Pages from Actions. Guide me step by step through the **GoDaddy CNAME** (`heat` → `<user>.github.io`), then set the custom domain and enforce HTTPS. Then walk me through **domain verification** (the TXT record `_github-pages-challenge-<user>`), leaving my Shopify records for `@` and `www` untouched.
>
> GitHub's own schedules are unreliable, so guide me through setting up **cron-job.org** to trigger the workflows through the API: every 10 minutes for data, and daily at 00:20 UTC for the scorecard. Use a fine-grained token limited to this repo with Actions read/write. **Warn me never to paste the token into chat**, and give me a calendar reminder to renew it.

### 6. Add it to my portal
> Add a card for Heat to my portal at go.sala.company (repo `sala-company-start-page`). Match the existing cards exactly (Tools section, NEW + BETA badges like Sala News) and update its README. Don't break the page.

### 7. Scorecard and self-tuning
> Put every signal in one shared engine (`signals.mjs`) used by the page, the scorer and the tuner. Every day at 00:20 UTC, score the signals at each close against the move over the **next 1, 3 and 7 days**, both raw and against the average of all 50 coins. Correct the statistics for overlapping multi-day windows, cap daily moves at ±30%, and require at least 20 firings before judging a signal. Commit the result as `data/scorecard.json`.
>
> Add a **Scorecard** view with:
> - yesterday's calls
> - the track record over 30 days, 90 days and all history (with a horizon switch)
> - how each signal did on its own, flagged "⚠ pointing the wrong way" when the data disagrees
> - whether ⚡ squeezes were really followed by bigger moves
> - a **60-day chart** of holding the 🚀 coins vs the 😢 coins vs all coins, with a survivorship-bias note
>
> **Weekly tuner:** try other RSI and moving-average settings and decide whether each signal should be 🚀, 😢 or off. Use 3 walk-forward check periods, adopt new settings only if they win at least 2 of 3 and do better on average, and use t ≥ 2.5 to switch a signal on. Log every change.

### 8. Recommended stop-losses
> Add a **recommended stop-loss for long and short positions**:
> - distance = **2× the coin's average daily move over 20 days** (about 3% for BTC, 7% for a typical coin), set once a day from the last close
> - show it in every tile (L / S), with ⚠️ when the price is near a stop and **🛑 "crossed: get out"** plus a red tile border once it's passed
> - add a "Stop crossed" filter, table columns, cards in the popup, and stop lines on the chart
> - include a "suggested levels, set them on your exchange" disclaimer
>
> Score the stops as well: how often they were crossed, and whether, after the exit, the price kept going (a good exit) or came back (shaken out).

### 9. Match coins by ID
> Match each coin to its exchange pairs **by CoinGecko ID, not by ticker**. Once a week, fetch each coin's exact USDT pairs from CoinGecko's per-coin tickers:
> - Don't filter on `coin_id`: renamed coins like Toncoin → GRAM report a new ID.
> - Space the requests about 6 seconds apart, with an **8-minute time budget**. Coins that aren't reached get fetched on the next daily run.
>
> Prefer the verified pair, but **use whichever exchange has the longest history** when a renamed coin's new pair is too young for the 200-day average. Show a small **✓ (verified) or ? (ticker guess)** next to each ticker, with the pair shown on hover.

### 10. Popup usability
> Make the coin popup fit a 13-inch screen: **720px wide with two columns** (charts left; numbers, stops and source right), always clamped inside the window, and a single-column bottom sheet on phones.
>
> The popup must **keep the mouse** so the tiles underneath don't take over. Switching to another coin should wait about 0.2 s, clicking the popup pins it, and clicking outside closes it (judge "outside" by the click's original path).

### 11. Review and harden
> Critique what we built and fix the top issues:
> - remove the old in-browser rate limiter (the data pipeline replaced it)
> - verify the RSI against the StockCharts worked example
> - make sure every job can't lose its work when it hits its time limit
>
> Then update the README to describe everything, including the honest baseline results.

### 12. Status checks (repeat as needed)
> Status check on heat.sala.company: scheduled and manual runs over the last 24 hours, refresh gaps, data age, the latest scorecard and tuner decision, failures, and anything to sync to GitHub.

---

## Tips for a smooth rebuild
- Ask for **real-data checks before publishing** at each step. Several bugs only showed up against live data: the Toncoin rename, the biased "good exit" measurement, and blank tuner scores.
- If you work from a machine without Node, ask Claude to run the tests in the browser.
- Keep API tokens and passwords out of chat completely. Share only status codes, like "204".

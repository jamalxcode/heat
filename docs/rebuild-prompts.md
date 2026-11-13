# Rebuild transcript: heat.sala.company

These 30 prompts cover everything we built, up to 13 Nov 2026. Paste them in order, and wait for each step to be live and verified before sending the next. The fixes we found along the way are folded in, so a rebuild skips those detours.

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

### 12. Point & figure, momentum, top 100
> - Add a **point & figure chart** to the coin popup behind a remembered **Price / P&F** switch: daily closes on a log scale, a box size per coin from its volatility (about 1.5% for BTC), 3-box reversal, **B** / **S** for double-top buys and double-bottom sells, and a status line with the price for the next box and for a flip.
> - Grow the list to the **top 100**. Next to the name show only the MA trend (🚀 / 😢) and the P&F trend (**X📈 / O📉**), and at the end **30-day momentum** (🔥 above +20%, 🧊 below −20%).
> - Score the P&F trend and momentum as 🚀 / 😢 calls too, judging each past day from the chart as it looked that day, so nothing peeks ahead.
> - Hover: open only after the mouse **rests** about 0.7 s, on the side the mouse came from, with a small ⓘ in each tile that opens at once. Clicking one of yesterday's coins on the Scorecard opens its chart card beside it.

### 13. Compact top, search engines
> Make the top of the page one slim bar (title, last refreshed and **not real-time**, coin count, countdown, theme, WIP) and one row of controls, with a one-line legend and an **ⓘ How to read** panel. On phones the filter buttons are one swipeable row and the colour scale stays inside the screen; clicking a range on the scale shows only the coins in that colour band.
>
> For search: a title and description within Google's limits, canonical URL, Open Graph / X link previews with a 1200×630 `og-image.png`, JSON-LD (`WebApplication` and an `FAQPage` whose questions also appear as visible text in an About section), `robots.txt`, and a `sitemap.xml` written by the deploy job.

### 14. Forex page
> Add **heat.sala.company/forex/**: the same page for **48 currencies against the US dollar**, made from `index.html` at deploy with only its search tags, About/FAQ and source credits swapped in, and a market switch in the controls row.
> - **Rates:** official ECB reference rates (via Frankfurter) with ✓, and the public-domain exchange-api feed with ? for currencies the ECB doesn't publish. Charts use business days.
> - **Quoting:** dollar first by default (USD/EUR…), with a **USD/… | …/USD** switch that recalculates everything.
> - Hide pegged currencies behind a **Pegged** checkbox and never score them; flag IRR and SYP (official vs street rate).
> - Forex-sized colour scale, 1d / 1w / 1m, momentum 3%, P&F boxes down to 0.1%, and its own scorecard and tuner (`scripts/score-forex.mjs`) on ECB history since 2010.

### 15. Checkpoint: structure and safety nets
> - Split the page script into ES modules under `app/`, with **one adapter per market** in `markets.mjs`.
> - Run unit and browser tests on **every branch**; merge to `main` only when both pass.
> - Add an **hourly freshness check** of the live site that fails (and emails) when any file stops updating, even when every job "succeeds".
> - **Unusual jumps:** flag one-day moves at least 10× the usual (and 2.5%+), once there are 10 days to judge from. Leave community-feed jump days out of scoring, but keep official ECB jumps: they really happened.
> - Show scorecard results after **trading costs**, keep the newest **90 days as an untouched holdout**, and start recording each day's top 100 for a **point-in-time** check.

### 16. Metals, TradingView links, safe deploys
> - Add **/metals/**: gold, silver, platinum, palladium per troy ounce, with PAXG, XAUT and Bitcoin for comparison. History from exchange-api, current prices from **Swissquote**, and a daily cross-check of the two (✓ within 1%, 2% for silver and the platinum group). No scorecard: four metals are too few.
> - In the popup, link the logo and name to the asset's **TradingView chart**, but only for symbols TradingView's symbol lookup confirms (checked in the deploy, cached in `tv.json`, gentle on their rate limit).
> - Deploy: tag every script address with the commit, so a page never runs old cached scripts. Add a **sources health line** in the footer built from the files the deploy just made.

### 17. Better signals, honest scorecard, heatmap look
> - Replace the Bollinger width row with **relative strength** (vs Bitcoin; forex vs a basket; metals vs gold) and **volume surge** (7 days vs the 30 before, 1.5×). Both are **on trial**: scored nightly, never counted, no emoji. Keep Bollinger in the chart.
> - **Emoji size follows the record:** full size and colour only once the Scorecard shows the signal works (t ≥ 2 over 1, 3 and 7 days), otherwise small and grey.
> - **Shareable links:** the address bar matches the view (filter, range, timeframe, view, tile style, open coin) and 🔗 copies it; a link never overwrites saved settings.
> - **Point-in-time scorecard:** score coins that have since left the top 100, and rebuild the past daily lists once from CoinGecko market caps (gentle, resumable). Lead the Scorecard with a plain answer on these **fair figures**, and adopt no tuner change the fair days don't confirm.
> - Look: full-colour **heatmap tiles** by default (Detailed as an option), a stronger blue / red scale, self-hosted **Inter**, a blink when a price changes, and a **↺ Reset** button.

### 18. Energy page
> Add **/energy/**: WTI, Brent, New York Harbor diesel and gasoline, Henry Hub and Dutch TTF gas, as front-month futures from Yahoo Finance's public chart data (about 10 minutes delayed). Leave out any benchmark with no free price that fresh. Trading days for timeframes, no volume (it jumps at every roll), RS vs Brent, units named in the popup, no scorecard.
>
> Under the futures, weekly rows: **pump prices** for the US, UK and all 27 EU countries in US dollars per litre (local price beside), and **US refined-product spot prices** from EIA via FRED, marked as a week behind.

### 19. Rates page
> Add **/rates/**: official government bond **yield curves** for the US, euro area, Germany, UK, Japan, Canada, Australia, Switzerland, Sweden, Norway, Brazil, China, India and South Africa, plus a clearly marked monthly Europe row (ECB convergence yields with the gap to Germany). Official sources only, each market with its own date.
> - Each card: the 10-year and its move in basis points, a sketch of today's curve, **🟢 Normal / 🟡 Flat / 🔴 Inverted** from the 10y − 2y slope, ranked against the country's own ten years, a **real yield** pill (10-year minus inflation) and a **risk tag** (the gap to the US, or to Germany in Europe, ranked against its own history).
> - A small popup beside the card (hover or tap): the curve now vs a week, a month and a year ago, or ten years of slope history; TradingView links.
> - Sort, group by region, table view, colour by change / curve / real yield, shapes as well as colours (colour-blind safe). Build it in the background every 3 hours, keeping each source's last curve when it fails.

### 20. Dollar index and ETFs
> - On the forex page, a **US Dollar Index** bar above the tiles computed from six ECB rates with ICE's formula (no extra requests), with a note that it differs day to day from the official 17:00 New York close. Publish every script the page imports, and add a test that checks it.
> - Add **/etfs/**: the 112 most traded US stock ETFs, **one fund per index**, none under $5m a day, no bond, leveraged or inverse funds, grouped under US market, sectors, industries and themes, and international (with flags). Yahoo prices in 6 bulk requests per build, history with volume hourly, RS vs SPY.

### 21. Analytics and hardening
> Add the shared **GoatCounter** snippet (copy it from the other sala.company sites, endpoint `https://salacompany.goatcounter.com/count`). Pass workflow inputs through environment variables, and load coin logos only from CoinGecko's own image hosts.

### 22. Prediction markets
> Add **/predictions/**: the most traded questions on **Polymarket, Kalshi, PredictIt, Manifold and Betfair** (Betfair only when its secrets are set), with a tab per venue and an **All** tab.
> - Build `predictions.json` every 10 minutes in the same deploy job. Scan Kalshi's full list hourly and refresh its top 120 in between; backfill daily history from Kalshi's candles and Polymarket's price history, capped per run and once a day per market. A venue that fails keeps its last markets, marked late.
> - Put money on one **US-dollar yardstick** (bet today, bet in total); leave Manifold's play money out of All unless ticked.
> - Match the **same question across venues** by wording and outcomes (years, parties, states, districts must agree) and show it as one tile with each venue's chance; ⚡ when they differ.
> - Leave single games out of the build.

### 23. Predictions you can read at a glance
> Redesign the predictions page so a tile says what the market thinks in plain words:
> - question tabs (Surest bets, Biggest bets, Close calls, Big movers, Ending soon, Venues disagree), a **Today** strip and a **Just decided** row (with upsets and called races)
> - a short headline with a topic icon and the full question below, a **verdict** and the likelier answer in words, colour by how likely it is (one blue hue, colour-blind safe; bold likely, italic serif unlikely), a trend line and a time-left ring
> - one card per story, mixed topics at the top, short-term price bets off by default
> - views: tiles, grouped by topic or story, a **money map** and a table; a watchlist, "since your last visit", copy link, `?view=` in the link
> - a popup with the answer first, a 35-day chart, each venue's price and related questions
> - a **track record** of how often answers at each price happened, counting only questions whose answers are all known
> - static pages for the 80 most traded questions at `/predictions/q/<slug>/`

### 24. Project guidance, pulse, checks
> - Add a `CLAUDE.md` with commands, architecture, deployment and gotchas.
> - Publish a tiny `pulse.json` (a few headline prices, under 1 KB) for go.sala.company's live strip.
> - Add prediction markets to the freshness check (an hour without a build, a venue stale for a day, or an empty tab), and start `docs/DECISIONS.md` with why the data is fetched as often as it is.
> - Prediction tiles: stack the answer under the question so stretched tiles have no hole, give a 2×2 tile only to questions with a race or related questions to fill it, and put money bet today in the header chip.

### 25. Plain words and up-to-date docs
> Use plain wording in the scorecard and rates text: today's list "makes the signals look better" or is "too kind to the signals", and a yield gap is "less steep". Then bring the README, `docs/DECISIONS.md` (including the reasons behind the older parts of the site) and these rebuild prompts up to date.

### 26. At a glance
> Critique the site as a first-time visitor sees it on a laptop and a phone, then make it immediate:
> - a **headline** above the tiles on every price page: the typical move (weighted by market cap on crypto, the median elsewhere), how many rose and fell with a bar of the split, and the biggest gain and drop (each opens its card); ETF group headings get their own average
> - **each market's figure on the market switch** (BTC, DXY, gold, Brent, SPY, US 10-year in bp) from a new `xm` field in `pulse.json`, leaving `items` unchanged for go.sala.company
> - a **Map** view for crypto and ETFs: area by market cap or dollars traded, square-root scale, ETF groups as blocks
> - a **week's line** on heatmap tiles, and a **narrower grey band** on the colour scale (forex stays at ±0.1%)
> - the warning as **one slim line** above the page instead of a card over the header
> - **phones:** the market switch and a ⚙ View button instead of rows of controls, so the first tiles start in the top third of the screen
> - **rates:** cards lead with the yield; real yield, inflation and the risk rank move to the popup (a card keeps only High risk or a negative real yield); a column chart of every 10-year yield, highest first
> - **predictions:** Today, Since your last visit and Just decided in one row of small cards, so the board starts in the top half of a laptop screen; question text at full strength on pale tiles
> Add browser tests for each, and check light and dark mode on a laptop and a phone before merging.

### 27. The next click
> Critique the site again, past the first screen (the coin card, the table, the scorecard, phones), then:
> - open the coin card with a line in words built from its readings, and add a **year range** bar (named by the history there is: "9-month range" for crypto), a range row on detailed tiles and a "From high" table column
> - stop the chart's stop labels overprinting the price scale
> - add **search** (and the `/` key) and a **☆ watchlist** pinned to the top of the grid, saved per market in the browser
> - hide the price controls in the Scorecard view
> - draw the **last copy** the browser saw at once on a repeat visit, clearly marked, then swap in the fresh file
> - table: shorter headers, a week line per row, the symbol column sticky; outline flat market-switch figures for dark mode; link energy's summary to its weekly tables
> Test each in the browser, and check the phone's ⚙ View panel fits its screen.

### 28. Yes/no that can't be misread
> On prediction tiles, "Almost certain · No, it won't · 92%" is confusing: which answer is winning? Make a yes/no answer a statement of what the market expects with a ✓ / ✗ mark ("Market expects · ✗ No, it won't happen"), label the number as a chance ("92% chance"), and add a bar with both sides named ("Yes 8% · No 92%", the likelier bold). Say "Too close to call · leaning" under 60%. Use the short form ("✗ Won't happen 92%") on small tiles and one-line places, and the same wording on the static question pages. Make the Yes side of the bar 3px thicker than the No side, and keep decided questions as results ("✓ Yes" / "✗ No").

### 29. Folder tabs for the markets
> Make the market switch bigger and eye-catching, like folder tabs, so it's obvious each one opens a new page: a row of its own above the controls, the open tab raised in the panel's colour with a flame strip on top and joined to the panel below, the others lifting on hover, each with its headline figure. Rates and predictions show the tabs on a shelf line; phones scroll them sideways and move ⚙ View beside the colour key. Keep the first tiles in the top 40% of a 13-inch laptop screen and the top third of a phone. Fill each tab with a lighter shade of its figure's colour and outline it 2px in a darker shade; the open tab keeps the panel's colour.

### 30. Status checks (repeat as needed)
> Status check on heat.sala.company: scheduled and manual runs over the last 24 hours, refresh gaps, data age, the latest scorecard and tuner decision, failures, and anything to sync to GitHub.

---

## Tips for a smooth rebuild
- Ask for **real-data checks before publishing** at each step. Several bugs only showed up against live data: the Toncoin rename, the biased "good exit" measurement, blank tuner scores, and sources that refuse GitHub's servers (check a new source from a GitHub runner before building on it).
- If you work from a machine without Node, ask Claude to run the tests in the browser.
- For a visual change, ask for screenshots of the local preview on a laptop and a phone, light and dark, before it goes live: a Claude cloud session can't open the live site.
- Keep API tokens and passwords out of chat completely. Share only status codes, like "204".

# 🔥 heat.sala.company

A crypto heatmap of the top 50 coins by market cap. Every tile combines:

- **Heat color**: 24h, 7d or 30d price change. Falling gets darker and gloomier red, down to near-black. Near flat is white. Rising goes from whitish blue through bright blue to a rich sea blue.
- **🚀 / 😢 next to the name**: one 🚀 each for a strong uptrend, oversold RSI, and a tight Bollinger band (bottom 10%). One 😢 each for the opposites: strong downtrend, overbought RSI, and a wide band.
- **RSI (14)**: a gauge from 0 to 100. Below 30 is tagged *Oversold* and above 70 *Overbought*.
- **Trend**: 50-day MA vs 200-day MA (up or down), plus whether price agrees (*strong*) or not (*pullback* / *bounce*). A ✦ marks a golden or death cross in the last 14 days.
- **Bollinger Band width (20, 2)**: the current width ranked against the last 180 days. Bottom 25% is a *Squeeze*, meaning volatility is compressed and a big move often follows.

Hover a tile (or tap it on a phone) to see a 120-day chart with price, both MAs, the Bollinger band and RSI.

**Prices are not real-time.** They refresh every 10 minutes, and a banner at the top shows when the last refresh happened.

## How it works

```
GitHub Actions (every 10 min)                    Visitors
  scripts/build-data.mjs                            index.html
    ├─ rankings: CoinGecko → CoinLore → last copy     └─ reads data.json only
    ├─ daily candles: Binance → Gate.io → OKX            (no API calls, no rate limits)
    │    → MEXC → KuCoin → CoinGecko
    └─ writes data.json ──► deployed to GitHub Pages with index.html
```

- The workflow (`.github/workflows/update-data.yml`) deploys straight to Pages, so it doesn't add a commit every 10 minutes. Once every ~50 days it makes one small commit, because GitHub switches off scheduled workflows in repos with no activity for 60 days.
- Each run reuses the previous `data.json`. Candles are refetched hourly (every 6 h for coins whose candles come from CoinGecko). In between, the page updates today's candle with the latest price.
- If `data.json` is missing or more than 45 minutes old, the page falls back to fetching live in the browser. That path has its own rate limiter, which caps requests per API (shared across tabs), backs off after a block, and uses a countdown to decide when it may refresh.

## Scorecard and self-tuning

All three parts use the same signal engine (`signals.mjs`): the page, the daily scorer and the weekly tuner. So the 🚀 / 😢 on the site are exactly what gets scored.

- **Daily, 00:20 UTC** (`.github/workflows/score-signals.yml` → `scripts/score.mjs`): takes today's top 50 and fetches about 1,000 days of daily candles. It then checks the signals at every close against the next day's move, both raw and against the average of all 50 coins, and writes `data/scorecard.json`. The **Scorecard** tab on the site shows yesterday's calls, the track record over 30 days, 90 days and all history, and how each signal did on its own.
- **Weekly, Sundays**: the tuner tries RSI periods and levels, moving-average pairs, and Bollinger thresholds. For each signal it decides whether it should count as a 🚀, a 😢, or be switched off. It tunes on the older 70% of the history and checks on the newest 30%, which it never saw. New settings go into `params.json` **only if they score better on that unseen 30%**. Every change is logged on the Scorecard.
- To run it by hand, go to **Actions → Score signals → Run workflow**, and tick "Run the tuner now" to tune immediately.

## Setup

1. Push to a GitHub repo (public repos get free Actions minutes).
2. Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Go to **Actions → Update heatmap data → Run workflow** once. After that it runs by itself every 10 minutes.
4. Custom domain: in **Settings → Pages → Custom domain**, enter `heat.sala.company`. At the DNS provider for `sala.company`, add a `CNAME` record from `heat` to `<github-user>.github.io`. Turn on **Enforce HTTPS** once the certificate is issued.

To build the data locally: `node scripts/build-data.mjs data.json`

*Not financial advice.*

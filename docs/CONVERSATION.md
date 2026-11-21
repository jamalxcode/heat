# The conversation, 12–16 Nov 2026

A plain record of the Claude Code session that started this round of improvements: what was asked, what was done, and where it's written up. The prompts to rebuild it all are in [`rebuild-prompts.md`](rebuild-prompts.md) (26–29); the reasons in [`DECISIONS.md`](DECISIONS.md) (27–52).

## 1. Getting started (12 Nov)

- **"Read up on heat.sala.company from its GitHub; we'll improve it from here."** The repo was attached to the session, cloned, read (README, CLAUDE.md, DECISIONS, tests) and summarised; all unit tests passed.
- **The session had opened on a different repository**, whose name kept coming up; from then on the work stayed in this repo only. Ordinary words that resembled that name were reworded to plain ones (decision 27, lesson "Know which repo").
- **"Update all design decisions, convo and readme."** The decisions doc grew from prediction markets only to the whole site (12–29), the rebuild prompts from 12 to 26, the README intro listed every page.

## 2. First critique: "how can it be made more visually useful and immediate?" (13 Nov)

Screenshots of the local preview showed the data was there but the reader had to work out the story; on a phone the controls filled most of the first screen and the warning covered the header. Nine changes, all built ("do it all"): a headline above the tiles, each market's figure on the market switch, a Map view, a week's line on tiles, a narrower grey band, the warning as a slim line, a compact phone header, yield-first rate cards with a bar chart, and one news strip on predictions. Decisions 30–38, prompt 26.

## 3. Second critique: "what else can be improved?" (13 Nov)

Past the first screen: the coin card led with numbers, its labels overprinted, there was no search or watchlist on price pages, the scorecard kept the price controls, the first view waited for data. Nine more changes ("do it all"): the card in words, fixed labels, search (`/`), a year range, ☆ watchlist, scorecard without controls, instant repeat visits, a tidier table, small fixes. Decisions 40–46, prompt 27.

## 4. "Which answer is winning?" (13 Nov)

From a live tile ("Putin out as President of Russia by June 30, 2027? · Almost certain · No, it won't · 92%"): five suggestions offered; **1, 3 and 5 combined**: the answer as a statement with ✓/✗, the number labelled "chance", and a Yes/No bar. Then **the Yes side of the bar 3px thicker**. A decided question now reads as a result. Decisions 47–49, prompt 28.

## 5. Folder tabs (13–16 Nov)

- **"Make the market line bigger, eye-catching, like folder tabs."** The switch became a row of tabs, the open one joined to the panel (decision 50); the laptop first-tile limit moved to 40% because of the extra row.
- **"Fill each tab with its percentage's colour, a bit lighter, and a thicker outline; confirm before coding."** Confirmed first, then built: lighter fills, 2px outlines, the open tab kept in the panel's colour (decision 51).
- The way visual changes are agreed (screenshot → options → confirm → build → check) became decision 52.

## 6. Writing it down (16 Nov)

**"Save to the repo design ideas, lessons learned, the conversation, business rules and interface rules"**, and **"update the README to reflect the latest updates; make it a fun read"**: this file, [`DESIGN-IDEAS.md`](DESIGN-IDEAS.md), [`LESSONS.md`](LESSONS.md), [`BUSINESS-RULES.md`](BUSINESS-RULES.md), [`INTERFACE-RULES.md`](INTERFACE-RULES.md), and a rewritten README opening.

## 7. Sharing (19 Nov)

**"Add a share function to send cards to WhatsApp, email, etc., e.g. an interesting prediction market card or a price."** Every card got ↗ Share: the phone's share sheet (with the card as a picture), WhatsApp, Telegram, X, email, Copy text and Save image. The browser test caught a real bug: saving the picture closed the card. Decision 54, prompt 31.

Then **"show the question asked followed by the link, not just a url, so it's cleaner in WhatsApp; the same for crypto, bonds; and explain what the link is about"**: every message and each card's 🔗 Copy link now lead with the question or name, then the answer, then "👉 Live odds from every venue, updated every 10 min: link" (or the coin's / bond market's version), and the share sheet gets it all as one text so WhatsApp keeps the question. Decision 55.

## 8. Bigger prices (21 Nov)

**"On a tile the percentage change is bigger than the price; show the price 2 points bigger, keep the change large."** On detailed tiles the price is now 18px bold against the change's 16px (16.5 and 14.5px on phones); heatmap tiles keep theirs. Decision 56.

## How the session worked

- Every change went to the session's `claude/...` branch, through unit and browser tests on GitHub, then to `main` (which deploys live).
- The live site couldn't be opened from the session, so every visual change was checked in the local preview with test data, laptop and phone, light and dark, and screenshots were shared before merging.
- Each change updated the README, the decisions and the rebuild prompts in the same commit.

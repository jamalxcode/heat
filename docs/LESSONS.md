# Lessons learned

Things that went wrong, or nearly did, and what we do now because of them. Newest at the end; add to it when something surprises you.

## From building the site (Sep–Nov 2026)

- **Real data finds bugs test data can't.** The Toncoin rename, the biased "good exit" measurement and blank tuner scores only showed up against live data. Check a new feature against real data before calling it done.
- **Check a new source from a GitHub runner first.** Morocco's central bank and others refuse cloud servers; a source that works from your laptop may not work from Actions.
- **A missing file in the deploy breaks every page.** One script the page imported wasn't copied into the site; now `tests/deploy.test.mjs` checks every import is published.
- **A green job can hide stale data.** Builders republish the last file on failure, so the job "succeeds"; the hourly freshness check exists because nobody noticed a prediction build staying stale.
- **GitHub's schedules are unreliable** (about 1 run in 15); cron-job.org starts the runs.

## From the Nov 2026 improvement rounds

- **Know which repo the session is about.** The session opened on another repository, and its name kept appearing in the conversation and confused things. Name the repo you're working in, and keep other projects' names out of this one.
- **An ordinary word can look like a reference.** Words that resembled another project's name were reworded to plain ones (decision 27).
- **An average lies when one value is wild.** One currency's +15% devaluation dragged the forex "average" more than the other 47 together; the headline uses the median off crypto (decision 30).
- **Every guard you loosen should be loosened on purpose.** The bigger market tabs pushed the laptop's first tiles past the "top third" test; the limit moved to 40%, said up front and written down (decision 50), instead of quietly shrinking what was asked for.
- **Change one market, test them all.** Narrowing the colour band for every market by accident changed forex, which was already right; a forex test caught it.
- **A refactor can drop a state.** Hiding the heatmap class outside the grid also hid it in the table view; a link test caught it. Run the whole browser suite after any UI change, not just the new tests.
- **Test the phone panel open, not just closed.** The ⚙ View panel ran off the screen once search was added; the page itself didn't scroll sideways, so the "no sideways scroll" test passed. There's now a test that nothing in the open panel passes its edge.
- **Check wording on every tile size.** "✗ No, it won't happen" was cut to "won't hap…" on small tiles; they use the short form (decision 49).
- **A forecast's words on a settled question read wrong.** "✓ Yes, it will happen" on a decided question; decided ones now say "✓ Yes" (decision 48).
- **Labels collide when values meet.** A stop at the price overprinted the price scale; the stops now win the space (decision 45).
- **Say which side won.** "Almost certain · No, it won't · 92%" was misread: the verdict described the No side. Statement, labelled chance, a bar naming both sides (decision 47).
- **A cached first draw changes the timing.** Drawing last visit's copy made the fresh file look "not new", so the page polled every 2 minutes; the copy now counts as new for scheduling.
- **Quote characters break test files.** A straight apostrophe inside a single-quoted test title made Playwright find no tests at all; use ’ in titles.

## Working in a Claude cloud session

- **The live site, the deploy's files and some APIs are unreachable** from the session; use the local preview with test data, and say clearly what still needs a look on the live site (decision 39).
- **Install the test runner at the preinstalled Playwright's version** (`npm install --no-save @playwright/test@<version>`), or it can't find the browser.
- **Don't force-push when a normal push will do.** The branch was built on the latest `main`; a fast-forward push was enough, and the force flag was refused.
- **Retry GitHub's temporary errors, and stop the waiting loop when a step fails.** A 503 on fetch skipped the push but the CI-wait loop kept polling for runs that would never come.
- **Pull before pushing:** the scorer commits to `main` every day.
- **A hidden click still bubbles.** The "Save image" download was a click on a hidden link; it bubbled to the page's "click outside closes the card" handler and closed the card. Dispatch such clicks without bubbling, and test that the card stays open.
- **Share sheets keep what they like best.** Given a `url` or a file along with the text, WhatsApp (and others) sent only the link or the picture, without the question. Put the whole message in `text`, the link included, and give nothing else.

import { SupportButton } from "./components/SupportButton";
import type { Usage } from "./api";

type Props = {
  usage: Usage | null;
};

export function GuidePage({ usage }: Props) {
  const budget = usage?.budget;
  const support = usage?.support;

  return (
    <div className="guide-page">
      <header className="profile-hero">
        <h2>User guide</h2>
        <p className="subtitle">
          How to use Market Specialist — Home, Research, Holdings, alerts, and Claude
          deep-dives.
        </p>
      </header>

      <nav className="guide-toc insight-card" aria-label="Guide sections">
        <a href="#guide-overview">Overview</a>
        <a href="#guide-home">Home</a>
        <a href="#guide-research">Research</a>
        <a href="#guide-holdings">Holdings</a>
        <a href="#guide-profile">Profile</a>
        <a href="#guide-claude">Claude &amp; budget</a>
        <a href="#guide-tips">Tip jar</a>
      </nav>

      <section id="guide-overview" className="insight-card guide-section">
        <h3>Overview</h3>
        <p>
          Market Specialist answers <em>“is this a good time to buy?”</em> in plain English.
          It’s invite-only: each person has their own watchlist, holdings, alerts, and
          settings. Shared market snapshots (macro, scanner, analyst) are the same for
          everyone on this server.
        </p>
        <ul>
          <li>
            <strong>Home</strong> — market conditions, top-ranked names, market videos, and a
            peek at your holdings.
          </li>
          <li>
            <strong>Research</strong> — type a ticker, get a verdict, manage your watchlist and
            price alerts.
          </li>
          <li>
            <strong>Holdings</strong> — import brokerage CSVs and see gain/loss and
            concentration.
          </li>
          <li>
            <strong>Profile</strong> — alert email, password, Claude usage, and account
            deletion.
          </li>
        </ul>
        <p>
          Use <strong>Hide $</strong> in the nav to blur dollar amounts on screen (handy when
          sharing your display). Open <code>?check=AAPL</code> to jump straight into Research
          for that symbol.
        </p>
        <p>
          <strong>Ticker tape (footer marquee)</strong> — always shows major indexes, then
          your watchlist (★), then up to 20 top-ranked scanner names. Names you’ve recently
          checked in Research but <em>haven’t</em> added to the watchlist are left off the
          marquee so one-off lookups don’t clutter it. Tap a symbol to open it on Yahoo
          Finance; use the %/$ control to match the rest of the app.
        </p>
      </section>

      <section id="guide-home" className="insight-card guide-section">
        <h3>Home</h3>
        <p>
          Nothing heavy is computed when you open the page. Jobs refresh snapshots on a
          schedule; Home reads the latest cache and shows how fresh it is.
        </p>
        <ul>
          <li>
            <strong>Market conditions</strong> — six macro signals roll into a score and a
            zone: FULL DEPLOY, REDUCED, or DEFENSIVE. That zone gates how aggressive the
            scanner list is.
          </li>
          <li>
            <strong>Top-ranked stocks</strong> — quant ranking across a large US universe,
            optionally blended with Claude fundamentals. The list shows every current
            candidate (same count as Candidates). Tap a name to open it in Research.
          </li>
          <li>
            <strong>Quant vs analyst disagreements</strong> — when Claude fundamentals are
            blended in, names whose blended rank moves 3+ spots vs pure momentum are flagged
            as upgrades or downgrades. An upgrade means the business looks stronger than the
            chart alone; a downgrade means momentum may be ahead of fundamentals. Treat them
            as a second look, not an automatic trade.
          </li>
          <li>
            <strong>Risk tolerance</strong> (Conservative / Balanced / Aggressive) — changes
            how much rankings lean on fundamentals vs momentum, and (when there’s no Claude
            buy zone) how wide the suggested buy zone is.
          </li>
          <li>
            <strong>Market videos</strong> — YouTube clips from sources you can add or remove
            (managed on Home).
          </li>
        </ul>
        <p className="muted">
          Manual “Refresh” on market cards is admin-only so friends don’t accidentally burn
          API quota.
        </p>
      </section>

      <section id="guide-research" className="insight-card guide-section">
        <h3>Research</h3>
        <p>
          Enter a ticker (use hyphens for share classes, e.g. <code>BRK-B</code>). You’ll get:
        </p>
        <ul>
          <li>Live price and day change (toggle % / $)</li>
          <li>
            A plain-English verdict and confidence meter (e.g. “Good time to buy”, “Wait for
            a dip”)
          </li>
          <li>At-a-glance Timing / Quality / Price</li>
          <li>
            “Why this call?” — in its favor, watch outs, and a plan. Expand details for the
            chart, buy zone, and technicals.
          </li>
        </ul>
        <p>
          <strong>Watchlist</strong> — star a name or add chips under the search box.{" "}
          <strong>Watching to buy</strong> surfaces watched names with their latest verdict
          and can notify the day one first becomes “Good time to buy.”
        </p>
        <p>
          <strong>Your alerts</strong> — set a buy-zone style price alert from the answer
          card; emails go to the address on your Profile (if email is configured on the
          server).
        </p>
        <p>
          <strong>Track record</strong> — how past verdicts scored, at the bottom of Research.
        </p>
        <p>
          Tap ⓘ anywhere for plain-language definitions. Recents reopen a prior check from
          cache when possible so you don’t burn a new Claude call.
        </p>
      </section>

      <section id="guide-holdings" className="insight-card guide-section">
        <h3>Holdings</h3>
        <p>
          Import a CSV from your broker (columns vary; the empty state shows the expected
          format and a sample download). You’ll see positions, gain/loss, concentration, and
          sector mix. Share counts and cost basis are encrypted at rest for your account.
        </p>
        <p>
          Holdings are private to you — other people on this server cannot see your
          portfolio. Admins also cannot browse friends’ holdings from the app.
        </p>
      </section>

      <section id="guide-profile" className="insight-card guide-section">
        <h3>Profile</h3>
        <ul>
          <li>
            <strong>Alert email</strong> — where buy-zone emails are sent (optional).
          </li>
          <li>
            <strong>Password</strong> — change anytime; you’ll need the current password.
          </li>
          <li>
            <strong>Claude usage</strong> — your attributed deep-dive spend (today and this
            month), plus the shared daily budget for the whole site.
          </li>
          <li>
            <strong>Delete account</strong> — permanently removes your personal data from
            this server. Shared market data stays.
          </li>
        </ul>
        <p>
          New accounts need an invite link from an admin. Admins use <strong>Invite</strong>{" "}
          in the nav to copy a link (Cloudflare Access may also need your email allowlisted).
        </p>
      </section>

      <section id="guide-claude" className="insight-card guide-section">
        <h3>Claude deep-dives &amp; daily budget</h3>
        <p>
          When Claude is configured, Research can add a fundamental deep-dive (bull/bear,
          quality score, buy zone). Cached deep-dives reuse the same quarter so repeats are
          cheap. <strong>Fresh deep-dive</strong> forces a live call.
        </p>
        {budget ? (
          <div className="guide-budget">
            <p>
              This server caps site-wide Claude spend at{" "}
              <strong>${budget.dailyUsd.toFixed(2)}</strong> per UTC day. Today’s site usage:{" "}
              <strong>${Number(budget.siteTodayCost).toFixed(2)}</strong>.
            </p>
            {budget.deepAllowed ? (
              <p className="guide-budget-ok">Deep-dives are available right now.</p>
            ) : (
              <p className="guide-budget-hit">
                Daily budget reached — new deep-dives are paused until tomorrow (UTC). Checks
                still work with the numbers-only verdict.
              </p>
            )}
          </div>
        ) : (
          <p className="muted">Budget details load from Profile usage when available.</p>
        )}
        <p>
          You can still run checks over budget; you just won’t get a new Claude write-up
          until the counter resets.
        </p>
      </section>

      <section id="guide-tips" className="insight-card guide-section">
        <h3>Tip jar (LLM costs)</h3>
        <p>
          The app is free for invited friends. Each Claude answer costs a little real money.
          Tips are optional and never unlock features — they just help keep deep-dives
          funded when the shared daily budget runs out.
        </p>
        {support?.url ? (
          <div className="guide-tip-row">
            <SupportButton
              url={support.url}
              label={support.label}
              tooltip={support.tooltip}
            />
            <span className="muted">Opens Ko-fi in a new tab · one-off unless you choose otherwise</span>
          </div>
        ) : (
          <p className="muted">Tip jar URL isn’t configured on this server.</p>
        )}
      </section>
    </div>
  );
}

/**
 * The public homepage — what an anonymous visitor gets at `/`.
 *
 * This is the only page on the deployment addressed to somebody who has never
 * run the CLI, so it is the one place the product has to explain itself rather
 * than assume. It carries no client JavaScript and fetches nothing, like every
 * other hand-written page here: the document is the whole payload.
 *
 * Its skin is not the app's. The visual language — warm off-black ground,
 * copper for the live thing and verdigris for the settled one, mono headings
 * against serif prose — is the one the sibling product established
 * (agentgit.zabaca.com, in zbc's walgit template), so the two read as one
 * house. The webfonts are the deliberate omission: see the note in `layout.ts`.
 *
 * Every claim on it is checkable against the code. The free allowance is read
 * from the same configuration the cap enforces rather than typed in as prose,
 * so a deployment that raises the cap cannot end up with a homepage that lies
 * about it.
 */
import { html, raw, type Html } from "./html.js";

/** A command, shown the way a terminal shows it. */
function shell(lines: ReadonlyArray<{ cmd?: string; out?: Html | string }>): Html {
  const rows = lines.map((l) =>
    l.cmd
      ? html`<div class="land-cmd"><span class="land-p">$</span> ${l.cmd}</div>`
      : html`<div class="land-out">${l.out}</div>`,
  );
  return html`<div class="land-sh">${rows}</div>`;
}

/** A rule: its name, and what it costs you. */
function rule(k: string, v: Html): Html {
  return html`<li><span class="k">${k}</span><span class="v">${v}</span></li>`;
}

export function landingPage(opts: { observationCap: number }): {
  title: string;
  body: Html;
  bodyClass: string;
} {
  const cap = opts.observationCap;

  const body = html`
    <div class="land">
      <a class="land-skip" href="#start">Skip to the command</a>

      <span class="land-badge">Open source — run your own</span>
      <h1>A problem registry for AI agents<span class="dot">.</span></h1>
      <p class="land-lede">
        Your agent works out what is actually wrong all day, and the reasoning is gone by morning.
        <em>File an observation and the corpus exists</em> — no signup, no invite, no key.
      </p>
      <p class="land-cta">
        <a class="land-btn go" href="#start">See the command</a>
        <a class="land-btn" href="/docs">Docs</a>
        <a class="land-btn" href="/signin">Sign in</a>
      </p>

      <section id="start">
        <div class="land-split">
          <div class="land-split-say">
            <h2>File it<span class="dot">.</span></h2>
            <p>
              One command, mid-conversation, at the moment the thing is noticed. There is no project
              to create first and nothing to fill in:
              <strong>first use mints your Principal</strong>
              and writes it down, so the second command already knows who you are.
            </p>
          </div>
          <div class="land-show">
            ${shell([
              {
                cmd: `crux observation add "handlers spend a third of every\ncall on status-only queries"`,
              },
            ])}
            <p class="land-under">No account · No token · No invite · The corpus is yours</p>
          </div>
        </div>
      </section>

      <section>
        <div class="land-split">
          <div class="land-split-say">
            <h2>Stop re-deriving context<span class="dot">.</span></h2>
            <p>
              Every new conversation restarts cold. You re-explain the constraints, re-derive why
              the obvious fix was rejected, and pay for all of it in context before any work
              happens.
            </p>
            <p>
              <strong>So the agent reloads instead.</strong> Not prose to re-parse — the model,
              shaped the way it was stored.
            </p>
          </div>
          <div class="land-show">
            ${shell([
              { cmd: "crux context" },
              {
                out: raw(
                  'now: <span class="hi">3</span> problems · evidence inlined\n' +
                    'attempts: <span class="hi">2</span> open · 1 dropped, with the reason\n' +
                    "abandoned: 1 · and why we gave up on it",
                ),
              },
            ])}
            <p class="land-under">Open Problems · Evidence · Attempts · The graveyard</p>
          </div>
        </div>
      </section>

      <section>
        <h2>Problems, not tickets<span class="dot">.</span></h2>
        <p>
          Crux keeps the problem and the evidence behind it. It does not keep the work: an Attempt
          is a pointer into whatever tracker you already use, and holds no copy of what is being
          built — <em>because the copy is the thing that rots</em>.
        </p>
        <p>
          What it does keep is the judgement no tracker records. A closed ticket says
          <strong>won't do</strong>. It never says the approach could not handle the load.
        </p>
      </section>

      <section>
        <h2>The rules<span class="dot">.</span></h2>
        <ul class="land-rules">
          ${rule(
            "Never deleted",
            html`<b>An Observation is archived with a rationale, never removed.</b> The origin trail
              is permanent, so a corrected mistake still shows what was believed at the time.`,
          )}
          ${rule(
            "No silent closure",
            html`<b>A Problem leaves the board only through a door that demands a reason.</b> An
              Outcome, or an Abandonment. There is no way to quietly close one.`,
          )}
          ${rule(
            `${cap} free`,
            html`<b>An unclaimed Principal files ${cap} Observations.</b> Then writes pause and
              reads keep working — <code>crux context</code> never stops. Claim it with an email to
              carry on.`,
          )}
          ${rule(
            "Yours alone",
            html`<b>Every read is scoped to the Principal that asked.</b> Two Principals on one
              deployment see nothing of each other.`,
          )}
        </ul>
      </section>

      <section>
        <h2>On the way<span class="dot">.</span></h2>
        <p>What is missing, in the order it unblocks itself. Nothing here is a date.</p>
        <ul class="land-road">
          <li>
            <span class="k">Unblocked, unplanned</span>
            <span class="t">Sharing</span>
            <span class="d">
              A corpus belongs to one Principal, and claiming links the Principals one person owns.
              Handing a Workstream to somebody else is the next thing, and nothing blocks it.
            </span>
          </li>
          <li>
            <span class="k">Under design</span>
            <span class="t">What claiming unlocks</span>
            <span class="d">
              The allowance exists to create the claim moment, not to price what follows it. What a
              claimed corpus is allowed is deliberately unresolved.
            </span>
          </li>
          <li>
            <span class="k">Considered, deferred</span>
            <span class="t">Merging Problems</span>
            <span class="d">
              Two Problems that turn out to be one should become one. Search came first: the cheaper
              fix is finding the Problem before filing its twin.
            </span>
          </li>
        </ul>
      </section>

      <footer class="land-foot">
        <p class="plain">
          A Principal is a token, not a person. It lives on the machine that minted it — claiming an
          address is what makes the corpus reachable from anywhere else.
        </p>
        <p>Crux · Open source · Run your own: <code>zbc add crux</code></p>
      </footer>
    </div>
  `;

  return { title: "A problem registry for AI agents", body, bodyClass: "land-page" };
}

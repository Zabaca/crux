/**
 * The public homepage — what an anonymous visitor gets at `/`.
 *
 * This is the only page on the deployment addressed to somebody who has never
 * run the CLI, so it is the one place the product has to explain itself rather
 * than assume. It carries no client JavaScript and fetches no images, like
 * every other hand-written page here: the document is the whole payload.
 *
 * Every claim on it is checkable against the code, deliberately. The free
 * allowance is read from the same configuration the cap enforces rather than
 * typed in as prose, so a deployment that raises the cap cannot end up with a
 * homepage that lies about it.
 */
import { html, type Html } from "./html.js";

/** One command, shown the way a terminal shows it. */
function shell(lines: ReadonlyArray<{ cmd?: string; out?: string }>): Html {
  const rows = lines.map((l) =>
    l.cmd
      ? html`<div class="land-cmd"><span class="land-p">$</span> ${l.cmd}</div>`
      : html`<div class="land-out">${l.out}</div>`,
  );
  return html`<div class="land-sh mono">${rows}</div>`;
}

export function landingPage(opts: { observationCap: number }): { title: string; body: Html } {
  const cap = opts.observationCap;

  const body = html`
    <section class="land-hero">
      <h1 class="land-h1">A problem registry for AI agents.</h1>
      <p class="land-lede">
        Your agent works out what is actually wrong all day, and the reasoning is gone by morning.
        <b>File an observation and the corpus exists</b> — no signup, no invite, no key.
      </p>
      <p class="land-cta">
        <a class="btn" href="/docs">Read the docs</a>
        <a class="btn plain" href="/signin">Sign in</a>
      </p>
    </section>

    <section class="land-sec">
      <h2>File it</h2>
      ${shell([
        {
          cmd: `crux observation add "handlers spend a third of every call on status-only queries"`,
        },
      ])}
      <p class="land-note">
        No account · No token · No invite · First use mints your Principal and remembers it
      </p>
    </section>

    <section class="land-sec">
      <h2>Stop re-deriving context</h2>
      <p class="land-body">
        Every new conversation restarts cold. You re-explain the constraints, re-derive why the
        obvious fix was rejected, and pay for all of it in context before any work happens.
      </p>
      ${shell([{ cmd: "crux context" }])}
      <p class="land-note">
        Open Problems, their Evidence with the Observations inlined, their Attempts, and what was
        abandoned — with the reason it was abandoned.
      </p>
    </section>

    <section class="land-sec">
      <h2>Problems, not tickets</h2>
      <p class="land-body">
        Crux keeps the problem and the evidence behind it. It does not keep the work: an Attempt is
        a pointer into whatever tracker you already use, and holds no copy of what is being built —
        because the copy is the thing that rots. What it does keep is the judgement no tracker
        records: why an approach was dropped.
      </p>
    </section>

    <section class="land-sec">
      <h2>The rules</h2>
      <ul class="land-rules">
        <li>
          <b>Never deleted.</b> An Observation is archived with a rationale, never removed. The
          origin trail stays intact.
        </li>
        <li>
          <b>No silent closure.</b> A Problem leaves the board only through a door that demands a
          reason — an Outcome, or an Abandonment.
        </li>
        <li>
          <b>${cap} Observations free.</b> Then writes pause and reads keep working. Claim it with
          an email to carry on.
        </li>
        <li><b>Yours alone.</b> Every read is scoped to the Principal that asked for it.</li>
      </ul>
    </section>

    <section class="land-sec">
      <h2>On the way</h2>
      <ul class="land-next">
        <li><span class="land-tag">Unblocked, unplanned</span> Sharing a corpus with a teammate</li>
        <li>
          <span class="land-tag">Under design</span> What claiming unlocks — pricing is deliberately
          unresolved
        </li>
        <li><span class="land-tag">Considered, deferred</span> Merging near-duplicate Problems</li>
      </ul>
    </section>

    <footer class="land-foot">
      <p>Open source. Run your own: <code class="mono">zbc add crux</code></p>
      <p class="land-note">
        A Principal is a token, not a person. It lives on the machine that minted it — claiming an
        address is what makes the corpus reachable from anywhere else.
      </p>
    </footer>
  `;

  return { title: "A problem registry for AI agents", body };
}

/**
 * The two plain-text documents, which are the ones an agent actually reads.
 *
 * Crux is operated by agents. The HTML page exists because a person
 * occasionally lands on the host in a browser, but it is not the product
 * surface — these are. So the negotiation defaults the other way from a normal
 * site: a client that did not ask for HTML gets text, because anything
 * automated is the expected caller here and a wall of markup is the wrong
 * answer to it.
 *
 * Two documents for one audience, and the difference is *when* they are read
 * rather than who reads them — the distinction walgit draws, and it holds:
 *
 *   GET /          is read IN BAND. An agent hits it because a command refused
 *                  or because it is orienting mid-task, and every line costs
 *                  context it wanted to spend on the task. It stays terse.
 *   GET /llms.txt  is read DELIBERATELY, by an agent that went looking for the
 *                  manual. Length is close to free, so the worked examples and
 *                  the reasoning live there.
 *
 * The rule that stops them becoming two versions of the truth: every enforced
 * limit is rendered from the configuration the enforcement reads, never written
 * as prose. A cap this deployment does not enforce cannot appear in either
 * document, because neither has a constant to state it with.
 *
 * Every command below has been run against a live deployment. Writing one from
 * memory is how the HTML page ended up shipping `observation add "…"`, which is
 * not a real command — the flag is `--content`.
 */
import { observationCapFrom } from "@crux/core/auth/capacity";

export interface AgentTextEnv {
  CRUX_OBSERVATION_CAP?: string;
  CRUX_CLAIM_URL?: string;
}

/** GET or HEAD only, and only these two paths. */
function readable(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/**
 * Does this caller want the page rather than the text?
 *
 * Only an explicit `text/html` counts. A browser always sends it; `curl`,
 * `fetch` and every agent harness do not, so the negotiation cannot misfire on
 * a person — and a client that asks for neither keeps the text, which is the
 * safer default for anything automated.
 */
export function wantsHtml(accept: string | null): boolean {
  return (accept ?? "").toLowerCase().includes("text/html");
}

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Both documents are derived from configuration, not from the corpus, so
      // they are the same for everybody and safe to sit in a shared cache.
      "cache-control": "public, max-age=300",
    },
  });
}

/** The in-band document. Terse on purpose — see the note at the top. */
export function renderIndex(origin: string, env: AgentTextEnv): string {
  const cap = observationCapFrom(env.CRUX_OBSERVATION_CAP);
  return `# crux — a problem registry for AI agents

You are reading the plain-text version because you did not ask for HTML.
This is the short one. The manual is at ${origin}/llms.txt

WHAT IT IS
  You notice things all day and the reasoning is gone by morning. Crux is
  where the reasoning goes: raw signals (Observations), the ones that turn
  out to matter (Evidence) and what they add up to (Problems). It does not
  hold the work — an Attempt is a pointer into whatever tracker does.

GET IT
  /plugin marketplace add Zabaca/crux
  /plugin install crux

FILE SOMETHING
  crux workstream add --slug <slug> --title "<title>"
  crux observation add --content "<what you noticed>"

RELOAD IT INTO A FRESH SESSION
  crux workstream select <slug>    # every command below reads this
  crux problem list --status now   # the active Problems, one line each
  crux problem show <id>           # drill into the two or three that matter
  crux observation list --unlinked # intake nobody has synthesized yet

BEFORE YOU FILE A PROBLEM
  crux search "<a few distinctive words>"
  Attach an Observation to the Problem you find. Do not file its twin.

IDENTITY
  Your first command mints a Principal and writes its token to
  $CRUX_HOME/config.toml (default ~/.claude/.crux/config.toml). No signup,
  no invite. That token is the only key to what you file: the deployment
  stores a hash and cannot reissue it.

THE WALL
  ${cap} Observations, then writes refuse with CAPACITY_EXCEEDED (exit 27)
  and the refusal carries a claim URL. Reads never stop. To lift it, a human
  has to run this on the machine holding the token:
      crux claim <their-email>
  and open the link that is mailed to them.

WHEN A COMMAND REFUSES
  The exit code is the answer, not the prose. 20 illegal transition,
  21 invariant, 23 not found, 24 validation, 25 not allowed here,
  26 unauthenticated, 27 allowance spent.
`;
}

/** The manual. Read deliberately, so length is close to free. */
export function renderLlms(origin: string, env: AgentTextEnv): string {
  const cap = observationCapFrom(env.CRUX_OBSERVATION_CAP);
  const claimUrl = env.CRUX_CLAIM_URL || `${origin}/claim`;
  return `# crux

> A problem registry for AI agents. You file what you notice; it keeps the
> reasoning so the next session starts warm instead of cold.

Host: ${origin}
Short version: ${origin}/

## What it holds

- **Workstream** — one area of focus. Everything belongs to exactly one.
- **Observation** — a raw signal. Cheap to file, never deleted. A mistake is
  archived with a rationale, so the origin trail survives being wrong.
- **Evidence** — the link from an Observation to a Problem, with the reason.
  An Observation is not Evidence until something says why it matters.
- **Problem** — what the signals add up to. The durable artifact.
- **Attempt** — a pointer to work happening in another tracker: a ref, a
  label, and open/shipped/dropped. It holds no copy of the work, because the
  copy is what rots. When you close one, say why in the closing note — that
  judgement is the thing no tracker keeps.
- **Outcome** — what became of a Problem. Recording one is what marks it done.
- **Abandonment** — giving up, with the reason.

## Getting it

    /plugin marketplace add Zabaca/crux
    /plugin install crux

Requires Bun. The first command you run mints a Principal against
${origin} and writes the token to $CRUX_HOME/config.toml — there is no
signup step and nothing to configure. Point it somewhere else with
\`crux init --url <deployment> --token <token>\`.

## The commands, verbatim

    crux workstream add --slug crux --title "Crux"
    crux workstream list
    crux workstream select crux

    crux observation add --content "handlers spend a third of every call on status"
    crux observation add --content "..." --source "where you saw it" \\
        --source-type internal --tag cli,performance

    crux search "status only queries"

    crux problem list
    crux problem list --status now
    crux problem show 42
    crux evidence list 42
    crux attempt list 42

    crux observation list --unlinked

    crux claim you@example.com

Pass \`--tag\` **comma-separated**. The repeatable form silently keeps only the
last value.

\`--source-type\` is one of: internal, competitive, external, analysis,
customer_report, metric_signal.

## Identity, and why it matters to you

Your first request mints a Principal — a token, not a person. It owns
everything you file through it, and every read is scoped to it, so two
Principals on this deployment see nothing of each other.

The deployment stores only a hash of that token. It cannot reissue it. If the
config file is lost and the Principal was never claimed, what you filed is
unreachable by anyone, permanently. Claiming is what makes it recoverable, not
just what lifts the cap.

## The wall, and how a human gets past it

An unclaimed Principal may file ${cap} Observations. After that every corpus
**write** refuses:

    { "error": { "code": "CAPACITY_EXCEEDED", "details": { "claimUrl": "${claimUrl}" } } }

Exit code 27. **Reads are never blocked** — \`crux problem list\` and every other
read keep working, so you can still reload everything already filed.

Lifting it needs a human, and the command must run on the machine holding the
token, because that token is the only thing that knows which Principal is
asking:

    crux claim them@example.com

That mails a one-shot link, good for 15 minutes. When they open it:

- if the address is new, your Principal **becomes** their identity;
- if the address already has one, your Principal is **linked** to it.

Either way nothing you filed is moved or rewritten, and the allowance then
applies to the human across every Principal they own.

## Rules the code enforces, not the docs

- An Observation is archived, never deleted.
- A Problem leaves the board only through a door that demands a reason: an
  Outcome, or an Abandonment. There is no silent close.
- Closing an Attempt as shipped does **not** complete its Problem. Something
  shipping is a fact; the Problem being gone is a judgement somebody makes.
- Search before you synthesize a Problem. A near-twin splits one thing's
  evidence across two rows and nothing merges them back.

## When a command refuses

The exit code is the machine-readable answer:

    20  ILLEGAL_TRANSITION    the state machine says no
    21  INVARIANT_VIOLATION   the corpus rule says no
    22  REFERENTIAL_MISMATCH  those rows do not belong together
    23  NOT_FOUND             no such row, or not yours
    24  VALIDATION_ERROR      bad arguments, or ALREADY_EXISTS
    25  ACTION_NOT_ALLOWED    not legal from the current view
    26  UNAUTHENTICATED       no usable token
    27  CAPACITY_EXCEEDED     allowance spent — claim it

A refusal is never a partial write. The transition either held or nothing
happened.

## One thing to distrust

\`ok: true\` means the row was written, not that everything you sent survived.
Read it back with \`crux problem show <id>\` when it matters.
`;
}

/**
 * The text routes. Returns null when the caller wanted HTML, so the page
 * renderer takes over.
 */
export function agentText(request: Request, url: URL, env: AgentTextEnv): Response | null {
  if (!readable(request.method)) return null;
  if (url.pathname === "/llms.txt") return text(renderLlms(url.origin, env));
  if (url.pathname === "/" && !wantsHtml(request.headers.get("accept"))) {
    return text(renderIndex(url.origin, env));
  }
  return null;
}

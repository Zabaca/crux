/**
 * The read surfaces: Workstream list, Problem and Observation.
 *
 * These are views, not routes. Every one of them is rendered by an Astro page
 * under `astro/pages/`, which wraps it in the shell and hydrates the islands it
 * needs — the action bar, and the subscription that re-reads the page when its
 * Workstream changes. `/w/<slug>` has no function here at all: the roadmap
 * board is markup a React island owns.
 *
 * Every page is server-rendered from `query()` — the same named reads the CLI
 * asks for — so a `--json` shape and the page that displays it can never drift
 * apart, and no page composes SQL of its own. Which rows a page may show is not
 * decided here either: every function takes the `ReadContext` the request
 * resolved — the viewing Principal *and* its scope — and hands it to `query()`,
 * which is the one place the tenancy boundary is applied (ADR-0013). A
 * Workstream the viewer does not own reads as missing, so these pages 404 on it
 * exactly as they do on a slug that never existed.
 */
import { query } from "@crux/core/reads";
import type {
  ObservationDetail,
  ObservationSummary,
  ProblemDetail,
  ReadContext,
  WorkstreamRow,
  WorkstreamSummary,
} from "@crux/core/reads";

import { html, isoDate as date, type Html } from "./html.js";

/** Raised when a slug or id in the URL names nothing — rendered as a 404 page. */
export class PageNotFound extends Error {}

/**
 * `query()` answers `unknown` — one entry point serves every read kind — so a
 * result is narrowed with the types core exports for exactly this purpose.
 * Those types are derived from the reads themselves and asserted there with
 * `satisfies`, so a shape that changes upstream breaks this file's typecheck
 * instead of silently rendering nothing.
 *
 * The `ReadContext` carries the scope the page resolved once, so a page that
 * asks three questions pays for the boundary once rather than three times.
 */
const ask = <T>(read: ReadContext, q: unknown): Promise<T> => query(q, read) as Promise<T>;

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/** A Problem's Stage. `null` is *unscheduled* — filed, not yet on the roadmap. */
const stageOf = (status: string | null): string => status ?? "unscheduled";

const badge = (value: string): Html => html`<span class="badge ${value}">${value}</span>`;

/**
 * An Attempt's `ref` as a link, when it is safe to make one.
 *
 * The ref is corpus text a Member typed, so only `http(s)` becomes an anchor —
 * a `javascript:` href would otherwise be script this page invited in. Anything
 * else (a tracker key like `ENG-412`) renders as plain text; the ref is still
 * printed in full underneath either way.
 */
const trackerLink = (ref: string, label: string): Html =>
  /^https?:\/\//i.test(ref)
    ? html`<a href="${ref}" rel="noreferrer noopener">${label}</a>`
    : html`${label}`;

const crumb = (parts: Array<{ href?: string; label: string }>): Html =>
  html`<div class="crumb">
    ${parts.map(
      (p, i) =>
        html`${i > 0 ? html` / ` : ""}${p.href ? html`<a href="${p.href}">${p.label}</a>` : p.label}`,
    )}
  </div>`;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** `/` — every Workstream this Principal owns. */
export async function workstreamListPage(
  read: ReadContext,
): Promise<{ title: string; body: Html }> {
  const rows = await ask<WorkstreamSummary[]>(read, { kind: "WORKSTREAM_SUMMARIES" });
  const body = html`
    <h1>Workstreams</h1>
    <p class="sub">
      Everything you have filed, and nothing anybody else has — a Workstream belongs to the
      Principal that created it.
    </p>
    ${
      rows.length === 0
        ? html`<div class="empty">No Workstreams yet.</div>`
        : html`<div class="board" style="grid-template-columns:repeat(3,minmax(0,1fr))">
            ${rows.map(
              (w) => html`<a class="pcard" href="/w/${w.slug}">
                <div class="id mono">${w.id}</div>
                <div class="t">${w.title}</div>
                <div class="mm"><span>${w.openProblemCount} open Problems</span></div>
              </a>`,
            )}
          </div>`
    }
  `;
  return { title: "Workstreams", body };
}

/** `/w/<slug>/problems/<id>` — one Problem and everything hanging off it. */
export async function problemPage(
  read: ReadContext,
  slug: string,
  id: string,
): Promise<{ title: string; body: Html; detail: ProblemDetail }> {
  // Independent: the Problem is resolved by id inside the scope, and the
  // Workstream by slug. The slug check below is what makes an id from another
  // Workstream a 404, and it needs both — but neither read needs the other's
  // answer to start.
  const [ws, detail] = await Promise.all([
    ask<WorkstreamRow | null>(read, { kind: "WORKSTREAM_BY_SLUG", slug }),
    ask<ProblemDetail | null>(read, { kind: "PROBLEM_DETAIL", id }),
  ]);
  if (!ws) throw new PageNotFound(`no Workstream with slug ${slug}`);
  if (!detail || detail.problem.workstreamId !== ws.id) {
    throw new PageNotFound(`no Problem ${id} in ${slug}`);
  }

  const { problem, attempts, evidence, abandonment, outcome } = detail;

  const openAttempts = attempts.filter((a) => a.status === "open").length;

  const body = html`
    ${crumb([
      { href: "/", label: "Workstreams" },
      { href: `/w/${ws.slug}`, label: ws.slug },
      { label: "Problems" },
      { label: String(problem.id) },
    ])}
    <div style="display:flex;align-items:center;gap:10px;margin:10px 0 0">
      ${badge(stageOf(problem.status))}<span class="mono" style="color:var(--faint);font-size:12px"
        >PRB-${problem.id}</span
      >
    </div>
    <h1>${problem.title}</h1>

    <div class="split" style="margin-top:22px">
      <div class="rail">
        <div class="step ${evidence.length ? "done" : ""}">
          Evidence<small>${evidence.length} linked with a why-note</small>
        </div>
        <div class="step ${attempts.length ? "done" : ""}">
          Attempts<small
            >${
              attempts.length
                ? `${openAttempts} open of ${attempts.length}`
                : "nothing recorded in flight"
            }</small
          >
        </div>
        <div class="step ${outcome ? "here" : ""}">
          Outcome<small
            >${
              outcome
                ? `${outcome.id} · done`
                : problem.status === "abandoned"
                  ? "abandoned instead"
                  : "still open"
            }</small
          >
        </div>
      </div>

      <div>
        <div class="panel"><div class="pad prose">${problem.description}</div></div>

        <div class="panel">
          <div class="hd">
            Evidence <span class="r">${evidence.length} Observations linked</span>
          </div>
          ${
            evidence.length === 0
              ? html`<div class="pad" style="color:var(--faint)">
                  No Evidence yet — an Observation is not Evidence until it is linked with a reason.
                </div>`
              : evidence.map(
                  (e) => html`<div class="ev">
                    <div class="why">${e.note ?? "(no why-note)"}</div>
                    <div class="q">${e.observation?.content ?? "(observation missing)"}</div>
                    <div class="m mono">
                      ${
                        e.observation
                          ? html`<a href="/w/${ws.slug}/observations/${e.observation.id}"
                                >${e.observation.id}</a
                              >
                              · ${e.observation.source ?? "no source"} ·
                              ${e.observation.sourceType ?? "untyped"}`
                          : ""
                      }
                    </div>
                  </div>`,
                )
          }
        </div>

        <div class="panel">
          <div class="hd">
            Attempts <span class="r">${openAttempts} open of ${attempts.length}</span>
          </div>
          ${
            attempts.length === 0
              ? html`<div class="pad" style="color:var(--faint)">
                  No Attempts — nothing is recorded as being worked on. A Problem staged as active
                  with no open Attempt is drift.
                </div>`
              : attempts.map(
                  (a) => html`<div class="att ${a.status === "dropped" ? "out" : ""}">
                    <div>${badge(a.status)}</div>
                    <div class="t">
                      ${trackerLink(a.ref, a.label)}
                      <div class="m mono">${a.id} · ${a.ref}</div>
                      ${
                        a.closingNote
                          ? html`<p class="prose" style="margin:8px 0 0">${a.closingNote}</p>`
                          : ""
                      }
                    </div>
                  </div>`,
                )
          }
        </div>

        ${
          abandonment
            ? html`<div class="panel">
                <div class="hd">Abandonment <span class="r mono">${abandonment.id}</span></div>
                <div class="pad">
                  <p class="prose" style="margin:0">${abandonment.rationale}</p>
                  <p style="margin:10px 0 0;color:var(--faint);font-size:12px">
                    ${date(abandonment.abandonedAt)} — abandoned is not deleted.
                  </p>
                </div>
              </div>`
            : ""
        }
        ${
          outcome
            ? html`<div class="panel">
                <div class="hd">Outcome <span class="r mono">${outcome.id}</span></div>
                <div class="pad">
                  <div class="kv">
                    <b>Observed</b>
                    <div class="prose">${outcome.observedImpact}</div>
                    <b>Learnings</b>
                    <div class="prose">${outcome.learnings ?? "—"}</div>
                    <b>Recorded</b>
                    <div>${date(outcome.observedAt)}</div>
                  </div>
                  ${
                    outcome.followUpProblemIds.length
                      ? html`<p style="margin:14px 0 0;color:var(--faint);font-size:12px">
                          Follow-ups:
                          ${outcome.followUpProblemIds.map(
                            (pid) =>
                              html`<a href="/w/${ws.slug}/problems/${pid}">PRB-${pid}</a>&nbsp;`,
                          )}
                        </p>`
                      : ""
                  }
                </div>
              </div>`
            : ""
        }
      </div>
    </div>
  `;
  return { title: problem.title, body, detail };
}

/**
 * `/w/<slug>/observations` — the intake pile, and how much of it has been used.
 *
 * Observations are the one entity filed faster than they are read: cheap to
 * create, never deleted, and until now reachable in the browser only by
 * permalink. What a reader wants from the list is not the content of each one
 * — it is the triage state of the pile, which is why the three groups are the
 * page and the rows are just rows.
 *
 * The groups are derived, not stored. Observation has no `status` column by
 * design; being Evidence for a Problem is what "used" means, and an archive
 * with a rationale is the recorded judgment that it never will be. What is
 * left over is the queue.
 */
export async function observationListPage(
  read: ReadContext,
  slug: string,
): Promise<{ title: string; body: Html; workstream: WorkstreamRow }> {
  const ws = await ask<WorkstreamRow | null>(read, { kind: "WORKSTREAM_BY_SLUG", slug });
  if (!ws) throw new PageNotFound(`no Workstream with slug ${slug}`);
  const rows = await ask<ObservationSummary[]>(read, {
    kind: "OBSERVATION_SUMMARIES",
    workstreamId: ws.id,
  });

  const archived = rows.filter((o) => o.archive);
  const linked = rows.filter((o) => !o.archive && o.problemCount > 0);
  const waiting = rows.filter((o) => !o.archive && o.problemCount === 0);

  const row = (o: ObservationSummary, note: Html | string): Html =>
    html`<div class="ev">
      <div class="q">
        <a href="/w/${ws.slug}/observations/${o.id}">${o.content}</a>
      </div>
      <div class="m mono">
        ${o.id} · ${date(o.createdAt)}${o.source ? html` · ${o.source}` : ""} · ${note}
      </div>
    </div>`;

  const group = (title: string, count: number, blurb: string, body: Html): Html =>
    html`<div class="panel">
      <div class="hd">${title} <span class="r">${count}</span></div>
      ${count === 0 ? html`<div class="pad" style="color:var(--faint)">${blurb}</div>` : body}
    </div>`;

  const body = html`
    ${crumb([
      { href: "/", label: "Workstreams" },
      { href: `/w/${ws.slug}`, label: ws.slug },
      { label: "Observations" },
    ])}
    <h1>Observations</h1>
    <p class="sub">
      ${rows.length} filed · ${linked.length} linked to a Problem · ${archived.length} archived ·
      ${waiting.length} waiting.
    </p>

    ${group(
      "Waiting",
      waiting.length,
      "Nothing waiting — every Observation here is either Evidence or archived.",
      html`${waiting.map((o) => row(o, "not yet linked"))}`,
    )}
    ${group(
      "Linked",
      linked.length,
      "No Observation has been linked to a Problem yet.",
      html`${linked.map((o) =>
        row(o, `Evidence for ${o.problemCount} ${o.problemCount === 1 ? "Problem" : "Problems"}`),
      )}`,
    )}
    ${group(
      "Archived",
      archived.length,
      "Nothing archived.",
      html`${archived.map((o) =>
        row(o, `archived — ${o.archive?.rationale ?? "(no rationale recorded)"}`),
      )}`,
    )}

    <p class="legend">
      An Observation has no status of its own — these groups are read off its Evidence rows and its
      archive. <b>Waiting</b> is the intake queue: filed, and not yet either used or ruled out.
      Linking one is what makes it Evidence, and archiving one records the judgment that it will not
      be.
    </p>
  `;
  return { title: `Observations · ${ws.title}`, body, workstream: ws };
}

/** `/w/<slug>/observations/<id>` — one signal and every Problem it supports. */
export async function observationPage(
  read: ReadContext,
  slug: string,
  id: string,
): Promise<{ title: string; body: Html; detail: ObservationDetail }> {
  // Same shape as `problemPage`: the slug and the id are resolved against the
  // same scope and neither answer feeds the other, so they go together.
  const [ws, detail] = await Promise.all([
    ask<WorkstreamRow | null>(read, { kind: "WORKSTREAM_BY_SLUG", slug }),
    ask<ObservationDetail | null>(read, { kind: "OBSERVATION_DETAIL", id }),
  ]);
  if (!ws) throw new PageNotFound(`no Workstream with slug ${slug}`);
  if (!detail || detail.observation.workstreamId !== ws.id) {
    throw new PageNotFound(`no Observation ${id} in ${slug}`);
  }
  const { observation, evidenceLinks } = detail;
  const tags: string[] = observation.tags ? (JSON.parse(observation.tags) as string[]) : [];

  const body = html`
    ${crumb([
      { href: "/", label: "Workstreams" },
      { href: `/w/${ws.slug}`, label: ws.slug },
      { label: "Observations" },
      { label: observation.id },
    ])}
    <h1 style="font-size:19px;line-height:1.5;max-width:760px">${observation.content}</h1>

    <div class="split" style="margin-top:16px">
      <div class="rail">
        <div class="step here">Observation<small class="mono">${observation.id}</small></div>
        <div class="step ${evidenceLinks.length ? "done" : ""}">
          Evidence<small
            >${
              evidenceLinks.length
                ? `supports ${evidenceLinks.length} ${evidenceLinks.length === 1 ? "Problem" : "Problems"}`
                : "not yet linked"
            }</small
          >
        </div>
      </div>
      <div>
        <div class="panel">
          <div class="pad kv">
            <b>Source</b>
            <div>${observation.source ?? "—"}</div>
            <b>Source type</b>
            <div>${observation.sourceType ?? "—"}</div>
            <b>Tags</b>
            <div>${tags.length ? tags.join(", ") : "—"}</div>
            <b>Filed</b>
            <div>${date(observation.createdAt)}</div>
          </div>
        </div>

        ${
          observation.archive?.archivedAt
            ? html`<div class="panel">
                <div class="hd">Archived</div>
                <div class="pad prose">
                  ${observation.archive.rationale ?? "(no rationale recorded)"}
                </div>
              </div>`
            : ""
        }

        <div class="panel">
          <div class="hd">Supports as Evidence</div>
          ${
            evidenceLinks.length === 0
              ? html`<div class="pad" style="color:var(--faint)">
                  Not linked to any Problem yet — this Observation is still in the intake queue.
                </div>`
              : evidenceLinks.map(
                  (e) => html`<div class="ev">
                    <div class="why">${e.note ?? "(no why-note)"}</div>
                    <div class="q">
                      <a href="/w/${ws.slug}/problems/${e.problem.id}">${e.problem.title}</a>
                    </div>
                    <div class="m mono">PRB-${e.problem.id}</div>
                  </div>`,
                )
          }
        </div>
      </div>
    </div>
  `;
  return { title: observation.id, body, detail };
}

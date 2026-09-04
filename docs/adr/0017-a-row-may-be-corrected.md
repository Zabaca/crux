# A row may be corrected, and what it used to say is kept

Every row in a corpus may now be revised: a Problem's title and description, an
Observation's content, an Attempt's `ref`, label and closing note, an Evidence
note, an Outcome's `observedImpact` and learnings, an Abandonment's rationale,
and a Workstream's title and description. The row is edited in place — it stays
the single source of current truth — and its previous values are written to a
`revisions` table, so a correction never costs the record it corrects.
`RENAME_OBSERVATION` is deleted rather than exposed.

## The model was frozen in the wrong places

Crux implemented exactly one content edit — `RENAME_OBSERVATION`, which
overwrites an Observation's `content` with no history and no reason — and that
action was reachable from no surface at all: not the CLI, not the browser, not a
test. Everything a user could actually reach was immutable. So the one row the
model calls a raw signal, whose value depends on being exactly what was seen at
the time, was the only one the engine could change, and the rows whose whole
nature is revision — a synthesis as Evidence accumulates, a pointer whose job is
to resolve — could not be touched.

Both halves were hit inside one session of real use, minutes apart, and both are
Evidence on the Problem that produced this decision. Problem #1's description
still names an unmeasured candidate cause that its own Evidence measured and
demoted, so the Problem contradicts the rows attached to it. And an Attempt was
filed with a `ref` that resolved to nothing; with no way to correct a pointer,
the only repair was to close it `dropped` with an explanatory note and refile,
which left a dropped Attempt representing no abandoned work in a graveyard the
glossary reserves for judgments about why an approach ended. Getting a pointer
wrong cost a terminal transition.

The cost is not inconvenience. A corpus that accumulates rows that are wrong and
cannot be made right decays into exactly the stale doc this product exists to
replace, and both escape hatches damage the record: abandon-and-refile pollutes
the graveyard and orphans Evidence, and writing the row directly bypasses the
transition layer ADR-0003 exists to protect.

## Why freezing the Observation is no longer the way to protect it

The argument for immutability was never immutability. It was that an edit with
no record is indistinguishable from a fabrication, so refusing the edit was the
only way to keep a raw signal trustworthy. Freezing was a proxy for durability.

Once the previous value is kept, durability is provided directly and the proxy
has no remaining job: "exactly what was seen at the time" is preserved by the
history rather than enforced by the refusal. Keeping the freeze anyway would
also fail on its own terms — the repair it leaves is archive-and-refile, and any
Evidence already linked to the archived row now points at a dead one, which is
the orphaning this decision exists to stop.

## Revision is not archiving

These are different claims about the world and the corpus keeps them apart.
**Revision** says *what I wrote was wrong* — the record was inaccurate.
**Archiving** says *what I wrote was right and has stopped being live* — the
record is accurate and the world moved.

Collapsing them was tempting, because once anything is editable you can express
staleness by editing the row. It is rejected because doing so files a false
statement: an Observation reporting a defect that has since been fixed was
true on the day it was filed, and rewriting it to say otherwise destroys the raw
signal this decision just went to some length to protect. A corpus that cannot
distinguish "I was mistaken" from "this got fixed" has lost the difference
between a correction and a changelog.

## What was rejected

**Append-only revisions with a derived current state.** Nothing would be lost,
but every reader would pay for a feature almost no read wants — "current"
becomes a computation, and every `--json` shape and every page grows a notion of
version. The live row stays the truth; history is a side record that no normal
request reads.

**A single polymorphic `REVISE { entity, id, fields }` action.** One kind instead
of seven, mirroring the storage table exactly. Rejected because the action schema
is a discriminated union on `kind` and that is where field validity is enforced:
a `fields` bag would accept `content` on a Problem and fail at the database, or
silently write nothing — which is the exact defect being tracked separately as
input accepted, not honoured, success reported. Polymorphism belongs in storage,
where the rows genuinely are alike, and not in the API, where the fields
genuinely differ.

**Requiring a reason.** A revision takes an optional `reason`. The model already
draws this line: `ABANDON_PROBLEM` requires a rationale and `COMPLETE_PROBLEM`
requires an `observedImpact` because those are terminal doors, while
`ARCHIVE_OBSERVATION`'s rationale is optional. A revision is reversible — you can
revise again — so it sits with the second group.

**Auto-archiving, and prompting for it.** Nothing in Crux can observe the world,
and archiving is a judgment about the world rather than about the corpus. A
machine deciding a row is stale is the corruption this decision spent its length
avoiding. Prompting at `COMPLETE_PROBLEM` was also rejected on evidence: the
three Observations that motivated the archiving half were never Evidence for any
Problem, so the hook would not have caught one of them.

## Consequences

**A terminal judgment becomes rewritable.** An Outcome's measured impact and an
Abandonment's rationale can be changed. The invariants that matter are untouched
— there is still exactly one Outcome per Problem, and revising one does not
reopen anything — and the history is what makes it safe: a retracted measurement
leaves a trace instead of quietly becoming a different claim.

**History is write-mostly, deliberately.** A `show` carries only a marker — that
the row was revised, and how many times — and the history itself is a second
read. Inlining it would repeat the mistake that killed the old digest command,
which grew a hot read with data almost no caller wanted. The marker must resolve
in the same concurrent wave as the rest of the read, not a round trip after it.
In the browser it is a marker and nothing else; there is no diff viewer.

**Archiving is now honoured on read, and still nothing prompts it.** Archived
Observations drop out of listings and search, remain visible by id and under any
Problem's Evidence, and can be asked for explicitly. That makes archiving
effective; it does not make it happen. Search gets weaker in exchange — a
retired Observation no longer surfaces to a search that precedes filing — which
is accepted because duplication among Observations is cheap and by design,
while a stale row silently informing a live conclusion is a failure that has
already occurred.

**Renaming survives as a separate verb.** A Workstream's slug is not something a
row said; it is how the row is addressed, by every `-w`, every URL, and every
reference an agent has stored, and it carries tenancy meaning under ADR-0016.
`RENAME_WORKSTREAM` therefore keeps the slug, and revision takes title and
description, so re-addressing a corpus can never be mistaken for fixing a
sentence.

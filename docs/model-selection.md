# How to Select Model

Quick decision guide for picking Opus, Sonnet, or Haiku when delegating work.

## OPUS

**DON'T:**
- Rote transforms (rename across files, lint fixes, format changes)
- Mechanical edits with clear pattern to mimic
- Single-file tweaks under ~100 LOC
- Tasks where a smaller model already gave a working answer
- Bulk parallel work where cost compounds

**DO:**
- Ambiguous specs requiring interpretation and tradeoff calls
- Architectural design (new system, new abstraction, cross-cutting refactor)
- Debugging that spans many files or subtle async/concurrency bugs
- Hard-to-verify logic (correctness not caught by tests)
- Large context (>50k tokens) needing coherent reasoning across all of it
- Plans, reviews, advisor calls
- Net-new design where wrong direction costs hours

## SONNET

**DON'T:**
- Pure mechanical work (Haiku is faster/cheaper)
- Open-ended architecture without a spec (Opus reasons better)
- Tasks where success depends on subtle judgment across 50k+ tokens

**DO:**
- Build from a clear spec or plan file
- Multi-file edits following an existing pattern in the repo
- Implementation work where tests verify correctness
- Most builder/teammate roles
- Default choice when unsure between Opus and Haiku

## HAIKU

**DON'T:**
- Anything requiring judgment between competing approaches
- Code touching security, migrations, prod state
- Tasks needing >10k tokens of context held coherently
- Singleton/module-state overrides or other "gotcha" patterns
- Work where the diff is hard to review

**DO:**
- Repeated identical transforms (rename N call sites, fix N imports)
- Single-file edits with obvious answer
- Test/script/throwaway code
- Lint fixes, format passes, doc typos
- Parallel bulk work where cost matters
- Clear "do X to Y" with no branching decisions

## Tiebreakers

- Blast radius high (prod, migrations) → bump up one tier
- Verification cheap (tests catch errors) → bump down one tier
- Novelty high (net-new, no pattern to mimic) → bump up one tier
- Repeated identical work → bump down one tier

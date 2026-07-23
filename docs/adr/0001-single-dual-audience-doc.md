# Single dual-audience doc: README.md = CLAUDE.md = AGENTS.md

README.md is the one real file; CLAUDE.md and AGENTS.md are symlinks to it. Every audience — a human visitor on the repo front page, a contributor, and an agent loading session context — reads the same document. We chose this over the conventional split (polished README + separate agent instructions) because forcing one doc to serve everyone keeps it honest: no marketing fluff a contributor has to see through, no agent-only shadow doc that drifts from what humans read. Apparent audience conflicts have so far been wording problems, not placement problems.

## Consequences

- **Sections graduate by size, not audience.** A topic starts as a README section; when it outgrows the page it moves to its own file (e.g. `docs/agents/*`, a future CONTRIBUTING.md) behind a 1–3 line pointer. Never split a section out just because it "feels agent-only" or "feels human-only".
- **Agent config is publicly visible** on the repo front page. Accepted deliberately (2026-07-23) when the agent-skills block landed.
- **Rot hurts everyone at once**, and within weeks of writing the file already carried stale facts (db path, test-suite claim, `CRUX_DEV` default). The decision stands only alongside a system that keeps the doc true — tracked as OBS-073/OBS-074 in WS-crux (candidate: auto-generated /docs with README as root, with the generation step as the verification point).

# README-rooted doc tree, derived on read

The project's documentation is defined as whatever is *reachable* from README: a shared link-walker starts there and recursively follows internal markdown links and Claude Code `@import`s. Every internal link (docs, code paths, any relative path) is existence-checked; external URLs are skipped. A doc file under `docs/` (or `CONTEXT.md`) that the walker cannot reach is an orphan — structural rot — as is any broken internal link. Agent machinery (`.claude/`, `skills/`, `.fredrin/`) is outside the doc tree entirely.

Nothing is generated or committed. The rot check (`bun run docs:check`, non-zero exit on rot) and the web UI's docs route both invoke the walker live at read time. We considered a committed or build-time `/docs` artifact and rejected it: an artifact can itself go stale between regenerations, which is exactly the failure mode this exists to kill. Derived-on-read means the check script and the UI can never disagree.

This closes the open dependency in ADR-0001: the single dual-audience doc "stands only alongside a system that keeps the doc true." The walker is that system's structural half (OBS-073/OBS-074).

## Consequences

- **A doc that exists but isn't linked doesn't count.** It won't appear in the web UI and the check flags it as rot. Adding a doc means linking it from the tree, not just creating the file.
- **Rot is loud where docs are read, quiet elsewhere.** The web UI shows the rot report as a banner in the Docs section only when non-empty; it does not badge the roadmap views.
- **`@import`s render inline** in the docs surface, matching what agents actually see when they load the file.
- **Structural rot only.** The walker would not have caught ADR-0001's stale db path or false test-suite claim. Content rot remains a human/agent judgment; the walker just guarantees the surface where you'd notice it is complete and unbroken.
- **No Astro / static-site migration.** Considered (2026-07-23) and rejected: the web app's core is interactive and db-backed; a build-time content pipeline is both unnecessary for a handful of local markdown files and reintroduces the artifact problem.

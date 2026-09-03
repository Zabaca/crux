import { CruxError } from "@crux/core/transitions";

/**
 * Where a command's Workstream and Problem come from: the arguments it was
 * given, and nowhere else.
 *
 * These used to fall back to view-state — the per-Principal Durable Object
 * holding "what is this actor pointed at". A Principal is one token in one
 * `config.toml`, so every agent on a machine shared that one selection, and two
 * agents working different Workstreams in parallel silently misfiled into each
 * other's with `ok: true` returned each time. Into a corpus nothing deletes.
 *
 * So the fallback is gone rather than merely discouraged: keeping it would keep
 * the bug for every caller who forgets the flag, which is the path an agent
 * takes. Discovery is a read — `crux workstream list` — and the flag is what
 * acts, which is nothing two processes can contend over.
 */
export function wsArg(explicit: string | undefined): string {
  if (explicit) return explicit;
  throw new CruxError(
    "VALIDATION_ERROR",
    "no workstream given — pass `-w <slug>`. Run `crux workstream list` to see the slugs you can pass.",
    { flag: "--workstream", discover: "crux workstream list" },
  );
}

export function problemArg(explicit: string | undefined): string {
  if (explicit) return explicit;
  throw new CruxError(
    "VALIDATION_ERROR",
    "no problem given — pass the problem id. Run `crux problem list -w <slug>` to see the ids you can pass.",
    { flag: "--problem", discover: "crux problem list -w <slug>" },
  );
}

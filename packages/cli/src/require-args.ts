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
 *
 * The guard is ours rather than citty's `required: true` on purpose. citty
 * refuses with a bare message and exit 1; a refusal an agent has to act on
 * needs the code, the exit status and the discovery command, which is what
 * these throw.
 */

/**
 * The `-w` definition, in one place because its description is the copy an
 * agent reads in `--help` right before it gets the refusal below.
 *
 * A function rather than a shared object: every command gets its own,
 * so nothing citty does to one argument table can reach another.
 */
export function workstreamArg() {
  return {
    workstream: {
      type: "string",
      alias: "w",
      description: "Required. Which Workstream to act on — `crux workstream list` shows the slugs.",
    },
  } as const;
}

export function requireWorkstream(explicit: string | undefined): string {
  if (explicit) return explicit;
  throw new CruxError(
    "VALIDATION_ERROR",
    "no workstream given — pass `-w <slug>`. Run `crux workstream list` to see the slugs you can pass.",
    { argument: "--workstream", discover: "crux workstream list" },
  );
}

/**
 * `details.argument` is spelled the way the *caller's* signature spells it,
 * because an agent retries on what it reads there: `evidence link` takes the
 * Problem as a positional, while `attempt add` and `outcome add` take a flag.
 */
export function requireProblem(explicit: string | undefined, argument: string): string {
  if (explicit) return explicit;
  throw new CruxError(
    "VALIDATION_ERROR",
    `no problem given — pass ${argument}. Run \`crux problem list -w <slug>\` to see the ids you can pass.`,
    { argument, discover: "crux problem list -w <slug>" },
  );
}

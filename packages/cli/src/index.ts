#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from "citty";
import { handleError } from "./errors.js";
import { userCommand } from "./commands/user.js";
import { workstreamCommand } from "./commands/workstream.js";
import { observationCommand } from "./commands/observation.js";
import { problemCommand } from "./commands/problem.js";
import { evidenceCommand } from "./commands/evidence.js";
import { attemptCommand } from "./commands/attempt.js";
import { searchCommand } from "./commands/search.js";
import { abandonmentCommand } from "./commands/abandonment.js";
import { outcomeCommand } from "./commands/outcome.js";
import { initCommand } from "./commands/init.js";
import { claimCommand } from "./commands/claim.js";
import { viewCommand } from "./commands/view.js";
import { resolveCliVersion } from "./version.js";
import { emit } from "./output.js";

const main = defineCommand({
  meta: {
    name: "crux",
    version: resolveCliVersion(),
    description: "Discovery residue CLI — capture observations, shape problems, track attempts.",
  },
  subCommands: {
    init: initCommand,
    claim: claimCommand,
    user: userCommand,
    workstream: workstreamCommand,
    observation: observationCommand,
    problem: problemCommand,
    evidence: evidenceCommand,
    attempt: attemptCommand,
    abandonment: abandonmentCommand,
    outcome: outcomeCommand,
    search: searchCommand,
    view: viewCommand,
  },
});

/**
 * `--version` is only the flag when nothing has been asked for yet: before the
 * first non-flag argument, and so before any subcommand. `crux problem revise
 * X --version` is a bad argument to `revise` and must reach `revise` to be told
 * so, rather than being answered here.
 */
function wantsVersion(rawArgs: string[]): boolean {
  for (const arg of rawArgs) {
    if (arg === "--version") return true;
    if (!arg.startsWith("-")) return false;
  }
  return false;
}

async function bootstrap() {
  const rawArgs = process.argv.slice(2);
  // Local only — no config, no token, no network (ADR-0018). The shape is a
  // strict subset of what `crux version` answers, so the difference reads as
  // "the flag skipped the network" rather than as two answers.
  if (wantsVersion(rawArgs)) {
    const client = resolveCliVersion();
    emit({ client }, client);
    return;
  }
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    let cmd: {
      meta?: unknown;
      subCommands?: Record<string, unknown>;
      args?: unknown;
      run?: unknown;
    } = main as unknown as typeof cmd;
    let parent: typeof cmd | undefined;
    for (const arg of rawArgs) {
      if (arg.startsWith("-")) break;
      const subs = cmd.subCommands;
      if (!subs || !(arg in subs)) break;
      parent = cmd;
      cmd = await (subs[arg] as Promise<typeof cmd>);
    }
    await showUsage(cmd as never, parent as never);
    return;
  }
  await runCommand(main, { rawArgs });
}

bootstrap().catch(handleError);

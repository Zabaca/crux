#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from "citty";
import { handleError } from "./errors.js";
import { userCommand } from "./commands/user.js";
import { workstreamCommand } from "./commands/workstream.js";
import { observationCommand } from "./commands/observation.js";
import { problemCommand } from "./commands/problem.js";
import { evidenceCommand } from "./commands/evidence.js";
import { solutionCommand } from "./commands/solution.js";
import { decisionCommand } from "./commands/decision.js";
import { contextCommand } from "./commands/context.js";
import { eliminationCommand } from "./commands/elimination.js";
import { abandonmentCommand } from "./commands/abandonment.js";
import { outcomeCommand } from "./commands/outcome.js";
import { initCommand } from "./commands/init.js";
import { browseCommand } from "./commands/browse.js";
import { viewCommand } from "./commands/view.js";

const main = defineCommand({
  meta: {
    name: "crux",
    version: "0.0.0",
    description: "Discovery residue CLI — capture observations, shape problems, record decisions.",
  },
  subCommands: {
    init: initCommand,
    user: userCommand,
    workstream: workstreamCommand,
    observation: observationCommand,
    problem: problemCommand,
    evidence: evidenceCommand,
    solution: solutionCommand,
    decision: decisionCommand,
    elimination: eliminationCommand,
    abandonment: abandonmentCommand,
    outcome: outcomeCommand,
    context: contextCommand,
    browse: browseCommand,
    view: viewCommand,
  },
});

async function bootstrap() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    let cmd: {
      meta?: unknown;
      subCommands?: Record<string, unknown>;
      args?: unknown;
      run?: unknown;
    } = main;
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

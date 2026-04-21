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
import { ideaCommand } from "./commands/idea.js";
import { eliminationCommand } from "./commands/elimination.js";
import { abandonmentCommand } from "./commands/abandonment.js";
import { outcomeCommand } from "./commands/outcome.js";
import { themeCommand } from "./commands/theme.js";

const main = defineCommand({
  meta: {
    name: "crux",
    version: "0.0.0",
    description: "Discovery residue CLI — capture observations, shape problems, record decisions.",
  },
  subCommands: {
    user: userCommand,
    workstream: workstreamCommand,
    observation: observationCommand,
    problem: problemCommand,
    evidence: evidenceCommand,
    solution: solutionCommand,
    decision: decisionCommand,
    idea: ideaCommand,
    elimination: eliminationCommand,
    abandonment: abandonmentCommand,
    outcome: outcomeCommand,
    theme: themeCommand,
    context: contextCommand,
  },
});

async function bootstrap() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    const sub = rawArgs[0];
    if (sub && main.subCommands && sub in main.subCommands) {
      const subCmd = await (main.subCommands as Record<string, unknown>)[sub];
      await showUsage(subCmd as never, main as never);
    } else {
      await showUsage(main as never);
    }
    return;
  }
  await runCommand(main, { rawArgs });
}

bootstrap().catch(handleError);

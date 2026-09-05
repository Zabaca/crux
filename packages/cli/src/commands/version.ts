import { defineCommand } from "citty";
import { api } from "../api-client.js";
import { emit, setJsonMode } from "../output.js";
import { VersionOutput } from "../validation/index.js";
import { reportCliVersion } from "../version.js";

/**
 * The deployment half of the pair, which never throws.
 *
 * Everything between here and an answer can fail: `config.toml` may be
 * half-written or hold a `url` that is not a string, and the deployment it
 * names may be unreachable, slow, or too old to report a version at all. Every
 * one of those is a fact about the deployment, not a reason to withhold the
 * client's version — which is the half that needed nothing to resolve.
 *
 * A config that cannot be read is said out loud on stderr, because it is a
 * different problem from a deployment that is merely down and the caller cannot
 * tell them apart from `null` alone.
 */
async function describeDeployment(): Promise<{ deployment: string | null; url: string | null }> {
  let client;
  try {
    client = api();
  } catch (err) {
    process.stderr.write(
      `crux: cannot resolve a deployment to ask — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return { deployment: null, url: null };
  }
  const health = await client.health();
  return {
    deployment: typeof health?.version === "string" ? health.version : null,
    url: client.baseUrl,
  };
}

/**
 * What pair am I running?
 *
 * A `crux` command is an HTTP call, so a session is a client and a deployment
 * together and the two move independently (ADR-0018). The version in a
 * refusal's `details` covers the case where something refused; most odd
 * behaviour does not refuse — a read comes back surprising, a page looks wrong
 * — and no `details` ever arrive. This is the command that answers anyway, and
 * it is what an agent filing an Observation about that behaviour puts in it.
 *
 * It degrades rather than fails, and the client half is resolved first so that
 * nothing about the deployment can take it down: asking what you are running is
 * not a question that should require the network — or a readable config — to be
 * up. `crux --version` reports that half alone, in exactly this shape minus the
 * other two keys, so the difference between the two reads as *the flag skipped
 * the network* rather than as two answers that disagree.
 *
 * Nothing here mints a Principal. `/health` is unauthenticated and `health()`
 * sends no token, so a machine that has never run anything else can ask this
 * question without a credential being created as a side effect (ADR-0013).
 */
export const versionCommand = defineCommand({
  meta: {
    name: "version",
    description: "Report this client's version and the deployment's, together.",
  },
  args: {
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const client = reportCliVersion();
    emit({ client, ...(await describeDeployment()) }, VersionOutput);
  },
});

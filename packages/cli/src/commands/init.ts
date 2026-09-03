import { defineCommand } from "citty";
import { configPath, loadApiConfig, writeConfig } from "../config/user.js";
import { emit, setJsonMode } from "../output.js";
import { ApiError, createApiClient } from "../api-client.js";

/**
 * `crux init` used to create a local database and run migrations. There is no
 * local database any more (ADR-0003), so what a fresh machine needs is the
 * deployment's coordinates: a URL and the bearer token minted for this user.
 */
export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Point this machine at a crux deployment.",
  },
  args: {
    url: { type: "string", description: "Deployment base URL, e.g. https://crux.example.dev" },
    token: { type: "string", description: "Bearer token minted for you by the deployment." },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const existing = loadApiConfig();
    const url = (args.url as string | undefined) ?? existing.url;
    const token = (args.token as string | undefined) ?? existing.token;
    if (!url || !token) {
      const missing = !url && !token ? "--url and --token" : !url ? "--url" : "--token";
      throw new ApiError("NO_API_CONFIG", `crux init needs ${missing}`);
    }

    // Prove the coordinates work before writing them: a token typo that only
    // surfaces on the next command is a worse failure than one that surfaces now.
    const client = createApiClient({ baseUrl: url, token });
    await client.query({ kind: "WORKSTREAM_LIST" });

    writeConfig({ api: { url: client.baseUrl, token } });
    emit(
      { ok: true, apiUrl: client.baseUrl, configPath: configPath() },
      `crux is pointed at ${client.baseUrl} (written to ${configPath()})`,
    );
  },
});

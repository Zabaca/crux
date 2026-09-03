import { defineCommand } from "citty";

import { api } from "../api-client.js";
import { emit, setJsonMode } from "../output.js";

/**
 * `crux claim <email>` — attach a human to the Principal this machine files as
 * (ADR-0013).
 *
 * The command lives here rather than on the web because the browser has no way
 * to know *which* Principal is asking: the token that has been filing is the
 * only thing that knows, and it lives on this machine. So the address is named
 * here, and proved by the link that follows.
 *
 * Nothing is written to the corpus by this command — not even the Principal's
 * own row. It records the ask and sends a mail; opening the link is what
 * claims. That is also why it is not a `dispatch()` action: the cap refuses
 * every write, and a claim that the cap could refuse would be a wall with its
 * own door locked.
 */
export const claimCommand = defineCommand({
  meta: {
    name: "claim",
    description: "Claim this machine's Principal by email, lifting the free allowance.",
  },
  args: {
    email: {
      type: "positional",
      required: true,
      description: "The address to claim this Principal as.",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const email = String(args.email);
    const res = await api().post<{ email: string; principalId: string; expiresAt: number }>(
      "/v1/claims",
      { email },
    );
    emit(
      { ok: true, email: res.email, principalId: res.principalId, expiresAt: res.expiresAt },
      `A claim link is on its way to ${res.email}. Open it to attach the address to ${res.principalId} — the link works once and lasts 15 minutes.`,
    );
  },
});

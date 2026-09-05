/**
 * The CLI's only door to the corpus.
 *
 * There is no local database (ADR-0003): every read is a named `query` and
 * every write is an `action`, both resolved by the deployment. This module owns
 * the two things that makes necessary — finding the deployment, and turning its
 * error envelope back into the exact error objects `handleError` already maps to
 * stable codes and exit codes, so a rejection from the server reads on the
 * terminal exactly as the local path used to.
 */
import { loadApiConfig, writeConfig } from "./config/user.js";
import { CruxError, type ErrorCode } from "@crux/core/transitions";
import { ActionNotAllowedError } from "@crux/core/actions";

/** An error the server reported that is not one of core's transition errors. */
export class ApiError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

const CRUX_ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "ILLEGAL_TRANSITION",
  "INVARIANT_VIOLATION",
  "REFERENTIAL_MISMATCH",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "VALIDATION_ERROR",
  "CAPACITY_EXCEEDED",
]);

type ErrorEnvelope = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

/** Rebuild the thrown-side error from the wire envelope. */
function toError(body: ErrorEnvelope): Error {
  const code = body.error?.code ?? "UNKNOWN";
  const message = body.error?.message ?? "request failed";
  const details = body.error?.details;
  if (code === "ACTION_NOT_ALLOWED") {
    const d = (details ?? {}) as {
      state?: unknown;
      attempted?: string;
      allowedView?: string[];
      allowedMutation?: string[];
      globals?: string[];
    };
    return new ActionNotAllowedError(d.state, d.attempted ?? "", {
      allowedView: d.allowedView ?? [],
      allowedMutation: d.allowedMutation ?? [],
      globals: d.globals ?? [],
    });
  }
  if (CRUX_ERROR_CODES.has(code)) {
    return new CruxError(code as ErrorCode, message, details ?? {});
  }
  return new ApiError(code, message, details);
}

/**
 * The deployment a machine with no configuration talks to.
 *
 * Adoption is anonymous-first (ADR-0013): installing the plugin and filing an
 * Observation must not require a Cloudflare account first, and it cannot require
 * one if there is nowhere to send the request. `crux init --url` still points a
 * machine at a different deployment, and `CRUX_API_URL` overrides both.
 */
export const DEFAULT_API_URL = "https://crux.zabaca.com";

/** The HTTP call the client makes. Injected in tests; `fetch` in production. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** How long `health()` waits before calling the deployment unreachable. */
const HEALTH_TIMEOUT_MS = 5_000;

/** What `POST /v1/dispatch` answers — core's `DispatchResult`, over the wire. */
export type DispatchResponse = { revision: number; viewState?: unknown; result?: unknown };

/**
 * What `GET /health` answers. Every field is optional because the deployment on
 * the other end may predate the field: one that has never been bumped off the
 * pre-release layout reports no `version` at all, and that is an answer worth
 * carrying rather than a malformed response.
 */
export type HealthReport = { status?: string; db?: string; version?: string };

export interface CruxApiClient {
  /** The configured deployment's base URL. */
  readonly baseUrl: string;
  query<T = unknown>(request: Record<string, unknown>): Promise<T>;
  dispatch(action: Record<string, unknown>): Promise<DispatchResponse>;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  /** `GET /health`, or `null` if the deployment could not answer one. */
  health(): Promise<HealthReport | null>;
}

export function createApiClient(options: {
  baseUrl: string;
  /** The bearer token, or a way to get one. A function is resolved on the first
   * request and its answer reused, which is what lets an unconfigured machine
   * mint a Principal without every command paying for a round-trip. */
  token: string | (() => Promise<string>);
  transport?: Transport;
}): CruxApiClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const transport = options.transport ?? ((url, init) => fetch(url, init));

  let pending: Promise<string> | null = null;
  const resolveToken = (): Promise<string> => {
    if (typeof options.token === "string") return Promise.resolve(options.token);
    pending ??= options.token();
    return pending;
  };

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const token = await resolveToken();
    let res: Response;
    try {
      res = await transport(`${base}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (err) {
      throw new ApiError(
        "API_UNREACHABLE",
        `cannot reach the crux deployment at ${base}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new ApiError(
        "UNKNOWN",
        `malformed response from ${base}${path}: ${text.slice(0, 200)}`,
      );
    }
    if (!res.ok) throw toError(body as ErrorEnvelope);
    return body as T;
  }

  return {
    baseUrl: base,
    async query<T>(request: Record<string, unknown>): Promise<T> {
      const body = await call<{ result: T }>("/v1/query", {
        method: "POST",
        body: JSON.stringify(request),
      });
      return body.result;
    },
    dispatch(action: Record<string, unknown>): Promise<DispatchResponse> {
      return call<DispatchResponse>("/v1/dispatch", {
        method: "POST",
        body: JSON.stringify(action),
      });
    },
    get<T>(path: string): Promise<T> {
      return call<T>(path, { method: "GET" });
    },
    async health(): Promise<HealthReport | null> {
      try {
        const res = await transport(`${base}/health`, {
          method: "GET",
          // A deployment that accepts the connection and then says nothing must
          // not hang the caller: the only reason to ask /health is that
          // something is already odd, and a diagnostic that never returns is
          // the worst possible answer to that.
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        const body: unknown = JSON.parse(await res.text());
        // Deliberately not gated on `res.ok`: a degraded deployment answers 503
        // *carrying* its version (ADR-0015), and which build is failing is
        // exactly what the asker wanted to know.
        return typeof body === "object" && body !== null && !Array.isArray(body)
          ? (body as HealthReport)
          : null;
      } catch {
        // Unreachable, timed out, or answering something that is not JSON. All
        // three mean the same thing to the caller — the deployment did not say
        // — and none of them is a reason to fail a question about versions.
        return null;
      }
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return call<T>(path, {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
  };
}

/** Test seam: pin the client every command resolves. `null` restores config. */
let override: CruxApiClient | null = null;

export function setApiClient(next: CruxApiClient | null): void {
  override = next;
  minting = null;
}

/**
 * The one mint this process will ever do.
 *
 * The per-client memo inside `createApiClient` is not enough: `api()` builds a
 * fresh client per call, and `crux browse` issues several in the same tick. Each
 * would mint its own Principal, the last `writeConfig` would win, and every
 * Observation filed under a losing token would be orphaned on a credential
 * nothing kept — the exact unrecoverable loss this notice warns about.
 */
let minting: Promise<string> | null = null;

/**
 * Mint a Principal against `baseUrl` and remember it.
 *
 * This is first use (ADR-0013): there is no registration to complete and no
 * invite to redeem, so the deployment hands back a token that owns everything
 * filed through it. Persisting it immediately is the point — a token minted and
 * then lost would strand the corpus it just created on the next command.
 */
function mintPrincipalToken(baseUrl: string): Promise<string> {
  minting ??= mintOnce(baseUrl).catch((err: unknown) => {
    // A failed mint must not poison the next command in a long-lived process.
    minting = null;
    throw err;
  });
  return minting;
}

async function mintOnce(baseUrl: string): Promise<string> {
  const anonymous = createApiClient({ baseUrl, token: "" });
  const minted = await anonymous.post<{ token?: string }>("/v1/principals", {});
  if (!minted.token) {
    throw new ApiError("UNKNOWN", `${baseUrl} did not return a token for a new Principal`);
  }
  const path = writeConfig({ api: { url: anonymous.baseUrl, token: minted.token } });
  announceMintedPrincipal(anonymous.baseUrl, path);
  return minted.token;
}

/**
 * Say that a credential was written, once, at the only moment it is news.
 *
 * A Principal used to be minted deliberately by a signed-in Member; it is now
 * minted silently on first use by anyone (ADR-0013), so without this the first
 * a user hears of the token is when they lose it. The deployment keeps only its
 * hash, which makes that loss permanent: deleting `config.toml` — or simply
 * working from a second machine — strands the corpus with nothing left that can
 * prove ownership. `crux claim` is the only escape hatch, because an attached
 * address can sign in and reach the same corpus again, so claiming is about
 * durability before it is ever about the free allowance.
 *
 * It goes to stderr because stdout is `--json` and is parsed, and every line is
 * prefixed `crux: ` so a log scraper reads it as a notice rather than an error.
 * The token itself is never named — the point is that a secret exists and where
 * it lives; what mode it ended up at is a promise the filesystem may refuse to
 * keep, so it is documented in the README rather than claimed here.
 */
function announceMintedPrincipal(baseUrl: string, path: string): void {
  process.stderr.write(
    [
      `crux: a new Principal was created on ${baseUrl}.`,
      `crux: its access token was written to ${path} — it is the only proof this corpus is yours, and the deployment cannot reissue it.`,
      `crux: run \`crux claim <you@example.com>\` to attach an address, so the corpus survives losing that file.`,
      "",
    ].join("\n"),
  );
}

/**
 * The client for this invocation.
 *
 * Neither half of the configuration is required any more. A missing URL falls
 * back to the public deployment, and a missing token is minted on the first
 * request and written to `config.toml` — so `crux observation add` works on a
 * machine that has never run anything else. `crux init` still exists for
 * pointing at a deployment of your own.
 */
export function api(): CruxApiClient {
  if (override) return override;
  const { url, token } = loadApiConfig();
  const baseUrl = url ?? DEFAULT_API_URL;
  if (token) return createApiClient({ baseUrl, token });
  return createApiClient({ baseUrl, token: () => mintPrincipalToken(baseUrl) });
}

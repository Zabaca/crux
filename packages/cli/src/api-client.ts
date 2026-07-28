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
import { userConfig } from "@crux/core";
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

/** The HTTP call the client makes. Injected in tests; `fetch` in production. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** What `POST /v1/dispatch` answers — core's `DispatchResult`, over the wire. */
export type DispatchResponse = { revision: number; viewState?: unknown; result?: unknown };

export interface CruxApiClient {
  /** The configured deployment's base URL. */
  readonly baseUrl: string;
  query<T = unknown>(request: Record<string, unknown>): Promise<T>;
  dispatch(action: Record<string, unknown>): Promise<DispatchResponse>;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
}

export function createApiClient(options: {
  baseUrl: string;
  token: string;
  transport?: Transport;
}): CruxApiClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const transport = options.transport ?? ((url, init) => fetch(url, init));

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await transport(`${base}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${options.token}`,
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
}

/**
 * The client for this invocation, built from `config.toml`. Missing coordinates
 * are a setup problem, not a corpus problem, so they fail with the command that
 * fixes them rather than a network error.
 */
export function api(): CruxApiClient {
  if (override) return override;
  const { url, token } = userConfig.loadApiConfig();
  if (!url || !token) {
    const missing = !url && !token ? "url and token" : !url ? "url" : "token";
    throw new ApiError(
      "NO_API_CONFIG",
      `no crux deployment configured — [api] ${missing} missing from ${userConfig.configPath()}. ` +
        `Run: crux init --url <https://…> --token <token>`,
    );
  }
  return createApiClient({ baseUrl: url, token });
}

/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Test-side binding types come from the `Cloudflare.Env` namespace — not the
// `ProvidedEnv` interface every pre-0.18 tutorial still shows.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    VIEW_STATE: DurableObjectNamespace;
    /** The free allowance (ADR-0013), so capacity.workerd.ts can assert against
     * the configured number instead of repeating it. */
    CRUX_OBSERVATION_CAP: string;
  }
}

/**
 * Which `kind`s this deployment serves, and the refusal for one it does not.
 *
 * A client and its deployment version independently and the client is the half
 * that moves first (ADR-0018), so "I have never heard of this" is a distinct
 * failure from "you called this wrong" and has to read as one. The check runs in
 * front of the schema parse at both entry points — `query()` and `dispatch()` —
 * so the refusal is identical whichever endpoint the caller used.
 */
import { UnknownKindError } from "./transitions/errors.js";

/** A discriminated-union variant, seen only as the literal `kind` it declares. */
type KindVariant = { shape: { kind: { value: string } } };

/** Every `kind` the given unions declare, collected once at module load. */
export function kindsOf(
  ...unions: Array<{ options: readonly KindVariant[] }>
): ReadonlySet<string> {
  return new Set(unions.flatMap((u) => u.options.map((o) => o.shape.kind.value)));
}

/**
 * Refuse a `kind` no variant declares.
 *
 * Deliberately narrow: a request that is not an object, or whose `kind` is
 * absent or not a string, is left to the schema — that is a malformed request
 * rather than a skew, and `VALIDATION_ERROR` is the honest answer for it.
 */
export function assertKnownKind(raw: unknown, known: ReadonlySet<string>): void {
  if (typeof raw !== "object" || raw === null) return;
  const kind = (raw as { kind?: unknown }).kind;
  if (typeof kind !== "string" || known.has(kind)) return;
  throw new UnknownKindError(kind);
}

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
/** A union of those, or of unions of those — `ActionSchema` is the second shape. */
type KindUnion = { options: readonly (KindVariant | KindUnion)[] };

/**
 * Every `kind` the given union declares, collected once at module load.
 *
 * Nested unions are walked rather than enumerated by the caller, so the set is
 * whatever the schema actually serves: a third union added to `ActionSchema`
 * joins it without an edit here, instead of being silently refused as unknown.
 *
 * It reaches into zod's own structure, so it throws rather than returning a
 * short set if that structure ever moves: an empty or partial set would refuse
 * *every* request as an unknown kind, which is a worse failure than not booting.
 */
export function kindsOf(union: KindUnion): ReadonlySet<string> {
  const kinds = new Set<string>();
  const walk = (node: KindVariant | KindUnion): void => {
    if ("options" in node) {
      for (const option of node.options) walk(option);
      return;
    }
    const kind: unknown = node.shape?.kind?.value;
    if (typeof kind !== "string") {
      throw new TypeError("kindsOf: a union variant declares no literal `kind`");
    }
    kinds.add(kind);
  };
  walk(union);
  return kinds;
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

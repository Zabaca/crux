/**
 * HTML primitives for the browser surfaces.
 *
 * Pages are server-rendered strings, so escaping is not optional and not a
 * convention: `html` is a tagged template that escapes every interpolation, and
 * the only way past it is `raw()` — which makes each deliberate exception
 * greppable. Corpus text (Problem descriptions, Evidence notes, Observation
 * content) is authored by Members and reaches these templates unsanitised.
 */

/** A string that has already been escaped, or is trusted markup. */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Mark a string as trusted markup — never call this on corpus or user input. */
export const raw = (s: string): Html => new Html(s);

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a value for HTML text and attribute positions alike. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function render(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(value);
}

/** Tagged template that escapes every interpolation. `Html` values pass through. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1]!;
  return new Html(out);
}

/** A complete HTML response. */
export function htmlResponse(body: Html, status = 200, headers: HeadersInit = {}): Response {
  return new Response(`<!doctype html>\n${body.value}`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

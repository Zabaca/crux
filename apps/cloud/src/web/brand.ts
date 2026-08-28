/**
 * The Crux mark, and the only copy of it.
 *
 * One 32-unit drawing serves three jobs — the header lockup, `/favicon.svg`,
 * and (rendered ahead of time) `/favicon.ico` — so the tab icon and the icon in
 * the header cannot drift apart. It lives here as a string rather than as a
 * file on disk because the Worker has no filesystem and this deployment has no
 * assets binding: every byte it serves is returned by a handler.
 *
 * The drawing is a letter C, black on a white tile, with no gradient. The
 * stroke tapers — heaviest on the left spine, thinnest at the two terminals
 * flanking the aperture — so the counter narrows toward the opening. That is
 * the one piece of meaning a letter mark can carry here: the corpus is a
 * narrowing, from many Observations to one Decision.
 *
 * Construction, for whoever edits it next: the C is a crescent cut by a wedge,
 * expressed as a mask. The outer circle is r=12 at (16,16); the inner circle is
 * r=7.9 pushed 1.3 to the right, and that offset *is* the taper — it leaves 5.4
 * units of ink on the left and 2.8 at the right-hand terminals. The third path
 * is a 60° wedge from the centre, which opens the aperture and cuts both
 * terminals square to the radius.
 */
import { html, raw, type Html } from "./html.js";

/** The mark at its native 32×32. `/favicon.svg` serves exactly this. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Crux">
  <mask id="crux-c">
    <rect width="32" height="32" fill="#000"/>
    <path d="M16 4a12 12 0 1 0 0 24a12 12 0 1 0 0-24Z" fill="#fff"/>
    <path d="M17.3 8.1a7.9 7.9 0 1 0 0 15.8a7.9 7.9 0 1 0 0-15.8Z" fill="#000"/>
    <path d="M16 16L37 3.87V28.13Z" fill="#000"/>
  </mask>
  <rect width="32" height="32" rx="8" fill="#fff"/>
  <rect width="32" height="32" fill="#000" mask="url(#crux-c)"/>
</svg>`;

/**
 * The mark inlined into the page header.
 *
 * Inlined rather than fetched from `/favicon.svg` for the same reason the
 * stylesheet is inlined in `layout.ts`: the shell is one document and one
 * request, and an `<img>` here would add a second round trip to every page to
 * draw 24 pixels. The id is rewritten because a mask id repeated in a document
 * is a collision, and this markup is spliced into pages that also carry islands.
 */
export const MARK_INLINE: Html = raw(
  MARK_SVG.replace(/\bcrux-c\b/g, "crux-c-hdr")
    .replace(/ width="32" height="32"(?= role)/, ' width="24" height="24"')
    .replace("<svg ", '<svg class="logo" '),
);

/**
 * The `<head>` links, in the order the fallback depends on.
 *
 * `.ico` is declared first because browsers that predate SVG favicons take the
 * first icon they understand, and Safari does not render an SVG favicon at all
 * — SVG-only would leave a blank tab there. Browsers that do support it match
 * on `type` and prefer the SVG, which is the one that stays sharp on a retina
 * tab strip and at any future size.
 */
export const FAVICON_LINKS: Html = html`<link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />`;

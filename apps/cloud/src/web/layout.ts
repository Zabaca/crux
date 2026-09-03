/**
 * The page shell and its stylesheet — the "Funnel" direction signed off on
 * CRUX-6D86GE: Stage columns on the Workstream page and a narrowing rail on the
 * Problem page, so the corpus's central mechanic is what a reader sees first.
 *
 * The stylesheet is inlined rather than served as an asset, and so is the mark
 * in the header: these pages carry no client JavaScript and fetch no images, so
 * a single document is the whole payload and there is no second request to get
 * wrong. The favicon is the one exception, and it is not really one — the
 * browser asks for that on its own, from a route that answers without touching
 * the database (see `brand.ts` and the icon routes in `../index.ts`).
 */
import { html, raw, type Html } from "./html.js";
import { FAVICON_LINKS, MARK_INLINE } from "./brand.js";

const STYLES = `
:root {
  --bg:#101317; --col:#171b21; --col-2:#1c2129; --line:#262c35; --line-2:#202630;
  --ink:#e6ebf1; --muted:#949ead; --faint:#6b7583;
  --now:#ffa657; --next:#79c0ff; --later:#b39aff; --done:#56d364; --gone:#ff7b72; --none:#8b949e;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
a:hover{text-decoration:underline}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:1280px;margin:0 auto;padding:0 22px 90px}
header.top{border-bottom:1px solid var(--line);background:var(--col)}
.top-in{max-width:1280px;margin:0 auto;padding:13px 22px;display:flex;align-items:center;gap:16px}
.logo{width:24px;height:24px;display:block;flex:none}
.brand{font-weight:700;letter-spacing:-.01em}
.ws{color:var(--faint);font-size:13px}
.top nav{margin-left:auto;display:flex;gap:18px;align-items:center;color:var(--muted);font-size:13px}
.top nav a:hover{color:var(--ink)}
.avatar{width:26px;height:26px;border-radius:50%;background:#2d3440;display:grid;place-items:center;
  font-size:11px;font-weight:700;color:var(--ink)}
.crumb{color:var(--faint);font-size:13px;padding:20px 0 0}
h1{font-size:25px;letter-spacing:-.02em;margin:8px 0 6px;font-weight:650}
.sub{color:var(--muted);margin:0 0 24px}
h2{font-size:12px;font-weight:650;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:32px 0 12px}
.board{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;align-items:start}
.lane{background:var(--col);border:1px solid var(--line);border-radius:12px;padding:10px;min-height:120px}
.lane-hd{display:flex;align-items:center;gap:7px;padding:2px 4px 10px}
.dot{width:8px;height:8px;border-radius:50%}
.lane-hd .nm{font-size:12px;font-weight:650;letter-spacing:.1em;text-transform:uppercase}
.lane-hd .ct{margin-left:auto;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.lane.now .dot{background:var(--now)}.lane.now .nm{color:var(--now)}
.lane.next .dot{background:var(--next)}.lane.next .nm{color:var(--next)}
.lane.later .dot{background:var(--later)}.lane.later .nm{color:var(--later)}
.lane.unscheduled .dot{background:var(--none)}.lane.unscheduled .nm{color:var(--none)}
.lane.done .dot{background:var(--done)}.lane.done .nm{color:var(--done)}
.lane.abandoned .dot{background:var(--gone)}.lane.abandoned .nm{color:var(--gone)}
.pcard{display:block;background:var(--col-2);border:1px solid var(--line-2);border-radius:9px;
  padding:11px 12px;margin-bottom:8px}
.pcard:hover{border-color:#3a434f;background:#212832;text-decoration:none}
.pcard .t{font-weight:550;line-height:1.4;font-size:13.5px}
.pcard .id{color:var(--faint);font-size:11px;margin-bottom:5px}
.pcard .bar{display:flex;gap:4px;margin-top:10px}
.seg{height:3px;border-radius:2px;flex:1;background:#2b323c}
.seg.on{background:var(--now)}.seg.on.g{background:var(--done)}
.pcard .mm{display:flex;gap:10px;margin-top:8px;color:var(--faint);font-size:11px}
.lane-empty{color:var(--faint);font-size:12px;padding:8px 4px 4px}
.legend{color:var(--faint);font-size:12px;margin-top:14px;max-width:900px}
.split{display:grid;grid-template-columns:210px 1fr;gap:26px;align-items:start}
.rail{position:sticky;top:20px;border-left:2px solid var(--line)}
.step{position:relative;padding:0 0 22px 20px;color:var(--muted);font-size:13px}
.step::before{content:"";position:absolute;left:-7px;top:5px;width:12px;height:12px;border-radius:50%;
  background:var(--bg);border:2px solid var(--line)}
.step.done::before{background:var(--done);border-color:var(--done)}
.step.here::before{background:var(--now);border-color:var(--now);box-shadow:0 0 0 4px rgba(255,166,87,.16)}
.step.here{color:var(--ink);font-weight:600}
.step small{display:block;color:var(--faint);font-weight:400;font-size:11px;margin-top:1px}
.panel{background:var(--col);border:1px solid var(--line);border-radius:12px}
.panel+.panel{margin-top:12px}
.panel .hd{padding:12px 16px;border-bottom:1px solid var(--line-2);font-size:12px;font-weight:650;
  letter-spacing:.1em;text-transform:uppercase;color:var(--faint);display:flex;gap:8px}
.panel .hd .r{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:400}
.panel .pad{padding:16px}
.prose{white-space:pre-wrap;color:#ccd4de}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:650;
  text-transform:uppercase;letter-spacing:.04em;border:1px solid}
.badge.now,.badge.open{color:var(--now);border-color:rgba(255,166,87,.35);background:rgba(255,166,87,.1)}
.badge.next,.badge.shipped{color:var(--next);border-color:rgba(121,192,255,.35);background:rgba(121,192,255,.1)}
.badge.later{color:var(--later);border-color:rgba(179,154,255,.35);background:rgba(179,154,255,.1)}
.badge.done{color:var(--done);border-color:rgba(86,211,100,.35);background:rgba(86,211,100,.1)}
.badge.unscheduled{color:var(--none);border-color:#333b45;background:#1b2028}
.badge.abandoned,.badge.dropped{color:var(--gone);border-color:rgba(255,123,114,.35);background:rgba(255,123,114,.1)}
.att{display:grid;grid-template-columns:106px 1fr;gap:12px;padding:12px 16px;
  border-bottom:1px solid var(--line-2);align-items:center}
.att:last-child{border-bottom:0}
.att.out .t{color:var(--faint);text-decoration:line-through}
.ev{padding:14px 16px;border-bottom:1px solid var(--line-2)}
.ev:last-child{border-bottom:0}
.ev .why{color:var(--now);font-size:13px}
.ev .q{color:#ccd4de;margin-top:6px}
.ev .m{color:var(--faint);font-size:11px;margin-top:7px}
.kv{display:grid;grid-template-columns:126px 1fr;gap:8px 14px}
.kv b{color:var(--faint);font-weight:500;font-size:12px}
.empty{border:1px dashed var(--line);border-radius:12px;padding:20px;text-align:center;color:var(--faint)}
.form{max-width:400px}
.form label{display:block;font-size:12px;color:var(--muted);margin:14px 0 6px}
.form input{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;
  background:var(--col-2);color:var(--ink);font:inherit}
.form input:focus{outline:2px solid var(--now);outline-offset:1px}
.btn{display:inline-block;border:0;background:linear-gradient(140deg,var(--now),var(--later));
  color:#0d1014;border-radius:8px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer}
.btn.plain{background:none;border:1px solid var(--line);color:var(--ink);font-weight:500}
.btn.danger{background:none;border:1px solid rgba(255,123,114,.4);color:var(--gone);font-weight:500}
.notice{border:1px solid rgba(255,166,87,.35);background:rgba(255,166,87,.08);color:var(--ink);
  border-radius:10px;padding:12px 14px;margin:0 0 18px;max-width:640px}
.notice.bad{border-color:rgba(255,123,114,.4);background:rgba(255,123,114,.08)}
.notice code{word-break:break-all}
.row-inline{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.linkish{background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer}
.linkish:hover{color:var(--ink);text-decoration:underline}
.docs{grid-template-columns:250px 1fr}
.docnav{position:sticky;top:20px;display:flex;flex-direction:column;gap:2px;font-size:12px}
.docnav-item{padding:5px 9px;border-radius:7px;color:var(--muted);word-break:break-all}
.docnav-item:hover{background:var(--col);color:var(--ink);text-decoration:none}
.docnav-item.here{background:var(--col-2);color:var(--ink);font-weight:600}
.doc .pad{padding:10px 30px 30px}
.doc h1,.doc h2,.doc h3{color:var(--ink);text-transform:none;letter-spacing:-.01em}
.doc h2{font-size:19px;font-weight:650;margin:30px 0 10px;border-top:1px solid var(--line-2);padding-top:22px}
.doc h3{font-size:15px;font-weight:650;margin:22px 0 8px}
.doc p,.doc li{color:#ccd4de}
.doc a{color:var(--next);text-decoration:underline;text-underline-offset:2px}
.doc code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;
  background:var(--col-2);border:1px solid var(--line-2);border-radius:5px;padding:1px 5px}
.doc pre{background:var(--col-2);border:1px solid var(--line-2);border-radius:9px;padding:13px 15px;overflow-x:auto}
.doc pre code{background:none;border:0;padding:0}
.doc table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}
.doc th,.doc td{border:1px solid var(--line-2);padding:7px 10px;text-align:left;font-size:13px}
.doc th{color:var(--faint);font-weight:600}
.doc blockquote{border-left:2px solid var(--line);margin:0;padding-left:14px;color:var(--muted)}
.doc hr{border:0;border-top:1px solid var(--line-2);margin:26px 0}
/* ── the public homepage ──────────────────────────────────────────────────
   Its own skin, and deliberately not the app's. The app is cool blue-grey
   because it is a tool you sit inside; this is the one page that has to have
   a voice, and it borrows the one the sibling product already established
   (agentgit.zabaca.com, in zbc's walgit template): a warm off-black ground,
   copper for the live thing and verdigris — what copper becomes with age —
   for the settled one, mono headings against serif prose.

   What it does NOT borrow is the two webfonts. Every page here fetches
   nothing: the document is the whole payload, so JetBrains Mono and
   Newsreader would be the first external request on the deployment. The
   fallback stacks carry the same pairing — a real monospace against Georgia
   — and cost no round trip. */
body.land-page{
  --l-ground:#14100e; --l-raised:#1c1815; --l-sunk:#0e0b0a;
  --l-rule:#2e2723; --l-rule-2:#423831;
  --l-bone:#ede6de; --l-muted:#a79b90; --l-faint:#8f847a;
  --l-copper:#c56a3e; --l-verdi:#4e9e8b;
  --l-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --l-serif:Georgia,"Times New Roman",serif;
  background:var(--l-ground);color:var(--l-bone);font-family:var(--l-mono)}
body.land-page header.top{background:var(--l-sunk);border-bottom-color:var(--l-rule)}
body.land-page .top nav{color:var(--l-muted)}
body.land-page .top nav a:hover{color:var(--l-bone)}
body.land-page .wrap{max-width:62rem;padding:0 clamp(1.15rem,5vw,2rem) 4rem}
.land ::selection{background:var(--l-copper);color:var(--l-sunk)}
.land a{color:var(--l-verdi);text-underline-offset:3px}
.land a:hover{color:var(--l-copper)}
/* Visible only once focused — a keyboard user should not tab the furniture
   to reach the command. */
.land-skip{position:absolute;clip-path:inset(50%);left:0;top:0;background:var(--l-copper);
  color:var(--l-sunk);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;
  padding:.8rem 1.1rem;z-index:2}
.land-skip:focus{clip-path:none}
.land-badge{display:inline-block;font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--l-muted);border:1px solid var(--l-rule-2);padding:.32rem .6rem;margin:0 0 2rem}
.land h1{font-family:var(--l-mono);font-weight:700;font-size:clamp(2.1rem,7.6vw,4rem);
  line-height:1;letter-spacing:-.045em;margin:0 0 1.5rem;text-wrap:balance;color:var(--l-bone)}
.land h1 .dot{color:var(--l-copper)}
.land-lede{font-family:var(--l-serif);font-size:clamp(1.15rem,2.9vw,1.5rem);line-height:1.5;
  color:var(--l-bone);max-width:38ch;margin:0 0 2.5rem}
.land-lede em{font-style:normal;color:var(--l-copper)}
.land section{margin-top:5rem}
.land h2{font-family:var(--l-mono);font-weight:700;font-size:clamp(1.35rem,4vw,1.85rem);
  letter-spacing:-.03em;margin:0 0 1rem;text-transform:none;color:var(--l-bone);text-wrap:balance}
.land h2 .dot{color:var(--l-copper)}
.land section p{font-family:var(--l-serif);font-size:1.08rem;line-height:1.62;
  color:var(--l-muted);max-width:58ch;margin:0 0 1.25rem}
.land section p strong{color:var(--l-bone);font-weight:400}
.land section p em{font-style:italic;color:var(--l-faint)}
/* The prose and the command it describes are read together or not at all. */
.land-split{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);
  gap:0 2.5rem;align-items:start}
/* A grid item defaults to min-width:auto, so a track cannot shrink below its
   content's min-content width — and the terminal blocks are pre-formatted.
   Without this the track grows instead of the block scrolling, and the whole
   page pans sideways on a phone. */
.land-split>*,.land-show>*,.land-rules li,.land-road li{min-width:0}
.land-split-say p{max-width:46ch;margin-bottom:1rem}
.land-show{display:grid;gap:1.5rem;align-content:start}
.land-sh{background:var(--l-sunk);border:1px solid var(--l-rule);padding:.85rem 1rem;
  overflow-x:auto;font-family:var(--l-mono);font-size:.78rem;line-height:1.8}
.land-cmd{white-space:pre-wrap;word-break:break-word;color:var(--l-bone)}
.land-p{color:var(--l-copper);user-select:none}
.land-out{white-space:pre-wrap;color:var(--l-muted)}
.land-out .hi{color:var(--l-verdi)}
.land section p.land-under{font-family:var(--l-mono);font-size:.66rem;letter-spacing:.1em;
  text-transform:uppercase;color:var(--l-faint);margin:.7rem 0 0;max-width:none}
/* The rules, as terms rather than bullets: the label is the name of the rule,
   and the prose is what it costs you. */
.land-rules{list-style:none;margin:0;padding:0;display:grid;gap:0;
  border-top:1px solid var(--l-rule)}
.land-rules li{border-bottom:1px solid var(--l-rule);padding:1.05rem 0;display:grid;
  grid-template-columns:9.5rem 1fr;gap:0 1.5rem;align-items:baseline}
.land-rules .k{font-size:.68rem;letter-spacing:.13em;text-transform:uppercase;color:var(--l-verdi)}
.land-rules .v{color:var(--l-muted);font-family:var(--l-serif);font-size:1rem;line-height:1.6}
.land-rules .v b{color:var(--l-bone);font-weight:400}
.land-rules .v code{font-family:var(--l-mono);font-size:.82rem;color:var(--l-verdi)}
/* Rules drawn by the container's background showing through a 1px gap. */
.land-road{list-style:none;margin:0 0 1.5rem;padding:0;display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--l-rule);
  border:1px solid var(--l-rule)}
.land-road li{background:var(--l-ground);padding:1.35rem 1.5rem;display:grid;gap:.5rem;
  align-content:start}
.land-road .k{font-size:.66rem;letter-spacing:.13em;text-transform:uppercase;color:var(--l-faint)}
.land-road .t{font-family:var(--l-mono);font-weight:700;color:var(--l-bone);font-size:.95rem}
.land-road .d{font-family:var(--l-serif);color:var(--l-muted);font-size:.98rem;line-height:1.55}
.land-foot{margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--l-rule);
  font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--l-faint)}
.land-foot code{font-family:var(--l-mono);text-transform:none;letter-spacing:0;
  color:var(--l-verdi)}
.land-foot p{margin:0 0 .6rem}
.land-foot .plain{text-transform:none;letter-spacing:0;font-family:var(--l-serif);
  font-size:.95rem;color:var(--l-muted);max-width:58ch;line-height:1.55}
.land-btn{display:inline-block;font-family:var(--l-mono);font-size:.78rem;letter-spacing:.06em;
  text-transform:uppercase;border:1px solid var(--l-rule-2);color:var(--l-bone);
  padding:.7rem 1.1rem;background:none}
.land-btn:hover{border-color:var(--l-copper);color:var(--l-copper);text-decoration:none}
.land-btn.go{border-left:2px solid var(--l-copper)}
.land-cta{display:flex;gap:.7rem;flex-wrap:wrap;margin:0}
@media (max-width:820px){
  .land-split{grid-template-columns:minmax(0,1fr);gap:2rem 0}
  .land-rules li{grid-template-columns:1fr;gap:.3rem}
  .land-road{grid-template-columns:1fr}
  .land section p.land-under{max-width:none}
  .land section{margin-top:3.25rem}
}
@media (max-width:1080px){.board{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:800px){.board{grid-template-columns:1fr}.split{grid-template-columns:1fr}
  .rail{position:static}.kv{grid-template-columns:1fr}}
`;

export type Viewer = { id: string; name: string; email: string | null };

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0]!)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * Wrap page content in the signed-in shell. `viewer` is null on the pages that
 * exist precisely because there is no session yet (sign-in, invite).
 */
export function page(opts: {
  title: string;
  viewer: Viewer | null;
  workspace: string;
  body: Html;
  /**
   * A class on `<body>`, so a page can own the ground it is painted on. The
   * homepage is the only caller: it is the one page with its own palette, and
   * the page background is set on `<body>` rather than inside the content.
   */
  bodyClass?: string;
}): Html {
  const nav = opts.viewer
    ? html`<nav>
        <a href="/">Workstreams</a>
        <a href="/docs">Docs</a>
        <a href="/members">Members</a>
        <a href="/tokens">Tokens</a>
        <span class="avatar" title="${opts.viewer.name}">${initials(opts.viewer.name)}</span>
        <form method="post" action="/signout" style="display:contents">
          <button type="submit" class="linkish">Sign out</button>
        </form>
      </nav>`
    : html`<nav>
        <a href="/docs">Docs</a>
        <a href="/signin">Sign in</a>
      </nav>`;

  return html`<html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${opts.title} · Crux</title>
      ${FAVICON_LINKS}
      <style>
        ${raw(STYLES)}
      </style>
    </head>
    <body class="${opts.bodyClass ?? ""}">
      <header class="top">
        <div class="top-in">
          ${MARK_INLINE}<a href="/" class="brand">Crux</a>
          ${opts.viewer ? html`<span class="ws">Workspace · ${opts.workspace}</span>` : ""} ${nav}
        </div>
      </header>
      <div class="wrap">${opts.body}</div>
    </body>
  </html>`;
}

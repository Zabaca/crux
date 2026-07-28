/**
 * The page shell and its stylesheet — the "Funnel" direction signed off on
 * CRUX-6D86GE: Stage columns on the Workstream page and a narrowing rail on the
 * Problem page, so the corpus's central mechanic is what a reader sees first.
 *
 * The stylesheet is inlined rather than served as an asset: these pages carry no
 * client JavaScript and no images, so a single document is the whole payload and
 * there is no second request to get wrong.
 */
import { html, raw, type Html } from "./html.js";

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
.logo{width:24px;height:24px;border-radius:6px;background:linear-gradient(140deg,var(--now),var(--later))}
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
.badge.now{color:var(--now);border-color:rgba(255,166,87,.35);background:rgba(255,166,87,.1)}
.badge.next,.badge.shipped{color:var(--next);border-color:rgba(121,192,255,.35);background:rgba(121,192,255,.1)}
.badge.later,.badge.evaluated{color:var(--later);border-color:rgba(179,154,255,.35);background:rgba(179,154,255,.1)}
.badge.done,.badge.chosen{color:var(--done);border-color:rgba(86,211,100,.35);background:rgba(86,211,100,.1)}
.badge.proposed,.badge.unscheduled{color:var(--none);border-color:#333b45;background:#1b2028}
.badge.rejected,.badge.abandoned{color:var(--gone);border-color:rgba(255,123,114,.35);background:rgba(255,123,114,.1)}
.sol{display:grid;grid-template-columns:106px 1fr;gap:12px;padding:12px 16px;
  border-bottom:1px solid var(--line-2);align-items:center}
.sol:last-child{border-bottom:0}
.sol.out .t{color:var(--faint);text-decoration:line-through}
.ev{padding:14px 16px;border-bottom:1px solid var(--line-2)}
.ev:last-child{border-bottom:0}
.ev .why{color:var(--now);font-size:13px}
.ev .q{color:#ccd4de;margin-top:6px}
.ev .m{color:var(--faint);font-size:11px;margin-top:7px}
.kv{display:grid;grid-template-columns:126px 1fr;gap:8px 14px}
.kv b{color:var(--faint);font-weight:500;font-size:12px}
.strike{color:var(--faint);text-decoration:line-through}
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
}): Html {
  const nav = opts.viewer
    ? html`<nav>
        <a href="/">Workstreams</a>
        <a href="/members">Members</a>
        <a href="/tokens">Tokens</a>
        <span class="avatar" title="${opts.viewer.name}">${initials(opts.viewer.name)}</span>
        <a href="/signout">Sign out</a>
      </nav>`
    : html`<nav></nav>`;

  return html`<html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${opts.title} · Crux</title>
      <style>
        ${raw(STYLES)}
      </style>
    </head>
    <body>
      <header class="top">
        <div class="top-in">
          <span class="logo"></span><a href="/" class="brand">Crux</a>
          <span class="ws">Workspace · ${opts.workspace}</span>
          ${nav}
        </div>
      </header>
      <div class="wrap">${opts.body}</div>
    </body>
  </html>`;
}

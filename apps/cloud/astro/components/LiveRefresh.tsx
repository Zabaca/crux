/**
 * The subscription, on its own, for a page that has nothing else to hydrate.
 *
 * The four data pages are server-rendered documents: the island holds no copy
 * of the corpus, so the way to show what an agent just filed is to re-read the
 * page. That is the same move `ActionBar` makes after its own write, and the
 * same one `RoadmapBoard` makes on a frame — this component is it without a
 * view attached, which is what lets a page carry live refresh and still ship no
 * markup of its own.
 *
 * `workstreamId` is what keeps that from being noise. Agents run several
 * Workstreams in parallel against one Principal, so a page showing one of them
 * hears only about that one; without it every frame in the corpus would reload
 * a page none of it touched.
 */
import { useEffect } from "react";

import { onViewStateChange } from "../lib/dispatch.js";

export default function LiveRefresh({ workstreamId }: { workstreamId?: string }) {
  useEffect(
    () => onViewStateChange(() => location.reload(), workstreamId ? { workstreamId } : {}),
    [workstreamId],
  );
  return null;
}

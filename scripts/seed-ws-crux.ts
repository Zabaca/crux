#!/usr/bin/env bun
/**
 * Seed WS-crux with real entries from the source doc.
 *
 * Mirrors the prose from the "Crux — Real Entries" discovery document.
 * Structural relationships (Evidence, Elimination, Decision) fire through
 * the real transition functions so the seed doubles as an end-to-end smoke
 * test of the transition invariants.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../packages/core/src/db/client.ts";
import {
  users,
  workstreams,
  observations,
  problems,
  evidence,
  solutions,
} from "../packages/core/src/db/schema.ts";
import { createDecision } from "../packages/core/src/transitions/decision.ts";
import { createElimination } from "../packages/core/src/transitions/elimination.ts";

const SEED_USER_ID = "USR-james";
const SEED_USER_SLUG = "james";

type ObsSeed = {
  n: string;
  title: string;
  sourceType:
    | "internal"
    | "competitive"
    | "external"
    | "analysis"
    | "customer_report"
    | "metric_signal";
  content: string;
  tags: ReadonlyArray<string>;
  source?: string;
};

const OBSERVATIONS: ReadonlyArray<ObsSeed> = [
  {
    n: "001",
    title: "Discovery thinking vanishes when conversations end",
    sourceType: "internal",
    content:
      "Product discovery happens in Claude Code conversations. The thinking is high-quality in the moment but doesn't persist as structured state. Each new conversation restarts cold — prior decisions, rationale, and context have to be reconstructed from memory or re-derived.",
    tags: ["discovery", "persistence", "claude-code"],
  },
  {
    n: "002",
    title: "Self-imposed cap on new client work due to framework gap",
    sourceType: "internal",
    content:
      "4 active client product engagements with more in early stages. James is deliberately not taking on more until a structural framework exists, because adding a 5th engagement without one would compound the disorder past the point of recovery. The gap is a real constraint on growth, not a theoretical concern.",
    tags: ["growth-constraint", "multi-project"],
  },
  {
    n: "003",
    title: "Modesk: concrete forcing instance (historical)",
    sourceType: "internal",
    content:
      "Modesk client engagement starting with no product foundation done, Monday deadline for problem statement and project plan. James planned discovery over the weekend, wanting output to land in a structured system afterwards rather than becoming another scattered doc. Update (2026-04-21): Modesk was eliminated as an engagement after competitive research concluded the market was too crowded. The forcing function this Observation captured has released, but it did its job — it put Crux's design on the critical path at the right time. Kept as historical record; pressure now comes from the pipeline generally (see Decision context in DEC-001), not from any single engagement.",
    tags: ["modesk", "forcing-function", "historical"],
  },
  {
    n: "004",
    title: "Documentation scattered per project, no consistent structure",
    sourceType: "internal",
    content:
      "Across the 4 active engagements, product documentation is shaped by whatever was improvised that week. No consistent structure means projects can't be compared side-by-side, and there's no way to audit which ones have a defined direction vs. which are drifting.",
    tags: ["inconsistency", "multi-project", "audit-gap"],
  },
  {
    n: "005",
    title: "Notion has a hosted MCP server for Claude Code",
    sourceType: "competitive",
    content:
      "Notion ships a hosted MCP server explicitly designed for Claude Code, Cursor, ChatGPT, etc. OAuth authentication, full workspace read/write, tailored tools rather than 1:1 API mapping. Notion databases give typed structure if schemas are enforced. Multi-workspace supported. Free tier covers solo use; paid starts ~$10/user/mo. Strongest off-the-shelf candidate by the three-filter test.",
    tags: ["research", "notion", "mcp", "viable"],
    source:
      "developers.notion.com/docs/mcp; notion.com/blog/notions-hosted-mcp-server-an-inside-look",
  },
  {
    n: "006",
    title: "Linear MCP covers execution, not upstream product thinking",
    sourceType: "competitive",
    content:
      "Linear has a mature MCP server. February 2026 update added initiatives, project milestones, and project updates. Good for execution coordination. But Linear's primitives (issues, projects, initiatives, cycles) are execution-first — there's no native Problem/Evidence/Solution/Decision/Outcome concept. Using Linear as the backend means bending its model to fit ours, which is the friction we explicitly wanted to avoid.",
    tags: ["research", "linear", "mcp", "shape-mismatch"],
    source: "linear.app/changelog/2026-02-05-linear-mcp-for-product-management",
  },
  {
    n: "007",
    title: "Productboard fits shape but not economics",
    sourceType: "competitive",
    content:
      "Productboard has strong REST API v2 with OAuth, and structured primitives (features, objectives, initiatives, notes, products) that map reasonably to what we want. But no MCP server, and Pro pricing is $59/maker/month billed annually (API access requires Pro+). Floor of $700+/year for solo use. Cost/value doesn't work for single-user; only viable when team is large enough to amortize.",
    tags: ["research", "productboard", "too-expensive"],
    source: "developer.productboard.com; userjot.com pricing analysis",
  },
  {
    n: "008",
    title: "Obsidian + MCP works but returns to markdown-with-convention",
    sourceType: "competitive",
    content:
      'Multiple Obsidian MCP plugins exist (iansinnott/obsidian-claude-code-mcp, StevenStavrakis/obsidian-mcp). Claude Code auto-discovers vaults. Dataview plugin enables structured queries over frontmatter. But fundamentally this is markdown-with-frontmatter — the exact "loose structure" path rejected earlier in design. Choosing this would be backtracking.',
    tags: ["research", "obsidian", "mcp", "rejected-earlier"],
  },
  {
    n: "009",
    title: "Dovetail is research-repository shape, wrong domain",
    sourceType: "competitive",
    content:
      "Dovetail has an API and rich structured data (tags, highlights, insights over interview data). But its shape is user-research synthesis — turning interview transcripts into findings — not product-thinking lifecycle (Problem → Solution → Decision → Outcome). Adjacent domain, wrong primitives. No MCP.",
    tags: ["research", "dovetail", "wrong-domain"],
  },
  {
    n: "010",
    title: "Aha! has closest entity model but wrong economics and no native MCP",
    sourceType: "competitive",
    content:
      "Aha! has the most product-thinking-shaped entity model of any tool evaluated: features, initiatives, goals, releases, requirements, ideas portal. Closer to Crux's model than Productboard or Notion. Robust REST API with libraries for Java/Python/JS/Ruby. No official MCP server — third-party MCP exists via Improvado (paid middleware layer), not a direct solution. Pricing ~$59/user/month floor, similar to Productboard's Pro tier; economically unjustified for solo use. Category-level workflow-enforcement limitation applies as with all off-the-shelf tools. Corrects earlier sloppy dismissal.",
    tags: ["research", "aha", "closest-shape", "too-expensive"],
  },
  {
    n: "011",
    title: "Roadmunk is cheaper but roadmap-visualization shape, not product-thinking",
    sourceType: "competitive",
    content:
      "Roadmunk (now Roadmunk by Tempo) starts at $19/user/month — cheaper than Productboard/Aha. Has an API at all paid tiers. No MCP server, official or third-party. But the entity model is roadmap-visualization-first (timelines, swimlanes, portfolio views with feedback collection), not problem-definition-first. Missing native primitives for Problems, Evidence, Decisions, Outcomes. Shape mismatch. Category-level workflow-enforcement limitation applies. Corrects earlier sloppy dismissal.",
    tags: ["research", "roadmunk", "roadmap-tool", "shape-mismatch"],
  },
];

const EVIDENCE_NOTES: Record<string, string> = {
  "001": "Direct naming of the core gap — conversation thinking doesn't persist.",
  "002": "Establishes urgency and stakes — the gap is constraining business growth.",
  "003": "Concrete forcing instance making the gap immediate, not abstract.",
  "004":
    "Establishes the multi-project dimension — inconsistency across engagements is part of the gap.",
  "005": "Names a viable off-the-shelf path (Notion backend) — informs the build-vs-buy Decision.",
  "006": "Eliminates Linear as a storage candidate — shape mismatch with entity model.",
  "007": "Eliminates Productboard for solo use — economics.",
  "008": "Eliminates Obsidian — returns to rejected markdown-with-convention approach.",
  "009": "Eliminates Dovetail — wrong domain shape.",
  "010": "Eliminates Aha! — closest shape but economics unjustified for solo; no native MCP.",
  "011":
    "Eliminates Roadmunk — cheaper tier but roadmap-visualization shape, not product-thinking primitives.",
};

const PROBLEM_DESCRIPTION = [
  "Description: Product discovery happens in Claude Code conversations, which produce high-quality thinking in the moment but no persistent structured state. Each new conversation restarts cold. Decisions and rationale fade. There's no cross-project view of where engagements actually stand. The need is a structured residue layer that (a) captures the output of conversations as we go, (b) reloads cleanly into future conversations as model-shaped context (not prose to re-parse), and (c) makes parallel engagements comparable so drift is visible.",
  "",
  "Impact: Bottlenecks growth (won't take new clients without it). Wastes thinking (loses the conclusions of past sessions). Prevents cross-project audit.",
  "",
  "Scope: All workstreams, acute for client engagements.",
  "",
  "Constraints: Capture must happen *during* conversation flow at natural pause points, not as end-of-session ceremony, or it won't happen. Reload must be Claude-shaped, not human-shaped.",
].join("\n");

type SolSeed = {
  slug: string;
  title: string;
  description: string;
  effort: "S" | "M" | "L" | "XL";
};

const SOLUTIONS: ReadonlyArray<SolSeed> = [
  {
    slug: "research-existing",
    title: "Research off-the-shelf tools against PRB-thinking-residue-gap's specific requirements",
    description:
      "Evaluate existing tools — PM platforms (Productboard, Aha, Roadmunk, Dovetail), knowledge tools (Notion, Coda, Obsidian, Capacities), AI-native note tools (Mem, Reflect, Granola), hybrid PM (Linear Initiatives, Height, Shortcut) — against a sharp filter: (a) does it support Claude Code as a first-class read/write surface, (b) does it capture structured residue (not just prose), (c) does it support multi-workstream audit. Expected to eliminate most candidates instantly; output is a short list (possibly zero) plus a written finding on why each failed the filter. Findings filed as OBS-005 through OBS-011. Clean pass: Notion (hosted MCP for Claude Code, cheap, structured via databases) — later eliminated on workflow-enforcement grounds. Shape-mismatch: Linear (execution-first vocabulary), Roadmunk (roadmap-visualization primitives). Economics-fail: Productboard ($59+/maker/month Pro gating), Aha! ($59+/user, closest entity model but no native MCP). Backtrack: Obsidian (returns to markdown-with-convention). Wrong domain: Dovetail (research repository shape).",
    effort: "S",
  },
  {
    slug: "build-crux",
    title: "Build Crux custom per existing design",
    description:
      "Bun + TS + libSQL stack, Drizzle ORM, Zod validation, CLI + SKILL.md, entity model (Workstream, Observation, Idea, Problem, Evidence, Solution, Elimination, Decision, Outcome, Theme). Single-tenant MVP with path to Turso embedded replicas when team joins. UI (Next.js on Vercel) as phase 2 addition after CLI + skill prove the model. Detail in prior design notes.",
    effort: "L",
  },
  {
    slug: "hybrid-existing-storage",
    title: "Notion as storage backend, custom skill enforcing entity model on top",
    description:
      "Use Notion databases as the storage layer for entities (one database per type: Observations, Problems, Solutions, etc.). Notion's hosted MCP server handles Claude Code integration — no MCP to build. A custom skill teaches Claude the entity model, invariants, and workflow patterns (inline-propose-during-conversation, Claude-shaped reload, audit). Strict database schemas enforce structure. Human-viewable UI comes free via Notion. Trade-offs: schema changes go through Notion's UI (not drizzle-kit migrations); no true FK enforcement (Notion relations are softer than SQL FKs); performance and query expressiveness limited by Notion API. Refined from research (OBS-005).",
    effort: "M",
  },
  {
    slug: "status-quo",
    title: "Continue with scattered docs, accept the growth cap",
    description:
      "Do nothing structural. Keep managing active client engagements with current per-project improvisation, don't take on more. Named explicitly so the Decision is honest about what's being rejected. The cost is real (growth constraint, continued thinking-loss) but so is the cost of building.",
    effort: "S",
  },
];

const ELIM_001_RATIONALE =
  "The core thesis of Crux is opinionation enforced by code — workflow transitions as invariants, not documentation. No off-the-shelf tool examined can enforce workflow transitions as code: Notion can't (blank canvas with a template on top; \"I can start modifying willy nilly\" applies equally to human and AI use). Linear can't and has the wrong vocabulary anyway (execution-first). Productboard can't and is economically unjustified at $59+/maker/month for solo use. Aha! has the closest entity model (initiatives/goals/requirements/ideas) but same $59+/user economics and no native MCP. Roadmunk is cheaper ($19/user) but roadmap-visualization shape, missing Problem/Evidence/Decision primitives. Obsidian + plugins returns to markdown-with-convention, the path rejected earlier. Dovetail is the wrong domain (research repository, not product-thinking lifecycle). Three common counter-arguments for buying over building collapse on examination: free UI — marginal with Claude Code generating scaffolding; zero infra — marginal with Vercel+Turso; skill-work saved — zero, since both paths require equivalent skill-layer development.";

const ELIM_001_CONTEXT =
  "SOL-build-crux and SOL-status-quo remain proposed. Decision between them deferred until further signal (likely informed by Modesk weekend experience). Other tools in the category (Linear, Productboard, Aha!, Roadmunk, Obsidian, Dovetail) not filed as individual Solutions — their research findings in OBS-005 through OBS-011 carry the trail. If any of those tools materially changes (e.g., Aha drops pricing and adds native MCP, Notion adds workflow enforcement), this Elimination could be revisited with a new Solution proposal.";

const DEC_001_RATIONALE =
  "The framework gap is pipeline-level, not engagement-specific. Modesk being eliminated as a market doesn't reduce the pressure because the pressure comes from the flow of incoming work, not from any single active project. Off-the-shelf category closed (ELIM-001). Status quo's cost (continued drift, self-imposed cap on new clients, thinking lost to each cold conversation start) compounds with each new engagement; build cost pays back across the pipeline. Absence of a forcing deadline is a feature, not a bug — permits thoughtful build rather than rushed MVP.";

const DEC_001_CONTEXT =
  "Committed after the Modesk-specific deadline pressure released. Stack, MVP scope, and naming already settled in earlier conversation; those follow-on Decisions to be filed separately as they're re-confirmed during scaffolding.";

async function main() {
  const db = getDb();

  const existing = await db
    .select({ id: workstreams.id })
    .from(workstreams)
    .where(eq(workstreams.id, "WS-crux"))
    .limit(1);
  if (existing[0]) {
    console.log(
      "WS-crux already seeded — no-op. Delete the db manually if you want a fresh start.",
    );
    return;
  }

  await db
    .insert(users)
    .values({
      id: SEED_USER_ID,
      slug: SEED_USER_SLUG,
      name: "James",
      email: "james@zabaca.com",
    })
    .onConflictDoNothing();

  await db
    .insert(workstreams)
    .values({
      id: "WS-crux",
      slug: "crux",
      title: "Crux — discovery residue tool",
      description:
        "Structured residue layer for product discovery thinking that happens in Claude Code conversations. Captures conversation output as model-shaped state that reloads into future sessions and supports cross-project audit.",
      ownerId: SEED_USER_ID,
    })
    .onConflictDoNothing();

  for (const obs of OBSERVATIONS) {
    await db
      .insert(observations)
      .values({
        id: `OBS-${obs.n}`,
        workstreamId: "WS-crux",
        reporterId: SEED_USER_ID,
        content: `${obs.title}\n\n${obs.content}`,
        source: obs.source ?? null,
        sourceType: obs.sourceType,
        tags: JSON.stringify([...obs.tags]),
      })
      .onConflictDoNothing();
  }

  await db
    .insert(problems)
    .values({
      id: "PRB-thinking-residue-gap",
      slug: "thinking-residue-gap",
      workstreamId: "WS-crux",
      title: "Discovery thinking has no structured residue across conversations or projects",
      description: PROBLEM_DESCRIPTION,
      lifecycleStatus: "shaping",
      priorityTier: "P0",
      createdById: SEED_USER_ID,
    })
    .onConflictDoNothing();

  for (const obs of OBSERVATIONS) {
    await db
      .insert(evidence)
      .values({
        id: `EVD-${obs.n}`,
        observationId: `OBS-${obs.n}`,
        problemId: "PRB-thinking-residue-gap",
        note: EVIDENCE_NOTES[obs.n],
        createdById: SEED_USER_ID,
      })
      .onConflictDoNothing();
  }

  for (const sol of SOLUTIONS) {
    await db
      .insert(solutions)
      .values({
        id: `SOL-${sol.slug}`,
        slug: sol.slug,
        problemId: "PRB-thinking-residue-gap",
        title: sol.title,
        description: sol.description,
        status: "proposed",
        effort: sol.effort,
        createdById: SEED_USER_ID,
      })
      .onConflictDoNothing();
  }

  // SOL-research-existing is `evaluated`: the research completed (OBS-005..011 filed).
  // Simple state flip, not a transition gate.
  await db
    .update(solutions)
    .set({ status: "evaluated" })
    .where(eq(solutions.id, "SOL-research-existing"));

  await createElimination(
    {
      id: "ELIM-001",
      problemId: "PRB-thinking-residue-gap",
      eliminatedSolutionIds: ["SOL-hybrid-existing-storage"],
      rationale: ELIM_001_RATIONALE,
      context: ELIM_001_CONTEXT,
      eliminatedById: SEED_USER_ID,
    },
    db,
  );

  await createDecision(
    {
      id: "DEC-001",
      problemId: "PRB-thinking-residue-gap",
      chosenSolutionId: "SOL-build-crux",
      rejectedSolutionIds: ["SOL-status-quo"],
      rationale: DEC_001_RATIONALE,
      context: DEC_001_CONTEXT,
      decidedById: SEED_USER_ID,
    },
    db,
  );

  console.log("Seeded WS-crux with real discovery prose.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// How long the actor run itself is allowed to take, in seconds. The suite's
// slowest measured run on 2026-09-22 was 152 s on a seven platform search, so
// 1800 s is roughly twelve times that: headroom for a slow day without letting a
// hung run bill indefinitely.
const ACTOR_RUN_TIMEOUT_SECS = 1800;

// How long this wrapper waits for that run, in milliseconds. The actor's own
// timeout plus two minutes, so the run's own TIMED-OUT status is what the
// caller sees rather than the wrapper giving up first and reporting nothing.
const WRAPPER_WAIT_MS = (ACTOR_RUN_TIMEOUT_SECS + 120) * 1000;
const POLL_INTERVAL_MS = 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it whatever
// the timeout parameter says, so a long run reads as a timeout even though the
// actor goes on to finish. Starting the run, polling it to a terminal status and
// then reading the dataset is the only way to wait as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success. Surfacing it here is what keeps a crashed run from reading
  // as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const server = new McpServer({
  name: "mamba-talent-agency-lookup",
  version: pkg.version,
});

// Influencer Talent Agency Lookup (immutable actor ID zCuX4Mgyg6JvXgGzd)
server.registerTool(
  "lookup_influencer_talent_agency",
  {
    title: "Look Up an Influencer's Talent Agency or an Agency's Roster",
    description:
      "Works in two directions. Creator to agency: pass creator handles or profile URLs and get one row per creator with the talent agency that represents them, its domain, its public contact, and agency_match_method (email_domain_exact, email_domain_parent, public_roster, bio_wording, or no_match with the email domains tried in error_reason). Agency to roster: pass agency domains or agency names and get one row per creator on the agency's public roster, with platform, handle, and profile URL. The agency list is seeded from 13 public directories and holds 143 agencies and 557 roster creators; coverage is partial and every row says how it matched. Supports TikTok, Instagram, YouTube, Pinterest, Twitch, Threads, and podcasts. Charges $0.001 per run plus $0.008 per row returned, $0.004 per agency roster page rendered in the headless browser when render_unreadable_pages is on and the rendered page comes back readable, and $0.01 per Instagram bio fetch when one is needed. Contributes the public records it finds to a shared creator and agency pool that all users of this actor read from, so a later run reads what this one found; `contribute_to_shared_pool` is on by default and turning it off leaves the run reading the pool and writing nothing. Only public data already in the returned rows is contributed, nothing from your Apify account or your input, and a contribution is not charged. Requires an APIFY_TOKEN and consumes Apify credits. Read only.",
    annotations: {
      title: "Look Up an Influencer's Talent Agency or an Agency's Roster",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
    handles: z.array(z.string()).optional().describe("One per line. A profile URL on any supported platform (https://www.tiktok.com/@name, https://www.instagram.com/name/, https://www.youtube.com/@name, a Pinterest, Twitch, or Threads profile, an Apple Podcasts show page, or a Spotify show), or platform:@handle (tiktok:@name). A bare @handle needs `platforms` and is looked up on each listed platform. One entry is a single run; a list is a batch. Duplicates are removed before any fetch."),
    platforms: z.array(z.enum(["tiktok", "instagram", "youtube", "pinterest", "twitch", "threads", "podcast"])).optional().describe("Which platforms a bare @handle is looked up on. A full profile URL carries its own platform and ignores this. This actor does not search; pass the creators you want read. Supported: TikTok, Instagram, YouTube, Pinterest, Twitch, Threads, and podcasts. Not X, not Facebook pages, not LinkedIn."),
    agency_domains: z.array(z.string()).optional().describe("Agency to roster: one domain per line (for example viralnation.com). Returns one row per creator on the agency's public roster."),
    agency_names: z.array(z.string()).optional().describe("Agency to roster by name when you do not have the domain. Exact or partial name match against the list."),
    render_unreadable_pages: z.boolean().optional().describe("Off by default. Some agency roster pages build their talent grid in the browser and return an empty shell to a plain fetch, so the roster reads as empty. Turn this on to render those pages in a headless browser and read the roster from the rendered page. Charged per page rendered (event browser-render) to cover the browser compute, and only when the rendered page comes back readable. A page that answers with a bot challenge is recorded as blocked and is never rendered."),
    escalate_on_block: z.boolean().optional().describe("On by default. A profile fetch that comes back as a bot detection page is retried once over the residential proxy. On Instagram the bio, bio link, and following are read from the profile page over residential when the embed and the datacenter API did not carry them, and a page that comes back readable charges instagram-bio-fetch ($0.010). Uncheck it to never pay that event: a blocked profile then returns a labeled error row, and Instagram rows keep an empty bio and bio link on about half of the reads."),
    batch_size: z.number().int().min(1).max(10).optional().describe("Rows fetched at once. Leave empty for the measured per platform default; the measurement is in the README. Higher is faster and, above the measured point, loses rows."),
    // Shared pool toggle. The actor input field shipped in build 0.1.11; this mirror exists so an
    // MCP caller can turn the contribution off.
    contribute_to_shared_pool: z.boolean().optional().describe("On by default. The run contributes the public records it finds to a shared creator and agency pool that all users of this actor read from, so a later run reads what this one found. Only public data that is already in your own output rows is sent: nothing from your Apify account, your input list, your API keys, or your own notes. Nothing is charged for a contribution. Turn this off and the run still reads the pool and writes nothing to it. Default: true."),
    },
  },
  async (args) =>
    runActor("zCuX4Mgyg6JvXgGzd", "Influencer Talent Agency Lookup", compact(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);

# Influencer Talent Agency Lookup MCP Server

[![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-talent-agency-lookup/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-talent-agency-lookup) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-talent-agency-lookup%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-talent-agency-lookup&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-talent-agency-lookup)](https://www.npmjs.com/package/@mambalabsdev/mcp-talent-agency-lookup) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-talent-agency-lookup)](https://www.npmjs.com/package/@mambalabsdev/mcp-talent-agency-lookup) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-talent-agency-lookup)](https://github.com/mambalabsdev/mcp-talent-agency-lookup/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-talent-agency-lookup)

MCP server for the Mamba Labs [Influencer Talent Agency Lookup](https://apify.com/mambalabs/talent-agency-lookup) actor on Apify.

Creator handles in, the talent agency behind each one out. Or an agency in, its public creator roster out.

## Install

```bash
npx -y @mambalabsdev/mcp-talent-agency-lookup
```

### Claude Desktop

```json
{
  "mcpServers": {
    "mamba-talent-agency-lookup": {
      "command": "npx",
      "args": ["-y", "@mambalabsdev/mcp-talent-agency-lookup"],
      "env": { "APIFY_TOKEN": "your-apify-token" }
    }
  }
}
```

Get an Apify token at [console.apify.com/account/integrations](https://console.apify.com/account/integrations).

## Tools

| Tool | Direction | Inputs |
| --- | --- | --- |
| `lookup_agency_for_creator` | Creator to agency: one row per creator with the agency that represents them | `handles`, `platforms`, `escalate_on_block`, `batch_size`, `contribute_to_shared_pool` |
| `list_agency_roster` | Agency to roster: one row per creator on the agency's public roster | `agency_domains`, `agency_names`, `render_unreadable_pages`, `contribute_to_shared_pool` |
| `lookup_influencer_talent_agency` | Both directions in one call, every actor input | all of the inputs below |

All three call the same actor, so the pricing below applies to each. The two directional tools are the simpler choice when only one direction is needed; the combined tool is kept so existing callers keep working.

### Inputs

| Input | Type | Required | Notes |
| --- | --- | --- | --- |
| `handles` | array | no | One per line. A profile URL on any supported platform (https://www.tiktok.com/@name, https://www.instagram.com/name/, https://www.youtube.com/@name, a Pinterest, Twitch, or Threads profile, an Apple Podcasts show page, or a Spotify show), or platform:@handle (tiktok:@name). A bare @handle needs `platforms` and is looked up on each listed platform. One entry is a single run; a list is a batch. Duplicates are removed before any fetch. |
| `platforms` | array | no | Which platforms a bare @handle is looked up on. A full profile URL carries its own platform and ignores this. This actor does not search; pass the creators you want read. Supported: TikTok, Instagram, YouTube, Pinterest, Twitch, Threads, and podcasts. Not X, not Facebook pages, not LinkedIn. |
| `agency_domains` | array | no | Agency to roster: one domain per line (for example viralnation.com). Returns one row per creator on the agency's public roster. |
| `agency_names` | array | no | Agency to roster by name when you do not have the domain. Exact or partial name match against the list. |
| `render_unreadable_pages` | boolean | no | Off by default. Some agency roster pages build their talent grid in the browser and return an empty shell to a plain fetch, so the roster reads as empty. Turn this on to render those pages in a headless browser and read the roster from the rendered page. Charged per page rendered (event browser-render) to cover the browser compute, and only when the rendered page comes back readable. A page that answers with a bot challenge is recorded as blocked and is never rendered. Default `false`. |
| `escalate_on_block` | boolean | no | On by default. A profile fetch that comes back as a bot detection page is retried once over the residential proxy. On Instagram the bio, bio link, and following are read from the profile page over residential when the embed and the datacenter API did not carry them, and a page that comes back readable charges instagram-bio-fetch ($0.010). Uncheck it to never pay that event: a blocked profile then returns a labeled error row, and Instagram rows keep an empty bio and bio link on about half of the reads. Default `true`. |
| `batch_size` | integer | no | Rows fetched at once. Leave empty for the measured per platform default; the measurement is in the [actor README](https://apify.com/mambalabs/talent-agency-lookup#-batch-or-single). Higher is faster and, above the measured point, loses rows. |
| `contribute_to_shared_pool` | boolean | no | On by default. The run contributes the public records it finds to a shared creator and agency pool that all users of this actor read from, so a later run reads what this one found. Only public data that is already in your own output rows is sent: nothing from your Apify account, your input list, your API keys, or your own notes. Nothing is charged for a contribution. Turn this off and the run still reads the pool and writes nothing to it. Default: true. |

Nothing is required, but a call with no `handles`, no `agency_domains`, and no `agency_names` has nothing to look up and the run fails with a message saying so.

## Pricing

Influencer Talent Agency Lookup is pay per event on Apify. Every price below is flat across the FREE, BRONZE, SILVER, GOLD, PLATINUM, and DIAMOND tiers.

| Event | Charged for | Price | Fires when |
| --- | --- | ---: | --- |
| `actor-start` | Actor start | $0.001 | Once per run, on start. Covers the run overhead. |
| `agency-lookup` | Agency lookup | $0.008 | Once per row returned by the talent agency lookup, in either direction (creator to agency, or agency to a roster creator). |
| `browser-render` | Browser render | $0.004 | Once per agency roster page rendered in the headless browser because the plain fetch returned an empty shell, and only when the rendered page came back readable. Only when `render_unreadable_pages` is on. |
| `instagram-bio-fetch` | Instagram bio fetch | $0.01 | Once per Instagram profile row when the bio, bio link, and following were read from the profile page over the residential proxy and came back readable. Only when `escalate_on_block` is on. |

`apify-actor-start`, the start event Apify adds to pay per event actors by default, is not on this actor's pricing record. The run overhead is billed once per run through the actor's own `actor-start` event above, at $0.001, so a run is never charged for its start twice.

## Reading the output

Every row carries `agency_match_method`: `email_domain_exact`, `email_domain_parent`, `public_roster`, `bio_wording`, or `no_match`. A `no_match` row names the email domains it tried in `error_reason`. Every row also carries `row_status` and `error_reason`, so a creator or an agency the actor could not read comes back as a row saying why, not as a gap in the list. Filter on `row_status` before loading a table.

Coverage is partial by construction. The bundled list held 143 agencies and 557 roster creators when the actor was published, seeded from 13 public directories, and it grows through the shared pool.

## What this actor shares

This run contributes the records it finds to a shared creator and agency pool that all users of this actor read from. What one run finds, the next run can read.

This actor reads the pool before it reads anything else. When the pool is unreachable it falls back to the agency list bundled in the build, so a run never fails on the pool.

The toggle is `contribute_to_shared_pool`. It is a boolean input and it is on by default. Turn it off and the run still reads the pool and writes nothing to it.

**What this actor contributes.** The agency rows and the roster rows read during the run: agency name, domain, public contact, country, classification, roster URL, and one roster row per creator with the platform and the handle.

**Only public data that is already in your own output.** Every field written to the pool is a field this run returned to you, read from a page the platform or the creator publishes to anyone without a login. Nothing from your Apify account, your input list, your API keys, or your own notes is sent. A contribution never deletes anything from the pool.

**What a contribution is labeled with.** The actor ID, the run ID, the pool key issued to the actor build, and a hash of the calling IP address, used for the rate limit and nothing else. Your Apify account and your user ID are not recorded.

**Contributing is free.** No event is charged for a write to the pool. If the pool is unreachable the run finishes as normal, the rows are dropped, and the run log says so.

## Actor

Actor ID `zCuX4Mgyg6JvXgGzd`. The wrapper calls the actor by that immutable ID rather than by its Store slug, so a Store rename never breaks it.

## Suite

| Actor | Actor ID | MCP server |
| --- | --- | --- |
| [Influencer Finder](https://apify.com/mambalabs/creator-finder) | `tpkedmloIIWtXx6sg` | [`@mambalabsdev/mcp-creator-finder`](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-finder) |
| [Influencer Profile Scraper](https://apify.com/mambalabs/creator-profile-reader) | `EqEnklDVMIcB1V499` | [`@mambalabsdev/mcp-creator-profile-reader`](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-profile-reader) |
| [Link in Bio Scraper and Newsletter Detector](https://apify.com/mambalabs/link-in-bio-newsletter-checker) | `OorucdheTIgu7RFzK` | [`@mambalabsdev/mcp-link-in-bio-newsletter-checker`](https://www.npmjs.com/package/@mambalabsdev/mcp-link-in-bio-newsletter-checker) |
| [Influencer Change Monitor](https://apify.com/mambalabs/creator-change-monitor) | `d2VVgahNL6UmcLkhg` | [`@mambalabsdev/mcp-creator-change-monitor`](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-change-monitor) |
| [Influencer Lead List Builder](https://apify.com/mambalabs/creator-lead-list-all-in-one) | `KnmByszcv135yM30G` | [`@mambalabsdev/mcp-creator-lead-list-all-in-one`](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-lead-list-all-in-one) |
| [Influencer Talent Agency Lookup](https://apify.com/mambalabs/talent-agency-lookup) | `zCuX4Mgyg6JvXgGzd` | [`@mambalabsdev/mcp-talent-agency-lookup`](https://www.npmjs.com/package/@mambalabsdev/mcp-talent-agency-lookup) |

Built by [Mamba Labs](https://mambabuilt.com).

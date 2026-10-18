# MoatDefender for Claude Code

Install in one step (Claude Code 2.1.275 or later):

```
/plugin marketplace add patrikjohansson-pixel/moatdefender-open
/plugin install moatdefender --marketplace patrikjohansson-pixel/moatdefender-open
```

## Access: what works without an account, and what needs one

| | Needs | Works today |
|---|---|---|
| Public method tools (`moat_method`, `moat_power`) over MCP | Nothing. No account, no key. | Yes |
| Account tools over MCP (`moat_latest`, `moat_add_evidence`, `moat_reread`, `moat_next_moves`) | Sign-in **and a Pro or Ultra subscription**, plus an API key from your account | Private VIP beta, by invitation |
| Moat CLI (`tools/moat-cli`) and the release action (`tools/github-action`) | Sign-in **and a Pro or Ultra subscription**, API key in the environment | Private VIP beta, by invitation |
| Original Minds Club membership | An application. **Joining the waitlist is free.** Expected waiting time: 3 to 4 weeks. | Yes: [moatdefender.com/apply/membership](https://moatdefender.com/apply/membership) |

Pro and Ultra are a private VIP beta during the founding season; invitations come from the team. Nothing in this repository
computes a Moat Index: readings run on MoatDefender's servers under a closed method, and this code only talks to them.

The plugin connects the public MoatDefender MCP server at `https://moatdefender.com/api/mcp` (tools `moat_method`
and `moat_power`, no account, no key) and adds two skills: `moat-reading` and `moat-ci`. Also in this repository:
`tools/moat-cli` (Node CLI), `tools/codex` (AGENTS snippet and MCP config for Codex) and `tools/github-action`
(release evidence action). The Moat Index method itself runs on MoatDefender's servers and is not in this repository.

The plugin includes `moat-reading` for moat, defensibility, copycat, AI durability and investor discussions, and
`moat-ci` for release evidence and explicitly authorized re-reads. **Task64 account capabilities are a proposed
patch**, pending migration, deployment, real-client acceptance and publication. Nothing here proves an installed
plugin or live account connection.

The default `.mcp.json` has no Authorization header. It connects public `moat_method` and `moat_power` without an
account; it never sends an empty or unresolved bearer value. Account tools in the proposed server are
`moat_latest`, `moat_add_evidence`, `moat_reread` and `moat_next_moves`. The last returns a stored Designer result,
never a newly billed plan. Read access does not grant evidence-write or reading-run permission.

For an owner-authorized account connection **after acceptance**, use the separate `.mcp.auth.example.json` entry
in the owner's Claude Code MCP configuration and provide `MOATDEFENDER_API_KEY` privately in the environment
that starts Claude. The example contains the variable name only, no secret, and is not loaded by the plugin's
default config. Do not enable the account example with an unset variable; retain the public config instead.
Do not put a literal key in JSON or use a CLI header argument containing the key. Claude Code documents
`${VAR}` expansion in HTTP headers; this is not a conditional-header mechanism. Distinct public/account
configurations avoid inventing optional interpolation syntax.
[Claude Code MCP environment reference](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson).

Check actual discovered tools before using any capability. Unavailable tools require an honest limitation and
an offer to explain supplied material or the [methodology](https://moatdefender.com/methodology); never fabricate
a reading. Scoring stays on MoatDefender servers. A new release does not itself increase a Moat Index.
See [CLI commands](tools/moat-cli/README.md) and the [methodology](https://moatdefender.com/methodology).

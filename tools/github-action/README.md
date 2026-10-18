# Release evidence action

**Proposed task64 patch, not a published action.** The reviewed migration/API deployment and a real client test
are prerequisites. `release.example.yml` is deliberately inactive outside this folder; replace its repository
and immutable 40-character commit reference with the reviewed published source before using it.

The composite action uses Node available on the GitHub-hosted runner and the sibling dependency-free CLI module.
It accepts only `release: published` in the owning, non-fork repository. It reads the GitHub event JSON and sends
tag/name/body as evidence. It never evaluates release content, invokes a shell with that content or checks out
release code. Do not adapt it to `pull_request_target`, fork PRs, arbitrary dispatch inputs or an untrusted checkout
with secrets. The example is hosted-runner oriented; use a clean environment on a self-hosted runner.

Inputs are `dossier-id`, `reread` (default `'false'`) and `max-tokens` (default `'0'`). The owner provisions
`MOATDEFENDER_API_KEY` and `GITHUB_TOKEN` via environment secrets. A `read` + `evidence:write` key suffices for
an evidence-only run. Add `reading:run` only for intentional re-reads and set a small monthly key budget.
`contents: write` allows the action to comment on the commit resolved from the published release tag. No PR
checkout or PR issue permissions are required. GitHub/API headers contain no user email.

Default behavior adds evidence and comments `unchanged` with 0 tokens charged. With explicit `reread: 'true'`
and a positive `max-tokens`, the action requests a quote, checks the quoted cost against that ceiling, and sends
`confirm: true` only within the ceiling. A cache hit returns 0 without a confirmed request. The confirmation also sends `maxTokens` for server-side cost-ceiling enforcement, including a pricing change
between quote and confirmation. Both the monthly key
budget and wallet are enforced server-side. The action reports actual cache/completion state and charge.
A new reading currently costs 150 MoatTokens; always use the server's quote.

The commit comment and `result` output contain evidence ID/duplicate state and, only for opted-in re-reads,
reading ID, index, band, range, version and delta. They exclude dossier text and the full private Designer plan.
**Repository readers can see the comment and Actions outputs.** Enable this action only after the owner has
approved exposing those fields; use terminal/MCP account tools for private next moves. A comment failure may
occur after evidence or a paid reading was accepted, so check account status before retrying. Duplicate evidence
and same-method stored readings are reused server-side. This example never posts to an external PR automatically.

Tests use mocked event files, HTTP responses and file outputs; no action publication or real execution occurred.

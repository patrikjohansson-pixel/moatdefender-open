# Moat CLI

**Proposed task64 patch.** This dependency-free Node 20+ client needs the reviewed migration and deployed API v1.
It is a local source deliverable; it has not been published to npm or tested against a real account.

Run `node integrations/moat-cli/moat.mjs help` from the repository root. The local package declares a `moat` bin
for owners who choose to link/install this reviewed folder; no install is required for the Node commands below.
The owner supplies `MOATDEFENDER_API_KEY` privately in the process environment. Do not paste keys into commands,
arguments, source, config, URLs or logs. The CLI does not load dotenv or inspect email/session credentials.
`MOATDEFENDER_URL` can select an owner-trusted HTTPS origin (default `https://moatdefender.com`); paths,
credentials, query strings, HTTP and fragments are rejected. Requests refuse redirects.

```sh
node integrations/moat-cli/moat.mjs status
node integrations/moat-cli/moat.mjs status --dossier <owned-dossier-id>
node integrations/moat-cli/moat.mjs evidence add ./release-notes.md --file --dossier <owned-dossier-id>
node integrations/moat-cli/moat.mjs evidence add 'New customer evidence reviewed for disclosure' --text --dossier <owned-dossier-id>
node integrations/moat-cli/moat.mjs ship --from <previous-tag> --dossier <owned-dossier-id>
node integrations/moat-cli/moat.mjs reread --dossier <owned-dossier-id>
node integrations/moat-cli/moat.mjs reread --confirm --max-tokens <quoted-cost> --dossier <owned-dossier-id>
```

Positional evidence reads an existing file, or treats a missing path as literal text; use `--file` or `--text` to
remove that ambiguity. File contents are shown and need an interactive `yes` before sending (without a TTY it cancels); `--text` sends the typed text as is. Evidence is trimmed and must contain 8–20,000 characters, including at least 8 letters/numbers. It is submitted as an unverified claim; naming
a certificate or attaching release prose does not verify it. No dossier is selected implicitly for writes.

`ship` collects local git commit subjects/bodies since `--from`, otherwise since the nearest local tag. With no
tags it collects history through HEAD. It neither fetches Git nor reads source files/diffs/remotes. Empty notes
and oversized payloads stop locally. The exact JSON payload appears before the interactive `yes` prompt; review
it for private content. Without a TTY it cancels. No `--yes` bypass is provided. Shipping never invokes a reading.

`reread` without `--confirm` asks for a cache result or a cost quote. A quote exits with code 2 and spends nothing;
errors exit 1; completed, cached or cancelled operations exit 0. `--confirm` requires `--max-tokens <quoted-cost>` to authorize at most the accepted quote. A missing/invalid cap
fails locally before HTTP. A zero cap permits only a cache hit. Execution remains subject to scope, wallet and
monthly key budget; a changed canonical cost above the cap fails server-side before any charge or new reading. A new reading currently costs 150 MoatTokens; always use the
server's quote. Same snapshot and method version return a stored reading for 0. Inspect status before retrying an interrupted request:
the server may already have accepted it. A reported index can rise, fall or stay the same. Method changes are
separate series, with old readings preserved. The JSON response includes charge/cache state and stored next
moves only if available; no Designer call is made by this CLI.

Offline verification: `node --test integrations/moat-cli/test/*.test.mjs integrations/github-action/test/*.test.mjs`.
All requests, git collection and interactive confirmation are mocked. See the
[specification](../../docs/v6/09-MOAT-CI.md) and [release example](../github-action/README.md).

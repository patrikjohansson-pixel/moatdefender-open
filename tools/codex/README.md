# Codex source integration

**Proposed patch, no installed Codex plugin or verified client connection.** The same skill text lives at
`../claude-plugin/skills/moat-reading/SKILL.md` and `../claude-plugin/skills/moat-ci/SKILL.md`.
`AGENTS.snippet.md` is an explicit copyable project instruction, not an automatic configuration edit.
The CLI works from either terminal environment after server acceptance; see [commands](../moat-cli/README.md).

Public MCP configuration in an owner-approved Codex `config.toml` needs no credential:

```toml
[mcp_servers.moatdefender]
url = "https://moatdefender.com/api/mcp"
```

For an authorized account connection after migration/deployment/client acceptance, replace that entry with:

```toml
[mcp_servers.moatdefender]
url = "https://moatdefender.com/api/mcp"
bearer_token_env_var = "MOATDEFENDER_API_KEY"
```

The value is an environment variable name, never the key itself. The owner provisions it privately in the
process environment before starting Codex. Omit the bearer setting for public-only use; no conditional TOML
interpolation is assumed. This follows the official OpenAI documentation for
[Streamable HTTP MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). File presence does not
establish connection success; inspect actual discovery and record the client version during acceptance.

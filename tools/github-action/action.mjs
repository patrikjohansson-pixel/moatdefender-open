import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient, validateEvidence, redact } from '../moat-cli/moat.mjs';

export async function runRelease({ env = process.env, read = readFile, append = appendFile, fetchImpl = globalThis.fetch, request, write = (text) => process.stdout.write(`${text}\n`) } = {}) {
  // A published release is the sole trusted trigger. Never execute release text or check out its files.
  if (env.GITHUB_EVENT_NAME !== 'release') throw new Error('Only release: published events are accepted.');
  const event = JSON.parse(await read(env.GITHUB_EVENT_PATH, 'utf8'));
  if (event.action !== 'published' || !event.release || event.release.draft || event.repository?.fork) throw new Error('A published release from the owning repository is required.');
  const repository = event.repository?.full_name;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || repository !== env.GITHUB_REPOSITORY) throw new Error('Repository identity mismatch.');
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN with contents: write is required for the release commit comment.');
  const dossierId = env.MOAT_DOSSIER_ID;
  if (!dossierId) throw new Error('An owned dossier ID is required.');
  if (!['true', 'false'].includes(env.MOAT_REREAD || 'false')) throw new Error('reread must be true or false.');
  const reread = env.MOAT_REREAD === 'true';
  const budget = Number(env.MOAT_MAX_TOKENS || '0');
  if (reread && (!Number.isSafeInteger(budget) || budget < 1)) throw new Error('An explicit positive max-tokens budget is required for reread: true.');
  const text = validateEvidence(`Release ${event.release.tag_name}\n${event.release.name || ''}\n${event.release.body || ''}`);
  const api = request || createClient({ env, fetchImpl });
  const evidence = (await api('/api/v1/evidence', { dossierId, text })).data;
  const result = { evidenceId: evidence.evidenceId, duplicate: evidence.duplicate, readingState: 'unchanged', charged: 0 };
  if (reread) {
    const payload = { dossierId, evidenceId: evidence.evidenceId, confirm: false };
    let reading = await api('/api/v1/readings', payload);
    if (reading.status === 402) {
      if (!Number.isSafeInteger(reading.data.cost) || reading.data.cost > budget || reading.data.cost < 0) throw new Error('Quoted reading cost exceeds the explicit max-tokens budget or is invalid; no reading authorized.');
      reading = await api('/api/v1/readings', { ...payload, confirm: true, maxTokens: budget });
    }
    if (reading.status !== 200 || !reading.data.reading) throw new Error('Reading is not complete; check MoatDefender before retrying.');
    if (typeof reading.data.cached !== 'boolean' || !Number.isSafeInteger(reading.data.charged) || reading.data.charged < 0 || reading.data.charged > budget || (reading.data.cached && reading.data.charged !== 0)) {
      throw new Error('Invalid reading charge/state response; check MoatDefender before retrying.');
    }
    const { id, moatIndex, band, range, rubricVersion, delta } = reading.data.reading;
    Object.assign(result, { readingState: reading.data.cached ? 'cached' : 'completed', charged: reading.data.charged, reading: { id, moatIndex, band, range, rubricVersion, delta } });
  }
  // Comment on the commit pointed to by the published release tag, using GitHub's API only.
  // Release text, refs and server data are never interpolated into a shell command.
  const github = async (path, body) => {
    let response;
    try { response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30_000),
    }); } catch { throw new Error('GitHub request failed; evidence may already be stored.'); }
    if (!response.ok) throw new Error('GitHub request rejected; evidence may already be stored.');
    return response.json();
  };
  const commit = await github(`/commits/${encodeURIComponent(event.release.tag_name)}`);
  if (!/^[a-f0-9]{40}$/.test(commit.sha || '')) throw new Error('GitHub did not resolve the release commit.');
  const sanitized = redact(redact(result, env.MOATDEFENDER_API_KEY), env.GITHUB_TOKEN);
  await github(`/commits/${commit.sha}/comments`, { body: `Moat CI result\n\n\`\`\`json\n${sanitized}\n\`\`\`\n\nShipping alone does not raise the Moat Index. Evidence is a claim until verified. A method-version change starts a separate series.` });
  const output = JSON.stringify(JSON.parse(sanitized));
  if (env.GITHUB_OUTPUT) await append(env.GITHUB_OUTPUT, `result=${output}\n`, 'utf8');
  if (env.GITHUB_STEP_SUMMARY) await append(env.GITHUB_STEP_SUMMARY, `Moat CI: ${result.readingState}; ${result.charged} MoatTokens charged. Result commented on the release commit.\n`, 'utf8');
  write(`Moat CI: ${result.readingState}; ${result.charged} MoatTokens charged.`);
  return JSON.parse(sanitized);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRelease().catch(() => {
    process.stderr.write('Moat CI release action failed. Evidence or a reading may already be stored; check status before retrying. No credentials or remote errors are logged.\n');
    process.exitCode = 1;
  });
}

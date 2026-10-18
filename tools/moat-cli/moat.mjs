#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const HELP = `Moat CI (proposed patch; requires deployed API v1)\nmoat status [--dossier <id>]\nmoat evidence add <file|text> --dossier <id> [--file|--text]\nmoat ship [--from <tag>] --dossier <id>\nmoat reread [--confirm --max-tokens <accepted-cost>] --dossier <id>\nSet MOATDEFENDER_API_KEY in your environment only. Shipping adds evidence; it never runs a paid reading.`;

export function redact(value, key) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return key ? text.replaceAll(key, '[REDACTED]') : text;
}

export function createClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const key = env.MOATDEFENDER_API_KEY;
  if (!key || /[\r\n]/.test(key)) throw new Error('Set a valid MOATDEFENDER_API_KEY environment variable.');
  let base;
  try { base = new URL(env.MOATDEFENDER_URL || 'https://moatdefender.com'); } catch { throw new Error('Invalid MOATDEFENDER_URL.'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('MOATDEFENDER_URL must be an HTTPS origin without credentials, path, query or fragment.');
  }
  return async (path, body) => {
    // Paths are generated locally, never supplied by a server or release document.
    if (!path.startsWith('/api/v1/')) throw new Error('Invalid API path.');
    if (body !== undefined && JSON.stringify(body).includes(key)) throw new Error('Evidence must not contain the API key.');
    let response;
    try {
      response = await fetchImpl(`${base.origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.timeout(60_000),
      });
    } catch { throw new Error('MoatDefender request failed; no server error details are logged.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error(`MoatDefender returned an unreadable response (${response.status}).`); }
    if (!response.ok && !(response.status === 402 && data.code === 'confirmation_required')) {
      const allowed = ['unauthorized', 'forbidden', 'not_found', 'invalid_request', 'budget_exceeded', 'insufficient_tokens', 'rate_limited', 'reading_in_progress', 'cost_limit_exceeded', 'evidence_changed', 'new_evidence_required', 'insufficient_scope', 'evidence_full'];
      throw new Error(`MoatDefender request rejected (${response.status}${allowed.includes(data.code) ? `, ${data.code}` : ''}).`);
    }
    return { status: response.status, data };
  };
}

function parse(args) {
  const values = [], options = {};
  for (let i = 0; i < args.length; i++) {
    const item = args[i];
    if (['--dossier', '--from', '--max-tokens'].includes(item)) {
      if (options[item] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing or repeated option value.');
      options[item] = args[++i];
    } else if (['--confirm', '--file', '--text'].includes(item)) {
      if (options[item]) throw new Error('Repeated option.');
      options[item] = true;
    } else if (item.startsWith('--')) throw new Error('Unknown option. API keys belong in the environment only.');
    else values.push(item);
  }
  return { values, options };
}

export async function collectReleaseNotes(from, git = async (args) => (await exec('git', args, { maxBuffer: 1_000_000 })).stdout.trim()) {
  let reference = from;
  if (reference?.startsWith('-')) throw new Error('Invalid starting tag.');
  if (!reference) {
    try { reference = await git(['describe', '--tags', '--abbrev=0']); } catch { reference = null; }
  }
  let range = 'HEAD';
  if (reference) {
    const sha = (await git(['rev-parse', '--verify', '--end-of-options', `${reference}^{commit}`])).trim();
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Could not resolve starting tag.');
    range = `${sha}..HEAD`;
  }
  const notes = await git(['log', '--format=%s%n%b', range, '--']);
  if (!notes.trim()) throw new Error('No new release notes found. Add evidence explicitly if needed.');
  return notes.trim();
}

async function askPermission(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await input.question(prompt)).trim().toLowerCase() === 'yes'; } finally { input.close(); }
}

export async function main(args, dependencies = {}) {
  const env = dependencies.env || process.env;
  const write = dependencies.write || ((value) => process.stdout.write(`${value}\n`));
  const print = (value) => write(redact(value, env.MOATDEFENDER_API_KEY));
  const { values, options } = parse(args);
  if (!values.length || values[0] === 'help') { print(HELP); return 0; }
  const command = values[0];
  const allowed = command === 'status' ? ['--dossier'] : command === 'reread' ? ['--dossier', '--confirm', '--max-tokens'] : command === 'ship' ? ['--dossier', '--from'] : ['--dossier', '--file', '--text'];
  if (Object.keys(options).some((option) => !allowed.includes(option))) throw new Error('Option does not apply to this command.');
  if (command !== 'status' && !options['--dossier']) throw new Error('Choose the owned dossier with --dossier <id>.');
  let maxTokens;
  if (command === 'reread') {
    const cap = options['--max-tokens'];
    if (options['--confirm'] && cap === undefined) throw new Error('Missing accepted cost. Run moat reread without --confirm for a quote, then use --confirm --max-tokens <accepted-cost>.');
    if (cap !== undefined) {
      if (!/^(0|[1-9][0-9]*)$/.test(cap) || !Number.isSafeInteger(Number(cap))) throw new Error('Invalid --max-tokens: use a nonnegative safe integer from the accepted cost quote.');
      maxTokens = Number(cap);
    }
  }
  const request = dependencies.request || createClient({ env, fetchImpl: dependencies.fetchImpl });
  const dossierId = options['--dossier'];
  if (command === 'status' && values.length === 1) {
    print((await request(`/api/v1/moat${dossierId ? `?dossierId=${encodeURIComponent(dossierId)}` : ''}`)).data);
  } else if (command === 'reread' && values.length === 1) {
    const result = await request('/api/v1/readings', { dossierId, confirm: Boolean(options['--confirm']), ...(maxTokens === undefined ? {} : { maxTokens }) });
    print(result.data);
    if (result.status === 402) { print('No tokens spent. Review the quoted cost, then run moat reread --confirm --max-tokens <accepted-cost> --dossier <id> to authorize up to the accepted cost.'); return 2; }
  } else if (command === 'ship' && values.length === 1) {
    const text = validateEvidence(await collectReleaseNotes(options['--from'], dependencies.git));
    const payload = { dossierId, text };
    print('Proposed evidence payload (review for confidential information):');
    print(payload);
    if (!(await (dependencies.ask || askPermission)('Send this evidence to MoatDefender? Type yes: '))) { print('Cancelled. No evidence sent.'); return 0; }
    print((await request('/api/v1/evidence', payload)).data);
    print('Evidence stored. The Moat Index has not been re-read. Use moat reread for a cost quote.');
  } else if (command === 'evidence' && values[1] === 'add' && values.length === 3) {
    if (options['--file'] && options['--text']) throw new Error('Choose either --file or --text.');
    let text = values[2];
    let fromFile = false;
    if (!options['--text']) {
      try { text = await (dependencies.readFile || readFile)(values[2], 'utf8'); fromFile = true; }
      catch (error) { if (options['--file'] || error.code !== 'ENOENT') throw new Error('Could not read evidence file.'); }
    }
    text = validateEvidence(text);
    const payload = { dossierId, text };
    // File contents are not visible in the typed command (and a positional path that exists is read as a
    // file), so they are shown and confirmed before anything leaves the machine, exactly like `ship`.
    if (fromFile) {
      print('Proposed evidence payload (review for confidential information):');
      print(payload);
      if (!(await (dependencies.ask || askPermission)('Send this evidence to MoatDefender? Type yes: '))) { print('Cancelled. No evidence sent.'); return 0; }
    }
    print((await request('/api/v1/evidence', payload)).data);
  } else { throw new Error('Unknown command or unexpected arguments. Run moat help.'); }
  return 0;
}

export function validateEvidence(text) {
  if (typeof text !== 'string') throw new Error('Evidence must be text.');
  const normalized = text.trim();
  if (normalized.length < 8 || normalized.length > 20_000 || (normalized.match(/[\p{L}\p{N}]/gu)?.length || 0) < 8) throw new Error('Evidence must contain 8–20,000 characters with at least 8 letters or numbers.');
  return normalized;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    // Only locally authored errors may cross the CLI boundary; never print stacks or remote messages.
    const safe = ['Set a valid ', 'Invalid ', 'MOATDEFENDER_URL ', 'MoatDefender ', 'Missing ', 'Repeated ', 'Unknown ', 'Option ', 'Choose ', 'Could not ', 'No new ', 'Evidence must '];
    const message = safe.some((prefix) => error.message?.startsWith(prefix)) ? error.message : 'Moat CI failed; details omitted to protect credentials.';
    process.stderr.write(`${redact(message, process.env.MOATDEFENDER_API_KEY)}\n`);
    process.exitCode = 1;
  });
}

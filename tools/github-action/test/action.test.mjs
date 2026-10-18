import test from 'node:test';
import assert from 'node:assert/strict';
import { runRelease } from '../action.mjs';

function fixture(overrides = {}) {
  const env = { GITHUB_EVENT_NAME: 'release', GITHUB_EVENT_PATH: '/mock/event.json', GITHUB_REPOSITORY: 'org/repo', GITHUB_TOKEN: 'gh_test_secret', MOATDEFENDER_API_KEY: 'md_test_secret', MOAT_DOSSIER_ID: 'd1', MOAT_REREAD: 'false', ...overrides };
  const event = { action: 'published', repository: { full_name: 'org/repo', fork: false }, release: { tag_name: 'v1;$(do-not-execute)', name: 'release', body: 'Customer evidence $(do-not-execute)', draft: false } };
  const api = [], github = [], log = [];
  return { env, event, api, github, log, deps: { env, read: async () => JSON.stringify(event), append: async () => {}, write: (s) => log.push(s), request: async (path, body) => { api.push([path, body]); return { status: 200, data: { evidenceId: 'e1', duplicate: false } }; }, fetchImpl: async (url, options) => { github.push([url, options]); return { ok: true, json: async () => url.endsWith('/comments') ? { id: 1 } : { sha: 'a'.repeat(40) } }; } } };
}

test('release action defaults to evidence only, resolves tag safely and comments state', async () => {
  const f = fixture();
  const result = await runRelease(f.deps);
  assert.equal(result.readingState, 'unchanged');
  assert.equal(result.charged, 0);
  assert.equal(f.api.length, 1);
  assert.equal(f.api[0][0], '/api/v1/evidence');
  assert.match(f.api[0][1].text, /\$\(do-not-execute\)/);
  assert.equal(f.github[0][0], 'https://api.github.com/repos/org/repo/commits/v1%3B%24(do-not-execute)');
  assert.match(f.github[1][1].body, /unchanged/);
  assert.match(f.github[1][1].body, /Shipping alone/);
});

test('opted-in reread gets a quote before confirming and reports actual charge', async () => {
  const f = fixture({ MOAT_REREAD: 'true', MOAT_MAX_TOKENS: '150' });
  const result = await runRelease({ ...f.deps, request: async (path, body) => {
    f.api.push([path, body]);
    if (path.endsWith('/evidence')) return { status: 200, data: { evidenceId: 'e1', duplicate: false } };
    if (!body.confirm) return { status: 402, data: { code: 'confirmation_required', cost: 150 } };
    return { status: 200, data: { cached: false, charged: 150, reading: { id: 'r1', moatIndex: 42, delta: 1, rubricVersion: 'method-1', nextMoves: { private: 'Do not publish the full Designer plan' } } } };
  } });
  assert.deepEqual(f.api.slice(1).map((c) => c[1].confirm), [false, true]);
  assert.equal(result.charged, 150);
  assert.equal(result.readingState, 'completed');
  assert.equal(JSON.stringify(f.github).includes('Do not publish'), false);
});

test('cache hits do not send a confirmed paid request', async () => {
  const f = fixture({ MOAT_REREAD: 'true', MOAT_MAX_TOKENS: '150' });
  const result = await runRelease({ ...f.deps, request: async (path, body) => {
    f.api.push([path, body]);
    return { status: 200, data: path.endsWith('/evidence') ? { evidenceId: 'e1', duplicate: true } : { cached: true, charged: 0, reading: { id: 'r0' } } };
  } });
  assert.equal(f.api.length, 2);
  assert.equal(result.readingState, 'cached');
  assert.equal(result.charged, 0);
});

test('quote above budget never receives confirmation', async () => {
  const f = fixture({ MOAT_REREAD: 'true', MOAT_MAX_TOKENS: '149' });
  await assert.rejects(runRelease({ ...f.deps, request: async (path, body) => {
    f.api.push([path, body]);
    return path.endsWith('/evidence') ? { status: 200, data: { evidenceId: 'e1' } } : { status: 402, data: { cost: 150 } };
  } }), /exceeds/);
  assert.equal(f.api.some((c) => c[1].confirm), false);
});

test('fork PRs, nonpublished events, and missing budget are rejected before any evidence write', async () => {
  for (const [env, change] of [
    [{ GITHUB_EVENT_NAME: 'pull_request' }, () => {}],
    [{}, (e) => { e.repository.fork = true; }],
    [{}, (e) => { e.action = 'edited'; }],
    [{}, (e) => { e.repository.full_name = 'attacker/repo'; }],
    [{ MOAT_REREAD: 'true', MOAT_MAX_TOKENS: '0' }, () => {}],
    [{ GITHUB_TOKEN: '' }, () => {}],
  ]) {
    const f = fixture(env); change(f.event);
    await assert.rejects(runRelease(f.deps));
    assert.equal(f.api.length, 0);
    assert.equal(f.github.length, 0);
  }
});

test('known credentials are redacted from action outputs and commit comments', async () => {
  const f = fixture();
  const result = await runRelease({ ...f.deps, request: async () => ({ status: 200, data: { evidenceId: f.env.MOATDEFENDER_API_KEY, duplicate: false } }) });
  assert.equal(JSON.stringify(result).includes(f.env.MOATDEFENDER_API_KEY), false);
  assert.equal(f.github[1][1].body.includes(f.env.MOATDEFENDER_API_KEY), false);
  assert.equal(f.log.join('').includes(f.env.MOATDEFENDER_API_KEY), false);
});

test('confirmation forwards budget to the server so a changed canonical cost cannot be charged', async () => {
  const f = fixture({ MOAT_REREAD: 'true', MOAT_MAX_TOKENS: '150' });
  let charge = 0;
  await assert.rejects(runRelease({ ...f.deps, request: async (path, body) => {
    f.api.push([path, body]);
    if (path.endsWith('/evidence')) return { status: 200, data: { evidenceId: 'e1' } };
    if (!body.confirm) return { status: 402, data: { cost: 150 } };
    assert.equal(body.maxTokens, 150);
    const changedCost = 200;
    if (changedCost > body.maxTokens) throw new Error('cost_limit_exceeded');
    charge += changedCost;
    assert.fail('budget mismatch must reject before charging');
  } }), /cost_limit_exceeded/);
  assert.equal(charge, 0);
  assert.equal(f.github.length, 0);
});

test('untrusted charged fields cannot leak either credential into any output', async () => {
  for (const field of ['MOATDEFENDER_API_KEY', 'GITHUB_TOKEN']) {
    const f = fixture({ MOAT_REREAD: 'true', MOAT_MAX_TOKENS: '150', GITHUB_OUTPUT: '/mock/output', GITHUB_STEP_SUMMARY: '/mock/summary' });
    const writes = [];
    await assert.rejects(runRelease({ ...f.deps, append: async (...args) => writes.push(args), request: async (path) => ({
      status: 200, data: path.endsWith('/evidence') ? { evidenceId: 'e1' } : { cached: false, charged: f.env[field], reading: { id: 'r1' } },
    }) }), /Invalid reading charge/);
    assert.equal(writes.length, 0);
    assert.equal(f.github.length, 0);
    assert.equal(f.log.length, 0);
  }
});

test('charge must be a nonnegative safe integer within budget and cached charge must be zero', async () => {
  for (const [cached, charged] of [[false, -1], [false, 1.5], [false, 151], [false, Number.MAX_SAFE_INTEGER + 1], [true, 150], ['true', 0]]) {
    const f = fixture({ MOAT_REREAD: 'true', MOAT_MAX_TOKENS: '150' });
    await assert.rejects(runRelease({ ...f.deps, request: async (path) => ({ status: 200, data: path.endsWith('/evidence') ? { evidenceId: 'e1' } : { cached, charged, reading: { id: 'r1' } } }) }), /Invalid reading charge/);
    assert.equal(f.log.length, 0);
    assert.equal(f.github.length, 0);
  }
});

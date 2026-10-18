import test from 'node:test';
import assert from 'node:assert/strict';
import { main, createClient, collectReleaseNotes } from '../moat.mjs';

const env = { MOATDEFENDER_API_KEY: 'md_secret_test_key' };
const dossier = 'dossier-1';
const capture = () => { const calls = [], output = []; return { calls, output, deps: { env, write: (s) => output.push(s), request: async (...args) => { calls.push(args); return { status: 200, data: { ok: true } }; } } }; };

test('status requests latest or an explicitly encoded owned dossier', async () => {
  const { calls, deps } = capture();
  await main(['status'], deps);
  await main(['status', '--dossier', 'a&other=bad'], deps);
  assert.deepEqual(calls, [['/api/v1/moat'], ['/api/v1/moat?dossierId=a%26other%3Dbad']]);
});

test('evidence accepts explicit file and text without interpreting either as commands', async () => {
  const { calls, deps } = capture();
  const source = '$(do-not-execute); customer proof';
  await main(['evidence', 'add', 'notes.md', '--file', '--dossier', dossier], { ...deps, readFile: async () => source, ask: async () => true });
  await main(['evidence', 'add', source, '--text', '--dossier', dossier], { ...deps, readFile: () => assert.fail('text must not read files'), ask: () => assert.fail('typed text is already visible') });
  assert.deepEqual(calls, Array(2).fill(['/api/v1/evidence', { dossierId: dossier, text: source }]));
});

test('file evidence (explicit or positional) is previewed and sent only after yes', async () => {
  const { deps, calls, output } = capture();
  const secret = 'DATABASE_PASSWORD=hunter2-private';
  for (const args of [['evidence', 'add', '.env', '--dossier', dossier], ['evidence', 'add', '.env', '--file', '--dossier', dossier]]) {
    assert.equal(await main(args, { ...deps, readFile: async () => secret, ask: async () => { assert.match(output.join('\n'), /hunter2-private/); return false; } }), 0);
  }
  assert.equal(calls.length, 0);
  assert.match(output.join('\n'), /Cancelled. No evidence sent./);
});

test('ambiguous positional input falls back to text only for absent files', async () => {
  const { deps, calls } = capture();
  await main(['evidence', 'add', 'customer proof', '--dossier', dossier], { ...deps, readFile: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); }, ask: () => assert.fail('literal text needs no prompt') });
  assert.equal(calls.length, 1);
  await assert.rejects(main(['evidence', 'add', 'private.md', '--dossier', dossier], { ...deps, readFile: async () => { throw Object.assign(new Error(), { code: 'EACCES' }); } }), /Could not read/);
  assert.equal(calls.length, 1);
});

test('ship previews exact payload and cancels without submitting or reading', async () => {
  const { deps, calls, output } = capture();
  await main(['ship', '--dossier', dossier], { ...deps, git: async (args) => { if (args[0] === 'describe') throw new Error('no tags'); return 'New customer proof'; }, ask: async () => { assert.match(output.join('\n'), /New customer proof/); return false; } });
  assert.equal(calls.length, 0);
  assert.match(output.join('\n'), /Cancelled/);
});

test('confirmed ship sends only reviewed evidence, never a reading', async () => {
  const { deps, calls } = capture();
  await main(['ship', '--from', 'v1.0', '--dossier', dossier], { ...deps, git: async (args) => args[0] === 'rev-parse' ? 'a'.repeat(40) : 'New customer proof', ask: async () => true });
  assert.deepEqual(calls, [['/api/v1/evidence', { dossierId: dossier, text: 'New customer proof' }]]);
});

test('git references resolve to a hash before log and never enter a shell', async () => {
  const calls = [];
  await collectReleaseNotes('v1;$(bad)', async (args) => { calls.push(args); return args[0] === 'rev-parse' ? 'a'.repeat(40) : 'Safe release notes'; });
  assert.deepEqual(calls[0], ['rev-parse', '--verify', '--end-of-options', 'v1;$(bad)^{commit}']);
  assert.deepEqual(calls[1], ['log', '--format=%s%n%b', `${'a'.repeat(40)}..HEAD`, '--']);
  await assert.rejects(collectReleaseNotes('--exec=bad'), /Invalid/);
});

test('reread quotes without confirmation and requires explicit flag to spend', async () => {
  const { deps, calls, output } = capture();
  const request = async (...args) => { calls.push(args); return { status: args[1].confirm ? 200 : 402, data: { code: 'confirmation_required', cost: 150 } }; };
  assert.equal(await main(['reread', '--dossier', dossier], { ...deps, request }), 2);
  await main(['reread', '--confirm', '--max-tokens', '150', '--dossier', dossier], { ...deps, request });
  assert.deepEqual(calls.map((c) => c[1].confirm), [false, true]);
  assert.match(output.join('\n'), /No tokens spent/);
});

test('key is header-only; requests do not follow redirects and omit email', async () => {
  let received;
  const client = createClient({ env, fetchImpl: async (...args) => { received = args; return { ok: true, status: 200, json: async () => ({ ok: true }) }; } });
  await client('/api/v1/evidence', { dossierId: dossier, text: 'New customer proof' });
  assert.equal(received[0].includes(env.MOATDEFENDER_API_KEY), false);
  assert.equal(received[1].headers.Authorization, `Bearer ${env.MOATDEFENDER_API_KEY}`);
  assert.equal(received[1].redirect, 'error');
  assert.equal(JSON.stringify(received[1].body).includes(env.MOATDEFENDER_API_KEY), false);
  assert.equal(Object.keys(received[1].headers).some((k) => k.toLowerCase().includes('email')), false);
});

test('remote error strings and response keys cannot leak credentials into output', async () => {
  const client = createClient({ env, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: env.MOATDEFENDER_API_KEY, code: env.MOATDEFENDER_API_KEY }) }) });
  await assert.rejects(client('/api/v1/moat'), (e) => !e.message.includes(env.MOATDEFENDER_API_KEY));
  const output = [];
  await main(['status'], { env, write: (s) => output.push(s), request: async () => ({ status: 200, data: { leaked: env.MOATDEFENDER_API_KEY } }) });
  assert.equal(output.join('').includes(env.MOATDEFENDER_API_KEY), false);
});

test('invalid evidence, dossier, key arguments and unsafe URLs fail before network', async () => {
  const noNetwork = async () => assert.fail('unexpected network');
  await assert.rejects(main(['evidence', 'add', 'short', '--text', '--dossier', dossier], { env, fetchImpl: noNetwork }), /Evidence must/);
  await assert.rejects(main(['ship'], { env, fetchImpl: noNetwork }), /dossier/);
  await assert.rejects(main(['status', '--api-key', 'secret'], { env, fetchImpl: noNetwork }), /environment/);
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/?secret=key', 'https://example.com/path']) {
    assert.throws(() => createClient({ env: { ...env, MOATDEFENDER_URL: url }, fetchImpl: noNetwork }), /HTTPS origin/);
  }
});

test('evidence is trimmed and requires eight meaningful alphanumeric characters', async () => {
  const { deps, calls } = capture();
  await assert.rejects(main(['evidence', 'add', 'a!!!!!!!', '--text', '--dossier', dossier], deps), /at least 8/);
  assert.equal(calls.length, 0);
  await main(['evidence', 'add', '  reviewed customer proof  ', '--text', '--dossier', dossier], deps);
  assert.equal(calls[0][1].text, 'reviewed customer proof');
});

test('known API key cannot be included in an evidence request body', async () => {
  const client = createClient({ env, fetchImpl: async () => assert.fail('no request should carry the key in its body') });
  await assert.rejects(client('/api/v1/evidence', { dossierId: dossier, text: `Release accidentally includes ${env.MOATDEFENDER_API_KEY}` }), /must not contain/);
});

test('confirmed CLI reading requires a valid explicit cap before any HTTP request', async () => {
  for (const cap of [undefined, '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', '1e3']) {
    const { deps, calls } = capture();
    const args = ['reread', '--confirm', '--dossier', dossier, ...(cap === undefined ? [] : ['--max-tokens', cap])];
    await assert.rejects(main(args, deps), cap === undefined ? /cost.*quote/ : /nonnegative safe integer/);
    assert.equal(calls.length, 0);
  }
});

test('confirmed CLI forwards accepted quote ceiling and zero allows cache only', async () => {
  const { deps, calls } = capture();
  await main(['reread', '--confirm', '--max-tokens', '150', '--dossier', dossier], deps);
  await main(['reread', '--confirm', '--max-tokens', '0', '--dossier', dossier], deps);
  assert.deepEqual(calls.map((call) => call[1]), [
    { dossierId: dossier, confirm: true, maxTokens: 150 },
    { dossierId: dossier, confirm: true, maxTokens: 0 },
  ]);
});

test('quoted CLI budget prevents a changed server price from charging', async () => {
  const { deps, calls } = capture();
  let charged = 0;
  const request = async (path, body) => {
    calls.push([path, body]);
    if (!body.confirm) return { status: 402, data: { code: 'confirmation_required', cost: 150 } };
    const currentCost = 200;
    if (currentCost > body.maxTokens) throw new Error('MoatDefender request rejected (402, cost_limit_exceeded).');
    charged += currentCost;
    return { status: 200, data: { charged } };
  };
  await main(['reread', '--dossier', dossier], { ...deps, request });
  await assert.rejects(main(['reread', '--confirm', '--max-tokens', '150', '--dossier', dossier], { ...deps, request }), /cost_limit_exceeded/);
  assert.equal(charged, 0);
});

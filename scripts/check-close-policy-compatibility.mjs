#!/usr/bin/env node
// Frozen old-writer bytes, cross-version retries, exact transition authorization and current matrix.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = join(repo, 'dist/cli.js');
const require = createRequire(import.meta.url);
const { checkpointCommitment, checkpointIntegrityIssues, sha256 } = require(join(repo, 'dist/cli/checkpoints/sprint-close.js'));
const frozen = join(repo, 'fixtures/checkpoints/close-policies');
const scopePath = '.agents/kyro/scopes/demo/sprint.json';
const archivePath = '.agents/kyro/scopes/demo/archive';
const checkpointPath = `${archivePath}/sprint-001-demo-sprint.checkpoint.json`;
const projectPath = '.agents/kyro/kyro.json';
const doctorArgs = ['doctor', '--artifacts', '--kyro-scope', 'demo'];
const assert = (ok, text) => { if (!ok) throw new Error(text); };
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const output = (result) => `${result.stdout}${result.stderr}`;
function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: join(root, '.home'), USERPROFILE: join(root, '.home'), KYRO_TRACE: '0' } });
}
function success(root, args) {
  const result = run(root, args);
  assert(result.status === 0, `${args.join(' ')}: ${output(result)}`);
  return output(result);
}
function sandbox(source, test) {
  const root = mkdtempSync(join(tmpdir(), 'kyro-close-policy-'));
  try { cpSync(source, root, { recursive: true }); test(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function inventory(dir, prefix = '') {
  const files = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, inventory(join(dir, entry.name), name));
    else files[name] = createHash('sha256').update(readFileSync(join(dir, entry.name))).digest('hex');
  }
  return files;
}
function archiveBytes(root) { return inventory(join(root, archivePath)); }
function sameArchive(root, before) { assert(JSON.stringify(archiveBytes(root)) === JSON.stringify(before), 'Immutable archive bytes changed'); }
function verify(root) {
  const text = success(root, doctorArgs);
  assert(text.includes('APPLIED:') && !text.includes('CORRUPT:'), `Expected verified checkpoint: ${text}`);
  return text;
}
let historicalCount = 0;
let boundaryCount = 0;
for (const version of ['4.47.2', '4.48.0', '4.48.1']) {
  const base = join(frozen, version);
  const provenance = json(join(base, 'provenance.json'));
  const actual = inventory(base); delete actual['provenance.json'];
  assert(JSON.stringify(actual) === JSON.stringify(provenance.files), `${version}: frozen fixture inventory/bytes changed`);
  for (const spec of provenance.cases) {
    const applied = join(base, spec.id, 'applied');
    sandbox(applied, (root) => {
      const before = inventory(join(root, '.agents'));
      const archive = archiveBytes(root);
      const checkpoint = json(join(root, checkpointPath));
      assert(checkpointIntegrityIssues(checkpoint, checkpointPath).length === 0, `${version}/${spec.id}: strict authorization failed`);
      verify(root);
      success(root, ['context-pack', '--kyro-scope', 'demo', '--json']);
      assert(JSON.stringify(inventory(join(root, '.agents'))) === JSON.stringify(before), 'Read-only verification changed historical state');
      success(root, spec.args); // Idempotent retry must use the frozen policy, not today's writer.
      assert(JSON.stringify(inventory(join(root, '.agents'))) === JSON.stringify(before), 'Retry migrated historical state');
      assert(json(join(root, scopePath)).handoff.nextAction === spec.expectedAction, 'Historical routing was converted');
      if (version !== '4.47.2') {
        const previewBefore = inventory(join(root, '.agents'));
        const preview = run(root, ['scope', 'complete', '--kyro-scope', 'demo']);
        assert(preview.status !== 0 && output(preview).includes('CONFIRMATION_REQUIRED') && output(preview).includes('Scope completion plan:'), 'Completion must preview and require confirmation');
        assert(JSON.stringify(inventory(join(root, '.agents'))) === JSON.stringify(previewBefore), 'Completion preview wrote state');
        success(root, ['scope', 'complete', '--kyro-scope', 'demo', '--yes']);
        assert(json(join(root, scopePath)).completion && json(join(root, scopePath)).handoff.nextAction === 'done', 'Confirmed completion missing');
        assert(verify(root).includes('lifecycle'), 'Completion must replay against historical close');
        success(root, ['scope', 'reopen', '--kyro-scope', 'demo', '--reason', 'Explicit follow-up', '--yes']);
        assert(verify(root).includes('lifecycle'), 'Reopen must replay against historical close');
      }
      sameArchive(root, archive);
      historicalCount++;
    });
    for (const boundary of spec.boundaries) {
      sandbox(join(base, spec.id, 'boundaries', boundary), (root) => {
        const before = archiveBytes(root);
        const report = output(run(root, doctorArgs));
        const state = boundary === 'checkpoint' ? 'PREPARED:' : boundary === 'project' ? 'APPLIED:' : 'PARTIAL:';
        assert(report.includes(state) && !report.includes('CORRUPT:'), `${version}/${boundary}: ${report}`);
        const conflict = run(root, [...spec.args, '--note', 'Conflicting retry input']);
        assert(conflict.status !== 0 && output(conflict).includes('CHECKPOINT_CONFLICT'), 'Retry must reject changed frozen inputs');
        success(root, spec.args);
        verify(root);
        for (const [path, hash] of Object.entries(before)) assert(archiveBytes(root)[path] === hash, `Retry rewrote ${path}`);
        assert(JSON.stringify(inventory(join(root, '.agents'))) === JSON.stringify(inventory(join(applied, '.agents'))), `${version}/${boundary}: resumed state differs from historical writer result`);
        boundaryCount++;
      });
    }
    // Rehashed, self-consistent after-images still require an exact authorized policy.
    for (const mutate of [
      (cp) => { cp.intendedAfterClose.objective = 'Unauthorized objective'; },
      (cp) => { cp.intendedAfterClose.handoff.note = 'Invented default note'; },
      (cp) => { cp.intendedAfterClose.status = 'blocked'; },
      (cp) => { cp.projectScopeAfter.title = 'Unauthorized registry change'; },
    ]) {
      sandbox(applied, (root) => {
        const cp = json(join(root, checkpointPath));
        mutate(cp);
        cp.intendedAfterClose.ledger.at(-1).checkpointSha256 = checkpointCommitment(cp);
        cp.digests.intendedAfterClose = sha256(cp.intendedAfterClose);
        cp.digests.projectScopeAfter = sha256(cp.projectScopeAfter);
        writeJson(join(root, checkpointPath), cp);
        writeJson(join(root, scopePath), cp.intendedAfterClose);
        const project = json(join(root, projectPath)); project.scopes[0] = cp.projectScopeAfter;
        writeJson(join(root, projectPath), project);
        const result = run(root, doctorArgs);
        assert(result.status !== 0 && output(result).includes('authorized transition'), `Forged transition accepted: ${output(result)}`);
        const gate = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--yes']);
        assert(gate.status !== 0, 'Completion must not launder checkpoint tampering');
      });
    }
  }
}
// Historical plan_sprint remains usable without migration; a later NEW close uses the new policy.
for (const version of ['4.48.0', '4.48.1']) {
  sandbox(join(frozen, version, 'final-shipped-default/applied'), (root) => {
    const original = archiveBytes(root);
    const plan = join(root, 'expansion.json');
    writeJson(plan, {
      sprint: { n: 2, slug: 'expansion', title: 'Expansion', objective: 'Explicitly requested follow-up.' },
      phases: [{ id: 'P1', title: 'Follow-up', objective: 'Deliver follow-up.', tasks: [{
        id: 'T2.1', title: 'Follow-up task', description: 'Implement requested follow-up.',
        files_to_touch: ['src/follow-up.ts'], context: 'Human chose scope expansion.',
        acceptance_criteria: ['Follow-up verified.'], depends_on: [], scenario_refs: [],
      }] }], definitionOfDone: ['Follow-up verified.'], scenarios: [],
    });
    success(root, ['plan', '--from', plan, '--kyro-scope', 'demo']);
    assert(json(join(root, scopePath)).activeSprint.n === 2, 'Historical planning gate rejected expansion');
    success(root, ['record-evidence', 'T2.1', '--kyro-scope', 'demo', '--summary', 'Follow-up delivered.', '--validation', 'compatibility test', '--file', 'src/follow-up.ts']);
    success(root, ['review', 'T2.1', '--kyro-scope', 'demo', '--verdict', 'pass', '--yes']);
    success(root, ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes']);
    assert(json(join(root, scopePath)).handoff.nextAction === 'await_scope_completion', 'New close after historical history must use the new writer');
    verify(root);
    success(root, ['scope', 'complete', '--kyro-scope', 'demo', '--yes']);
    verify(root);
    for (const [path, hash] of Object.entries(original)) assert(archiveBytes(root)[path] === hash, 'Later lifecycle rewrote original history');
  });
}
// Historical external anchors and exact artifact bytes remain binding, independently of policy.
for (const version of ['4.48.0', '4.48.1']) for (const attack of ['artifact', 'external-anchor']) {
  sandbox(join(frozen, version, 'final-shipped-default/applied'), (root) => {
    if (attack === 'artifact') {
      const narrative = join(root, archivePath, 'sprint-001-demo-sprint.md');
      writeFileSync(narrative, `${readFileSync(narrative, 'utf8')}Unauthorized addition.\n`);
    } else {
      const cp = json(join(root, checkpointPath));
      cp.beforeClose.objective = 'Coordinated archive rewrite';
      cp.intendedAfterClose.objective = cp.beforeClose.objective;
      cp.digests.beforeClose = sha256(cp.beforeClose);
      cp.intendedAfterClose.ledger.at(-1).checkpointSha256 = checkpointCommitment(cp);
      cp.digests.intendedAfterClose = sha256(cp.intendedAfterClose);
      writeJson(join(root, checkpointPath), cp); // Do NOT change the external live anchor.
    }
    const result = run(root, doctorArgs);
    assert(result.status !== 0 && output(result).includes(attack === 'artifact' ? 'conflict' : 'checkpoint commitment'), `${version}/${attack}: ${output(result)}`);
  });
}
// Full current-writer matrix: final/intermediate/empty × shipped/partial × default/explicit note.
let currentCount = 0;
for (const roadmap of ['final', 'intermediate', 'empty']) for (const outcome of ['shipped', 'partial']) for (const note of [null, 'Explicit current close note.']) {
  sandbox(join(repo, 'fixtures/evals/close-sprint-happy/state'), (root) => {
    const sprint = json(join(root, scopePath));
    if (roadmap === 'intermediate') { sprint.roadmap.plannedSprintCount = 2; sprint.roadmap.sprints.push({ n: 2, slug: 'next', title: 'Next', state: 'planned' }); }
    if (roadmap === 'empty') sprint.roadmap = { plannedSprintCount: 0, sprints: [] };
    if (outcome === 'partial') {
      const task = sprint.activeSprint.phases[0].tasks[0]; task.status = 'pending'; task.verdict = null;
      task.disposition = { kind: 'cancelled', reason: 'Human removed task', by: 'maker', recordedAt: '2026-09-07T00:00:00.000Z' };
    }
    writeJson(join(root, scopePath), sprint);
    success(root, ['close-sprint', '--kyro-scope', 'demo', '--outcome', outcome, '--yes', ...(note ? ['--note', note] : [])]);
    const after = json(join(root, scopePath));
    assert(after.handoff.nextAction === (roadmap === 'intermediate' ? 'plan_sprint' : 'await_scope_completion'), 'Incorrect current action');
    assert(after.status === 'planning' && !after.completion && !after.retirement && after.activeSprint === null, 'Close inferred a lifecycle terminal');
    assert(after.ledger.at(-1).outcome === outcome, 'Close outcome lost');
    if (note) assert(after.handoff.note === note, 'Explicit note changed');
    verify(root);
    const cp = json(join(root, checkpointPath));
    assert(checkpointIntegrityIssues(cp, checkpointPath).length === 0, 'New writer failed exact verification');
    currentCount++;
  });
}

// An exhausted roadmap with debt/blockers still has a decision, not automatic eligibility.
sandbox(join(repo, 'fixtures/evals/close-sprint-happy/state'), (root) => {
  const sprint = json(join(root, scopePath));
  sprint.debt = [{ id: 'D-1', title: 'Outstanding debt', origin: 1, priority: 'high', status: 'open', targetSprint: 2, note: 'Must be handled explicitly.' }];
  sprint.handoff.blockers = ['Delivery acceptance is pending.'];
  writeJson(join(root, scopePath), sprint);
  success(root, ['close-sprint', '--kyro-scope', 'demo', '--outcome', 'shipped', '--yes']);
  const closed = json(join(root, scopePath));
  assert(closed.handoff.nextAction === 'await_scope_completion' && !closed.completion, 'Debt/blockers must not infer completion');
  assert(JSON.stringify(closed.debt) === JSON.stringify(sprint.debt) && JSON.stringify(closed.handoff.blockers) === JSON.stringify(sprint.handoff.blockers), 'Close lost debt/blockers');
  verify(root);
  const before = inventory(join(root, '.agents'));
  const rejected = run(root, ['scope', 'complete', '--kyro-scope', 'demo', '--yes']);
  assert(rejected.status !== 0 && output(rejected).includes('NOT_READY_TO_COMPLETE') && output(rejected).includes('open debt'), 'Existing debt gate must remain intact');
  assert(JSON.stringify(inventory(join(root, '.agents'))) === JSON.stringify(before), 'Rejected completion wrote state');
});

console.log(`check:close-policy-compatibility — ${historicalCount} frozen histories, ${boundaryCount} cross-version retries, ${currentCount} current matrix cases; rehashed tampering rejected.`);

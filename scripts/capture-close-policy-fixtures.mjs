#!/usr/bin/env node
// Maintainer-only capture, never part of check: uses an independently built historical writer.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const [sourceArg, commit] = process.argv.slice(2);
if (!sourceArg || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Usage: capture-close-policy-fixtures.mjs <built historical source> <full commit>');
const source = resolve(sourceArg);
const version = JSON.parse(readFileSync(join(source, 'package.json'))).version;
if (!['4.48.0', '4.48.1', '4.47.2'].includes(version)) throw new Error('Only the audited historical versions are capturable');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writerPath = 'src/cli/checkpoints/sprint-close.ts';
const committed = spawnSync('git', ['show', `${commit}:${writerPath}`], { cwd: repo });
if (committed.status !== 0 || !committed.stdout.equals(readFileSync(join(source, writerPath)))) throw new Error('Historical writer differs from the recorded commit');
const destination = join(repo, 'fixtures/checkpoints/close-policies', version);
if (existsSync(destination)) throw new Error('Refusing to overwrite frozen fixtures');
mkdirSync(destination, { recursive: true });
const cases = version === '4.47.2'
  ? [{ id: 'final-shipped-default', roadmap: 'final', outcome: 'shipped', note: null }]
  : ['final', 'intermediate', 'empty'].flatMap((roadmap) => ['shipped', 'partial'].map((outcome, index) => ({
    id: `${roadmap}-${outcome}-${index ? 'explicit' : 'default'}`, roadmap, outcome,
    note: index ? 'Human-provided close note; preserve exactly.' : null,
  })));
const manifest = { version, commit, writerSha256: sha(committed.stdout), compiledWriterSha256: sha(readFileSync(join(source, 'dist/cli/checkpoints/sprint-close.js'))), cases: [], files: {} };
const scopeFile = '.agents/kyro/scopes/demo/sprint.json';
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
function captureTree(root, target) {
  cpSync(join(root, '.agents'), join(target, '.agents'), { recursive: true });
}
for (const spec of cases) {
  const root = mkdtempSync(join(tmpdir(), 'kyro-capture-close-'));
  try {
    cpSync(join(source, 'fixtures/evals/close-sprint-happy/state'), root, { recursive: true });
    const sprint = JSON.parse(readFileSync(join(root, scopeFile)));
    if (spec.roadmap === 'intermediate') {
      sprint.roadmap.plannedSprintCount = 2;
      sprint.roadmap.sprints.push({ n: 2, slug: 'next', title: 'Next', state: 'planned' });
    } else if (spec.roadmap === 'empty') sprint.roadmap = { plannedSprintCount: 0, sprints: [] };
    if (spec.outcome === 'partial') {
      const task = sprint.activeSprint.phases[0].tasks[0];
      task.status = 'pending'; task.verdict = null;
      task.disposition = { kind: 'cancelled', reason: 'Human removed the task.', by: 'maker', recordedAt: '2026-09-07T00:00:00.000Z' };
    }
    // Default final shipped is copied directly without even reserializing its input.
    if (spec.roadmap !== 'final' || spec.outcome !== 'shipped') writeJson(join(root, scopeFile), sprint);
    const args = ['close-sprint', '--kyro-scope', 'demo', '--outcome', spec.outcome, '--yes', ...(spec.note ? ['--note', spec.note] : [])];
    const run = (args, env = {}) => spawnSync(process.execPath, [join(source, 'dist/cli.js'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: join(root, '.home'), USERPROFILE: join(root, '.home'), KYRO_TRACE: '0', ...env } });
    const boundaries = version !== '4.47.2' && spec.id === 'final-shipped-default' ? ['checkpoint', 'snapshot', 'narrative', 'sprint', 'project'] : [];
    for (const boundary of boundaries) {
      const interrupted = run(args, { KYRO_TEST_CLOSE_FAIL_AFTER: boundary });
      if (interrupted.status !== 1 || !interrupted.stderr.includes(`Injected close failure after ${boundary}`)) throw new Error(`${boundary}: ${interrupted.stdout}${interrupted.stderr}`);
      captureTree(root, join(destination, spec.id, 'boundaries', boundary));
    }
    const closed = run(args);
    if (closed.status !== 0) throw new Error(`${closed.stdout}${closed.stderr}`);
    const doctor = run(['doctor', '--artifacts', '--kyro-scope', 'demo']);
    if (doctor.status !== 0 || !doctor.stdout.includes('APPLIED:')) throw new Error(`${doctor.stdout}${doctor.stderr}`);
    captureTree(root, join(destination, spec.id, 'applied'));
    manifest.cases.push({ ...spec, args, boundaries, historicalDoctor: 'exit 0; APPLIED', expectedAction: JSON.parse(readFileSync(join(root, scopeFile))).handoff.nextAction });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function inventory(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) inventory(join(dir, entry.name), path);
    else manifest.files[path] = sha(readFileSync(join(dir, entry.name)));
  }
}
inventory(destination);
writeJson(join(destination, 'provenance.json'), manifest);
console.log(`Captured historical ${version} (${commit}): ${manifest.cases.length} cases, ${Object.keys(manifest.files).length} frozen files; old doctor APPLIED.`);

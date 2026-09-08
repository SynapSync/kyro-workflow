#!/usr/bin/env node
// Verifies the Forge creation-flow root fix: a scope that does not exist yet must route to
// INIT without running repair or context-pack. The repair preflight is existing-scope-only,
// in every router entry point. Regression for the false irreconcilable blocker that stopped
// new-scope creation (plan -> scope) and misrouted it to recovery.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const docs = [
  { path: 'commands/forge.md', initRef: 'skills/sprint-forge/assets/modes/INIT.md' },
  { path: 'agents/orchestrator.md', initRef: 'assets/modes/INIT.md' },
  { path: 'internal/skills/sprint-forge/SKILL.md', initRef: 'modes/INIT.md' },
];

for (const { path, initRef } of docs) {
  const text = readFileSync(resolve(repo, path), 'utf-8');
  const gate = text.indexOf('does not exist yet');
  const repair = text.indexOf('repair integrity prepare');
  if (gate === -1) fail(`${path}: missing creation-flow existence gate`);
  if (repair === -1) fail(`${path}: missing repair preflight`);
  if (!(gate < repair)) fail(`${path}: existence gate must precede the repair preflight`);
  if (!text.includes(`load \`${initRef}\``)) fail(`${path}: creation flow must load ${initRef}`);
  if (!/only for an existing scope/i.test(text)) fail(`${path}: repair preflight must be conditioned on an existing scope`);
  if (!/never rout\w+( it)?\s+to recovery/i.test(text)) fail(`${path}: creation flow must never route to recovery`);
}

const recover = readFileSync(resolve(repo, 'internal/skills/sprint-forge/assets/modes/recover.md'), 'utf-8');
if (!/only for scopes that exist/i.test(recover)) fail('recover.md: missing existing-scope guard');

console.log('check:forge-startup-order — creation flows route to INIT without repair; repair is existing-scope-only');

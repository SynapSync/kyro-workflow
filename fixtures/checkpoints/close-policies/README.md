# Frozen close-writer policies

These are historical CLI outputs, not new-writer approximations. Never regenerate them to
satisfy a newer verifier. `.gitattributes` fixes checkout bytes to LF. Each `provenance.json`
records the source commit, source/compiled writer SHA-256, commands, old-doctor result and
SHA-256 of **every captured file**; `check:close-policy-compatibility` enforces that inventory.

| Writer | Source commit | Policy | Captured cases |
|---|---|---|---|
| 4.48.1 | `60e4510125114cca99e7fef2df84024078b850f5` | open-scope | final/intermediate/empty × shipped-default/partial-explicit |
| 4.48.0 | `b39ea9835166852f25ea9b83913830507b495762` (`v4.48.0`) | open-scope | same matrix, independently built/run |
| 4.47.2 | `24a2f45e7a61d31a357d27befb09e19d98ba58bf` | legacy roadmap exhaustion (`done`) | final shipped, default note |

The existing sibling `legacy-v1-intermediate-active-scope` fixture covers the earlier
intermediate registry-status residual. It is not changed by this correction.

## Capture provenance

Sources were extracted with `git archive <commit> | tar -x -C <temporary-source>` and compiled
with `npm run build`, using the repository's TypeScript dependencies. No source edits were
made in those historical trees. For each source, capture used:

```sh
node scripts/capture-close-policy-fixtures.mjs <temporary-built-historical-source> <full-commit>
```

The capture script refuses an existing destination, checks historical writer source against
the recorded Git commit, and never invokes the current CLI. Each case starts by copying
that source's `fixtures/evals/close-sprint-happy/state` directly, including hidden `.agents`.
The final shipped default input is not modified or reserialized. Other cases modify only
test inputs: append a second roadmap sprint, empty the roadmap, or cancel the task with a
typed disposition. The explicit note is supplied as a CLI input. All resulting after-images,
commitments and artifacts are emitted by the historical writer, then pass its own doctor.

For each 4.48.x final shipped default case, the actual historical CLI was interrupted at
`checkpoint`, `snapshot`, `narrative`, `sprint`, and `project` with `KYRO_TEST_CLOSE_FAIL_AFTER`.
Each captured boundary is the real interrupted filesystem, not a reconstruction from JSON.
The old CLI then resumed the same frozen transaction to produce `applied/`.

## Regression coverage

The new verifier must accept these exact bytes, preserve old `plan_sprint`/`done` actions,
resume all ten captured interruptions to the identical historical applied state, reject
changed retry inputs, and preserve the archive through completion/reopen lifecycle replay.
Historical planning also proceeds through evidence/review, a new-policy close and confirmed
completion while preserving the original archive. Completion preview is non-mutating and
requires confirmation. Self-consistent forged
objective, note, scope status, or registry transitions remain rejected even with recomputed
internal digests and live ledger anchors. Rehashing exists only in adversarial test copies.

The current writer is tested separately with the full final/intermediate/empty ×
shipped/partial × default/explicit-note matrix. Real close-to-decision routing, completion
preview/confirmation and explicit expansion are exercised in `check-close-handoff.mjs`,
`check-plan.mjs` and `check-scope-retire.mjs`, not inferred from synthetic routing fixtures.

## Integrity design

Checkpoint v1 has no writer-policy discriminator. The verifier therefore enumerates the
three **exact complete** historical/current transition shapes derived from `beforeClose`
and frozen inputs. Historical open-scope retains its original note and planning status;
only the new writer emits `await_scope_completion`. Identity, paths, artifact digests,
external ledger commitment, full after-image comparison and registry transition checks
remain mandatory. No arbitrary after-image is accepted and no history is migrated.

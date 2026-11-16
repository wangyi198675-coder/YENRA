# YEN-15 — Independent checkout and v18 baseline verification report

**Date:** 2026-11-16

**Status:** Source migration in Draft PR #3. Core build/test gates pass. **v18 full NSIS reproducibility is not established.**

- [Linear YEN-15](https://linear.app/yenra/issue/YEN-15)
- [YENRA public source PR #3](https://github.com/wangyi198675-coder/YENRA/pull/3)
- [Actual GitHub Actions run — official DSH overlay + Linux/Windows plugin builds](https://github.com/wangyi198675-coder/YENRA/actions/runs/43806172439)
- Baseline of the existing owner application: `0.2.1-rc.5.20261116.18`; original formal Git main `f1b91c2`
- Pinned MIT DSH base: `b830ec950faba0a46dda564be3e2d854afed94f1`.
- User's original DSH modifications: 27-file Git patch, replayed in ephemeral GitHub CI upstream worktrees.
- Formal Bridge inventory: 58 files; formal latest-source SHA manifest: 20 files.

## Reproducible from this review branch

1. Clean GitHub checkout on Linux and Windows.
2. Fetch original DSH at the specified exact SHA; verify and replay the 27-file YENRA desktop and conversation UI patch.
3. Install DSH upstream locked workspace dependencies and both YENRA UI plugins from their committed frozen lockfiles with lifecycle scripts disabled.
4. Build original YENRA Chatwoot UI embedding and YENRA desktop UI overlay with the upstream tsdown preset, on **both platforms**.
5. GitHub Ubuntu Runner runs 42/42 offline mocked regression tests (Cloud inbound, message ACK, conversation scope, KT Europe number parsing, native contact collapse), parses imported JS, checks manifest-level single-host architecture invariants, and checks privacy/public-source boundaries.
6. Archive-only v18 build and NSIS verification source references must refuse execution by default.

Results are visible in GitHub Actions logs and are independent of the owner's running desktop.

## NOT established / mandatory open blockers

1. The formal latest-source v18 freeze SHA differs from four staging owner-source files:
   - `social-adapters/chatwoot-bridge/src/index.mjs`
   - `social-adapters/chatwoot-cloud-direct/cloud-inbound-projection.mjs`
   - `social-adapters/chatwoot-cloud-direct/cloud-webhook-contract.mjs`
   - `ui/chatwoot-embed/src/client/cloud-native-inbox.tsx`
   These are genuine byte differences, not Git line-ending conversions. **The provenance CI gate intentionally fails.**
2. Full official Windows Electron/NSIS builder is still tied to local 13 pinned offline plugin tarballs, the frozen profile package (42 bundle identities, 32 dependencies), KT offline snapshot (1,317 files), offline grammar resources, a source-hash-verified frozen release bridge and byte-exact packaging inputs. They have not been committed for privacy, third-party license and large-artifact reasons. This repository **cannot yet recreate the exact 500+ MB v18 installer from a clean checkout**.
3. Only the original v18 build/verify script contents are preserved as sanitized, default-disabled archival source. Live owner installation/backup orchestration remains outside this branch to prevent accidental overwrite.
4. A root license for original YENRA code is still to be chosen by the unified release Owner; legal and upstream provenance need final inspection before merging to a public open-source release.
5. The CI dependency manifest check is a conservative architecture screen, not a complete proof that no duplicate Sender, Agent, database or Electron process exists at runtime.
6. No real Facebook Page, Facebook Personal, WhatsApp or Cloud account message sends or read receipts were exercised by CI. Formal host v18 and friend computer remain untouched.

## Release ownership gates

- Keep PR #3 **Draft**, Linear issue **In Progress**, and `main` unchanged.
- The unique unified release Owner must reconcile the four source drifts and certify the frozen 58-file Bridge set and 20 latest-source hashes.
- To close the final reproducibility gap, provide legally redistributable build-only sources or provenance-verified pull instructions for the remaining pinned package inputs, then perform a separate isolated Windows NSIS build, validate all baseline markers and compare its output to the frozen installer manifest.
- Do **not** merge, auto-release, install or substitute newer source bytes merely to clear a test, and do not run live-person tests or touch the friend's device.

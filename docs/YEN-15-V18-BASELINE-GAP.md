# YEN-15 — v18 owner-source migration evidence (2026-11-16)

This repository is the only public GitHub home for the owner-operated YENRA project. The source in this migration branch is an **unreleased, unmerged, owner-source snapshot for review**, not a new official installer or proof of production parity. Linear: https://linear.app/yenra/issue/YEN-15.

## What was inspected and staged

- Owner baseline version: `0.2.1-rc.5.20261116.18`.
- Official frozen Bridge manifest: 58 paths; 53 code paths and five support scripts.
- Official frozen latest-source map: 20 paths.
- Selected original YENRA modules: Chatwoot Cloud Bridge and its mocked tests, Cloud inbound/ACK/adapters, typed UI overlays, personal chrome, private themes, typography and KT Europe source. Only source and relevant manifests/locks are copied.
- Conservative automatic scanner removes test fixtures with phone numbers, identifiable contacts and credential-like literal values from the public candidate. Credentials, DPAPI material, live profiles, messages, media, evidence, installers, runtime, upstream vendor trees and historic backups are not copied.
- The Meta Ads launcher is included with generic official Meta entry URLs rather than hardcoded owner ad-account identifiers. This is an intentional privacy/portability change from the owner source and requires account selection on Meta's site.
- Staging is isolated from the live `YENRA_SOURCE_ROOT` repository. The owner app is never installed, restarted or updated by the import.

## Known blockers: NOT a reproducible v18 release

The owner freeze hashes currently differ from the on-disk formal source for these four paths:

- `social-adapters/chatwoot-bridge/src/index.mjs`
- `social-adapters/chatwoot-cloud-direct/cloud-inbound-projection.mjs`
- `social-adapters/chatwoot-cloud-direct/cloud-webhook-contract.mjs`
- `ui/chatwoot-embed/src/client/cloud-native-inbox.tsx`

The v18 packaged installer was constructed from DSH official upstream, 13 pinned local plugin archives, a Cloud Bridge snapshot, private owner-specific offline dependencies, and its immutable release-freeze manifest. These **binary snapshots and private runtime inputs are intentionally not public**. The local v18 builder uses hardcoded source and artifact paths, so a Linux or Windows GitHub checkout cannot yet reproduce the official installer.

The `frozen-v18-provenance` CI gate must remain failing if frozen-source hashes drift. Such failure is evidence of a baseline mismatch, not an excuse to skip the gate or silently rewrite the freeze data. Resolve source ownership with the unified release Owner before merging and compare generated artifacts from a clean isolated Windows environment before calling YEN-15 complete.

## CI scope and limitations

- GitHub traceability / PR-to-Linear association remains governed by the existing workflow.
- New CI validates public-source boundaries and declared architecture dependencies, JavaScript syntax, mock-based ACK/inbound/scope/KT/UI tests, locked TypeScript plugin installation and bundling, and frozen v18 source SHA.
- A passing unit test is **not** proof that live WhatsApp, Facebook Page, Facebook Personal or Chatwoot sending/receipts work; no real messages are sent in CI.
- No second Agent, Sender, desktop shell or chat database is intentionally introduced. The dependency gate is a manifest-level guard, not a full runtime architectural proof.
- Account/workspace numeric identifiers appear in the existing owner-authored code. They are not authentication secrets, but configuration portability and removing hardcoded tenant identifiers remain follow-up work.
- Missing or externally licensed component sources, including DSH upstream and mature third-party packaged assets, require upstream source resolution and licenses rather than copying their bundled artifacts.

## Required final acceptance

1. Four frozen-source differences reconciled to the approved v18 baseline without overwriting active fixes.
2. Each required module has source, build configuration, dependencies, lockfiles, license provenance and sanitized fixtures.
3. All GitHub Actions jobs green under the reviewed commit; merge only after the unified Owner's review.
4. Independent clean Windows checkout builds the desktop installer and compares manifest, expected dependencies and binary hashes to frozen v18 evidence.
5. Any intentional byte differences are documented and explicitly approved by the unified Owner; running owner v18 is never overwritten and the friend's machine is untouched.

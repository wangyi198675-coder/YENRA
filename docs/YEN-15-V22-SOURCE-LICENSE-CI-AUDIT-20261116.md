# YEN-15 — Installed v22 source parity, PR conflicts, public-source and license review

**Audit date:** 2026-11-16. **Scope:** read-only owner Windows checks, existing isolated PR #13 checkout, publicly available upstream license texts. **Decision:** BLOCKED / source review only; **not** a merge, an installer reconstruction, a live platform receipt, or a formal release approval.

## Actual installed release and local build provenance

- Current running owner's YENRA.exe FileVersion: `0.2.1-rc.5.20261116.22`. The existing owner-only installation receipt states the same version, four original Bridge accounts and `formalReleaseApproved=false`.
- Owner official unsigned Windows NSIS proof: **709,130,832 bytes**, SHA-256 `bf8f8f23ba8b42a47d94d336aa0697d3654a5481958b0c66baf3515f699b05b5`. Existing independent, original owner-only package verification records **51/51 passing**, no failures.
- Rehashed **from the actual installed program's resources** (not simply the source build directory):
  - Active v22 UI tarball SHA-256 `bb3a3483debe6e155d833d394dc140af56c7e2eafcdd1bc9f5018714a1d324d4` — exact original v22 builder receipt.
  - Bridge manifest SHA-256 `ddfaf629a93333919d9dc2c1639af284ae8323420499e04d7ae0d7bfb8727dca` — exact original v22 builder receipt.
- Existing v22 package receipt: **42 native bundles, 32 dependencies, 13 original active plugin archives, 60 Bridge manifest files**. These are provenance checks on the owner machine, **not** evidence that GitHub can independently rebuild the full NSIS.
- Outstanding runtime work (as recorded in the owner pilot receipt) includes Memory 20-ID reboot validation, translation 8-MID reboot validation, Page platform seen, WhatsApp provider ACK, physical DPI and Tailscale recovery. No real send or provider confirmation was attempted by this YEN-15 audit.

## GitHub source parity — selected v22 Page/Host/Bridge critical files

Compared **13 owner source files** against the reviewed code of PR #13, whose head is based on the post-v19 integrated source. Read-only SHA-256 compared exact bytes and LF-normalized bytes:

| Result | Files |
|---|---:|
| Owner source files present | 13/13 |
| Exactly matching PR #13 | **0/13** |
| Already tracked in PR #13, but content different | **8** |
| Absent/untracked in PR #13 | **5** |
| Differences explained solely by CRLF/LF | **0** |

The scope covers original cloud-client visible-read, original DSH Host route, Page peer crosswalk, native social read, Bridge ingress and platform acknowledgement. These changes must be reviewed **together**. Earlier v19 source receipts and v21 audit cannot be treated as v22 parity. The 13-file selection is high-risk focused, **not an exhaustive v22 source manifest**.

Pure scoped owner-source Page read/identity/ACK-safety tests: **34/34 pass**; no live provider call, no message sent. Existing PR #13 isolated Windows mock review: **29/29** selected tests passed. The public-source scanner on the isolated review worktree: **500 files / 0 rejected**. An isolated PR checkout is not the installed binary.

## PR / CI status

- PR [#3](https://github.com/wangyi198675-coder/YENRA/pull/3) remains **Draft** and targets v19 from main; no independent NSIS reproducibility.
- PR [#13](https://github.com/wangyi198675-coder/YENRA/pull/13) remains **Draft**, stacked on PR #3, integrates earlier post-v19 specialists; **not v22 complete source**. Its prior head `315a4ab` Actions [43888191804](https://github.com/wangyi198675-coder/YENRA/actions/runs/43888191804) had 3/3 source review jobs passing (source privacy, Windows pinned plugin build, Linux pinned plugin build).
- PR [#7](https://github.com/wangyi198675-coder/YENRA/pull/7) has `mergeable=false` against its existing parent, while PR #13 has `mergeable=true` only against its **stale stacked base**. Mergeable is not release ready.
- PR #3 Actions [43832559612](https://github.com/wangyi198675-coder/YENRA/actions/runs/43832559612) has a deliberately **failed independent Windows NSIS private input gate**; 13 pinned private archives / original bootstrap resources are not available to an untrusted public runner. **Do not bypass the blocker or upload private archives.**
- No direct main merge or installed-app change authorized by this audit.

## Security / publication checks

- Limited owner v22 review: 13 selected source files checked for common GitHub/OpenAI/Slack token formats, PEM private keys, Bearer token literals, email addresses, international phone numbers, private local-home paths and auth query tokens: **0 signature matches** in those categories. This is a narrowly scoped static regex check, **not** a full secret/history audit.
- **11/13** selected source files include deployment-specific Cloud Inbox/account identifiers. They must be decoupled into owner-only configuration or carefully verified public-safe test fixtures **before** publishing actual modified source. Hardcoded identifiers are an outstanding privacy/portability concern, not by themselves credential disclosure.
- Public worktree scan checked 500 files, 0 rejected, but this scanner has not scanned private build inputs, installed profile, full owner runtime or all local v22 files. Never publish the original credentials, account Profile, contacts, real messages, private W25 content, installer, backup archives, or owner-only private binaries.

## Third-party and original-code license review

- Exact pinned original [DeepSeek Harness LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/LICENSE): **MIT**; preserve attribution and copyright notice if redistribution is authorized.
- [Chatwoot community/core LICENSE](https://github.com/chatwoot/chatwoot/blob/develop/LICENSE): **MIT Expat** for non-enterprise parts, with upstream and third-party exceptions. [Chatwoot enterprise/LICENSE](https://github.com/chatwoot/chatwoot/blob/develop/enterprise/LICENSE) has **separate restrictive terms**; **do not include** enterprise implementation source or infer redistribution rights from a paid Chatwoot Cloud subscription.
- One tracked npm `package-lock.json` in the PR review branch: 13 packages declare license metadata, **12 MIT / 1 BSD-3-Clause, 0 undeclared**. This covers only that file, **not** the 32 runtime dependencies, private plugin archives, or all 42 compiled bundles. Full license files and notice obligations still need review.
- The examined PR #13 checkout has **zero tracked `LICENSE`, `NOTICE` or `COPYING` files**. The project owner still must choose and apply the license for **YENRA-owned original work** without relicensing third-party code. Public GitHub visibility is not a license grant.
- Mature messaging-inbox, original social SDKs, binary redistributables and dependencies remain unverified. Record pinned sources/versions, upstream notices, modified file boundaries and redistribution rights before source promotion.

## Required next gate / non-merge decision

1. Establish immutable **installed v22 source and packaged bundle mapping for all release-critical files**, beyond this selected 13-file audit. Capture hashed source manifest with private inputs retained only on the authorized owner builder.
2. Prepare an isolated v22 source overlay based on the reviewed, immutable current installation, **without overwriting** PR #13's retained Memory, Modify, WhatsApp no-retry, translations or Persona changes. Preserve the original DSH/Cloud unique Sender/Agent/DB architecture.
3. Remove deployment-specific identifiers from publication candidates using owner-scoped config, keeping real runtime behavior intact; rerun secrets/PII/license scanner on **every** staged public file and inspect results manually.
4. Complete third-party license inventory including original social/messaging code, private plugin bundle attribution, community-versus-enterprise boundary and root YENRA-owned source license decision. Keep licence evidence and a NOTICE inventory where required.
5. Provision authorized **confidential** pinned build inputs (never public runner secrets) and perform an independent Windows NSIS build + installed package and four-channel regression checks; only then decide whether to merge PRs and mark YEN-15 Done.

**Disposition:** PR #13 remains Draft; GitHub main and owner installed v22 remain unchanged. No friend-computer action.

## Extended: all 60 released v22 Bridge manifest entries (not just the selected 13)

Independent read-only SHA-256 comparison against the **owner v22 frozen 60-file Bridge manifest**, plus the actual **installed Windows Bridge resource directory**, current owner formal source and the code in the reviewed PR #13 branch:

| Check | Exact results |
|---|---:|
| Installed v22 Bridge files present | **60/60** |
| Installed v22 Bridge files byte-for-byte equal the frozen manifest | **60/60** |
| Current owner source files present | **60/60** |
| Current owner source files byte-for-byte equal the frozen manifest | **60/60** |
| PR #13 Bridge files tracked | **59/60** |
| PR #13 files byte-for-byte equal v22 release manifest | **55/60** |
| PR #13 tracked but outdated/different | **4** |
| PR #13 missing/untracked | **1** |

The five precisely outstanding release-delta paths:

- **Missing:** `social-adapters/chatwoot-cloud-direct/cloud-page-visible-proof.mjs`
- **Different:** `social-adapters/chatwoot-bridge/src/index.mjs`
- **Different:** `social-adapters/chatwoot-bridge/src/server.mjs`
- **Different:** `social-adapters/chatwoot-cloud-direct/cloud-platform-ack.mjs`
- **Different:** `social-adapters/chatwoot-cloud-direct/cloud-wa-recent-sync.mjs`

This proves **Bridge installed/source release parity** on the owner computer; it is still not full YENRA application, UI/Host, Memory, license or GitHub installer reproducibility parity.

A deliberately limited static regex scan of these 60 owner source files detected **zero** common token, PEM private key, bearer string, personal email, international telephone number, or private local-home path signatures. It found deployment-specific Cloud account/Inbox identifiers in **28 of 60 files** (151 pattern matches). No values or raw source from the owner build are included in this public report. Identifiers are not equivalent to secret tokens, but require a reviewed owner-only config/public-fixture boundary. Do not upload any unreviewed owner files wholesale merely to improve the 55/60 GitHub score.

The prior 13 selected Page/Host/Bridge source comparison includes non-Bridge UI/Host modules and is a separate, overlapping scope; **do not sum their differences**. No runtime, installation, platform send, contact or account state was changed by this comparison.

## Extended: actual installed v22 offline plugin archive license metadata

Read-only inspection of the 13 active `file:./packages/` offline plugin tarballs referenced by the *installed* v22 profile seed package metadata (archive `package/package.json`, no content copied to GitHub):

- Installed seed lists **32 dependencies**: 13 original local plugin archives and 19 other declared dependencies.
- Of the **13 actual local archived package manifests**, **7 declare `MIT`**, **6 have no `license` field**, all archive metadata could be read.
- The 6 undeclared package metadata entries are: `@yenra/brain-host-overlay`, `@yenra/chatwoot-embed`, `@yenra/desktop-ui-candidate`, `@local/yenra-private-themes`, `@local/yenra-typography-fix`, `@local/yenra-personal-chrome`.
- The seven MIT-declaring packages include the pinned DSH subagent plugins, memory plugin, IM plugin, Codex OAuth, model settings and health plugin.
- **UNDECLARED metadata is NOT proof of a license violation or a negative licensing determination**. Confirm original ownership, third-party copied source, exact upstream version and actual included license/NOTICE text separately; `package.json` metadata alone is not conclusive.
- **The remaining 19 declared dependency nodes and transitive packages were not fully licensed/audited by this archive-only check.** The public KT lockfile 13-node metadata check is a separate, smaller dependency graph and must not be treated as covering the entire app.

The previously reported root YENRA original-work license decision and upstream redistribution clearance therefore remain **release blockers**.

## Additional public-branch exposure / source-audit rule gap

Ran a **read-only all-tracked-files scan** on the isolated PR #13 review checkout, rather than only the v22 release-critical 60-file Bridge subset. This checked 500 tracked source and documentation files for the *owner deployment's known Cloud account/Inbox numeric identifiers*. Results:

- **132 of 500 tracked files** contain at least one deployment-specific identifier.
- **735 literal matches** across those files, including preserved historical v18 baseline code, original DSH patch and active review source modules.
- These identifiers are **not authentication secrets** by themselves; the scan did not prove credential leakage, public API access, or any account compromise.
- Nevertheless the existing generic `audit-public-source.mjs` passed **500 / 0 rejected** because this deployment-identifier rule **was not part of its denial rules**. Thus passing generic credential scans does **not** establish full compliance with YENRA's private deployment-config policy.
- Do not publish new unreviewed source containing identifiers. If redacting or migrating already-public branches, recognize that replacing strings on a new HEAD does **not** remove them from earlier Git history and that ordinary git history rewriting may conflict with protected main and existing worktrees. Plan any cleanup and public-version portability review separately, with Owner authorization and no forced branch rewrite.
- Keep the platform/API session boundaries as the actual authorization controls. Deployment IDs alone should never act as authorization tokens. No credential rotation is implied solely by a numeric identifier occurrence.

The present report intentionally does not repeat any owner identifiers or private values. This is a **privacy portability/review blocker**, not a claim that the repository exposes a login credential.

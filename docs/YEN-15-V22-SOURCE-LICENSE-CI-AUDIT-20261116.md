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

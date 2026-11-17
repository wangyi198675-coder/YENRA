# YEN-15 — 2026-11-17 installed v23 / GitHub PR / NSIS / privacy / license audit

**Status: NO-GO for public merge or release.** This is a hash-only source/publication review of an already installed **owner-private UI pilot**. It is not a public GitHub independently reproducible NSIS build, a platform message receipt, a formal release approval, or a friend-machine acceptance test.

## Current source-of-truth and actual installed application

- Authorized owner desktop: `DESKTOP-029FH47`; direct running `YENRA.exe` file version: **`0.2.1-rc.5.20261117.23`**.
- Original owner project `<OWNER_SOURCE_ROOT>`: local Git `main` remains `f1b91c2`; existing uncommitted README/.gitignore changes were not touched. The protected public `main` is not equivalent to the complete installed release source.
- v23 is explicitly recorded in the owner packaging evidence as **`OWNER_PRIVATE_PILOT_NOT_FORMAL_RELEASE`**.
- Recomputed SHA-256 from the actual owner-built unsigned NSIS file: **`5f0c2a5aa12fa5edb719bc20e3a844411bfee81ca9abaf85967add9b30aeb56e`**, **709,991,194 bytes**, exact match to original v23 build receipt.
- Recomputed SHA-256 from the **actually installed** v23 UI tarball: **`a7041c3c0aad3345fd657e5eca8f9fa8a6bbad49594890fc5bd71f3290c941c1`**, exact match to stage and build receipts.
- Recomputed SHA-256 from the **actually installed** original Bridge manifest: **`ddfaf629a93333919d9dc2c1639af284ae8323420499e04d7ae0d7bfb8727dca`**, unchanged from v22 and matching the build receipt.
- v23 installed client SHA **`630134e332b93005ecc2578259417abe96f603faadac5600cd428b5220f45a90`**; installed Host bundle receipt SHA **`ea9020c6d321765ee071fb607343da65dc580f1d302d1a1e9c5bf69b18a4ba7c`**.
- Existing owner independent **package-integrity validation** receipt: **62/62 success**. Actual owner-installed runtime smoke receipt: **18/18 success**, four original Bridge accounts; app running. Those are local artifact and basic runtime checks, **not** a clean independent GitHub rebuild.
- Explicitly not yet proven by v23 pilot: real Win32 all-button physical clicking, ten resize cycles, 125%/150% DPI, true Meta Page seen and WhatsApp platform ACK, and complete Owner formal release acceptance.
- v23 stage record explicitly notes that newly proposed Page SDK sources and the late WhatsApp RC13 ACK change were **not included** in this pilot. Do not claim those features are present merely because generic Host/Bridge anchors pass.

## Actual source provenance and GitHub divergence

- Owner v23 **retains v22 original 60-file Bridge manifest unchanged**. Read-only comparison: **60/60 files present and SHA-equal in installed Bridge**, and **60/60 present and SHA-equal in owner formal source**.
- Public GitHub PR #13 **55/60** v23 release Bridge source hashes match: **1 missing**, **4 different**.
- Missing: `social-adapters/chatwoot-cloud-direct/cloud-page-visible-proof.mjs`.
- Different: `social-adapters/chatwoot-bridge/src/index.mjs`, `social-adapters/chatwoot-bridge/src/server.mjs`, `social-adapters/chatwoot-cloud-direct/cloud-platform-ack.mjs`, `social-adapters/chatwoot-cloud-direct/cloud-wa-recent-sync.mjs`.
- The separate v23 UI/Host delta and proprietary/private contact UI logic are **not established as identical to the public v19/post-v19 review source**. Do not copy the private UI or build packages to GitHub without a per-file public source and license review.

## PR conflicts and CI

- [PR #3](https://github.com/wangyi198675-coder/YENRA/pull/3): **Draft**, base protected `main`, still v19-oriented.
- [PR #13](https://github.com/wangyi198675-coder/YENRA/pull/13): **Draft**, base PR #3's source branch, **mergeable only against its outdated review parent**. This is NOT a ready-to-merge, up-to-date v23 release.
- [PR #6](https://github.com/wangyi198675-coder/YENRA/pull/6) and [PR #7](https://github.com/wangyi198675-coder/YENRA/pull/7) remain **`mergeable=false`**. Unresolved source conflicts and release drift are not removed by PR #13 merely being mergeable against its parent.
- Existing PR #13 Actions [43922383097](https://github.com/wangyi198675-coder/YENRA/actions/runs/43922383097) completed **3/3 legacy source review and Windows/Linux pinned TS bundle jobs SUCCESS**, but **v22 publication admission failed** on source parity, deployment IDs and missing license approvals.
- Existing PR #3 Actions [43832559612](https://github.com/wangyi198675-coder/YENRA/actions/runs/43832559612): **independent NSIS input provenance blocked** because required private archives were correctly absent from the untrusted public runner. Never bypass this by uploading private build inputs.
- New v23-specific `docs/v23-owner-pilot-installed-provenance.json` contains only safe hashes/metadata; new `scripts/ci/check-v23-release-admission.mjs` prevents a private UI pilot from being promoted as independently rebuilt or signed-off. An additional v23 CI admission job now requires a real **approved confidential independent NSIS rebuild receipt** and owner acceptance, otherwise fails closed.

## Privacy / secrets

- Existing generic public-source pattern scan had **0 rejections**, but separately added deployment identifier screening previously identified **132 tracked files** with literal deployment-like numbers. Those numeric identifiers are **not passwords or OAuth tokens**, and their presence does not prove compromise.
- Public Git history and owner-specific settings still need scoped review. Replacing source text in a new commit does **not** remove historical records. Do not rewrite protected public `main` or force-push without an approved history/privacy migration plan.
- Neither this report nor new v23 hash manifest publishes original owner account values, contact names, private messages, login credentials, profile, signed provider tokens, raw original plugins, screenshots or installer binaries.

## Licensing and distribution

- Official pinned DeepSeek Harness `b830ec950faba0a46dda564be3e2d854afed94f1` is MIT, with notices required for redistributed substantial source/binaries. Chatwoot community/core is MIT Expat but `enterprise/` uses separate restrictive terms; a subscription does **not** authorize source redistribution.
- Owner v22 original offline plugin archive inventory (13 packages): seven declared MIT, six had `license` metadata **undeclared**. v23 carries 13 original plugin slots; this audit does **not** assert every archive's license automatically changed or was approved merely by version upgrade.
- Root YENRA original-work `LICENSE`, verified `docs/THIRD_PARTY_NOTICES.md` and owner-approved `docs/v22-release-license-approval.json` remain absent in the reviewed public source. New v23 approval is also absent. Do not generate fictional approval or claim that absence of a package.json license field proves infringement.
- A substantive notice/redistribution review is still required for mature inbox/social SDK dependencies, the other direct and transitive dependencies, original DSH notices, modified third-party sources and the final app binary.

## Mandatory exit criteria (YEN-15 remains In Progress)

1. Freeze installed **v23** complete source and bundle provenance, including UI/Host overlay and 60-file Bridge, without changing live owner app or original single Agent/Sender/chat database.
2. Reconcile the four differing and one missing Bridge sources with other PRs' distinct Memory, Modify, WhatsApp no-auto-retry, translations and Personal/Page read logic, using isolated review branches and strict public whitelist/PII screening.
3. Review and address deployment-specific identifiers in current source and Git history; preserve owner-only configuration and account/session authorization. Do not leak private or proprietary data.
4. Resolve genuinely conflicting Draft PR #6/#7 where appropriate without discarding specialist fixes. Do not merge any old Draft into main until current-release provenance is established.
5. Audit all licenses and upstream third-party notices, select original YENRA-work license with Owner authority, and attach substantive signed-off approval only when legally and technically supported.
6. Independently rebuild official Windows NSIS with approved protected private inputs, reverify installed hashes, then obtain YEN-6/Owner's full real-world GUI and provider acceptance for any formal release.

**No actual installation, runtime change, provider send/read state mutation, friend-machine work, PR merge, forced push or protected main update was carried out by this YEN-15 audit.**

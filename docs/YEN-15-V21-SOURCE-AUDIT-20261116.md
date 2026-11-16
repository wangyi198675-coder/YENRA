# YEN-15 / v21 installed-source parity and CI gate (2026-11-16)

This is a **source-review receipt, not a release approval**. It contains no private build inputs or owner credentials.

## Actual owner release baseline
- Windows installed YENRA executable FileVersion **0.2.1-rc.5.20261116.21**; the Windows installed-program registration independently reports the same version.
- Existing owner-only official Windows NSIS candidate proof: **708272389 bytes**, SHA-256 `286840a87c3c2b0dd6384c8a06f469b1f470aa19837059da3b42e37793314517`.
- Existing owner-only independent candidate verification receipt: **37/37 checks passed, 0 failures**. Its status field `packageCandidateOnly` describes the pre-install verification stage. Subsequent Windows installed-version checks prove v21 is now installed.
- The public repository does **not** contain the private package, original authorized profile, platform state, bootstrap resources or locally installed package.

## Public branch and independent source checks
- Main currently tracks the limited reviewed source commit `f1b91c2`.
- Draft PR #3 freezes published **v19** source, not the current v21. Draft PR #13 at `753b3b2` is a **post-v19 source integration review**, not a v21 reconstructed official installer.
- On an isolated owner Windows PR #13 worktree, executing the repository source audit reported **500 files / 0 rejected**; five targeted mocked test modules reported **81/81 pass**, **0 fail**. No platform send or installation performed.
- GitHub Actions PR #13 source review run [43870486338](https://github.com/wangyi198675-coder/YENRA/actions/runs/43870486338): sensitive-source guard SUCCESS, pinned Windows DSH TypeScript bundle SUCCESS, pinned Ubuntu DSH TypeScript bundle SUCCESS.
- GitHub Actions PR #3 run [43832559612](https://github.com/wangyi198675-coder/YENRA/actions/runs/43832559612): public source guard, Windows/Linux locked plugin builds, mocked Windows regressions SUCCESS; independent full Windows NSIS provenance job **FAIL** because 13 original private archives and platform resources are not securely provisioned to the runner. The red job is a real release blocker, not an instruction to bypass CI.

## Checked source drift (current owner source vs PR #13)
SHA-256 of exact source files, read-only:
| Source path | Owner source | PR #13 | Exact match |
|---|---|---|---|
| `ui/chatwoot-embed/desktop-integration-candidate/src/client/ui.tsx` | `6e637055e060205cd24479f8440b45099fecf43e0e148ec4a2d050bd54b9c48c` | `2cf58b8d34bc508b04d32027d0efc301ddae41d779ef918b7f702e5f9fb9ae8f` | **NO** |
| `ui/chatwoot-embed/src/client/cloud-native-inbox.tsx` | `7bf428def62cb271a0f57094248cc3a3907cf6034f5444e4844ded03b50fd4ed` | same | YES |
| `social-adapters/chatwoot-cloud-direct/cloud-wa-recent-sync.mjs` | `96b1de5c11cd7a4757ffae8b98dd43a326818f219f39cf95f6c6a4bd1c6293ba` | same | YES |

These source-file comparisons do **not** by themselves prove the exact installed v21 bundle source mapping; require a frozen v21 source manifest and packaged-bundle reconciliation before claiming installed/source parity.

## Licence and conflict gate
- In the PR #13 worktree, `git ls-files '*LICENSE*' '*NOTICE*' '*COPYING*'` returned **zero tracked license/notice files**. Original YENRA code licence is not yet granted; do not infer a licence from repository visibility.
- Upstream DSH is pinned to its independently traced MIT source; Chatwoot community/core and any enterprise components have different distribution implications. Verify exact upstream version, redistribution rights, bundled notices, and the remaining mature inbox/social dependencies before any open-source release.
- PR #13 consolidates conflict-reviewed post-v19 repairs; it is mergeable relative to its stacked base but **remains Draft**. Draft specialist PRs #6, #7 and #9 report mergeable=false against their existing bases; do not resolve those by overwriting PR #13 or deleting tests. Require feature-by-feature provenance and independent tests for every incorporated patch.
- Private resources are owner-only; never upload token, auth state, history, contacts, media, private archive, installation images, or the owner runtime to this public repository.

## Required release admission
1. Capture an immutable, **installed v21** source + official bundle + protected input receipt and compare it against reviewed GitHub files. Explain the differing `ui.tsx` rather than copying a local file wholesale.
2. Merge conflicts only in an isolated branch/worktree, keeping unique DSH/Cloud sender and message database constraints and all specialist regressions.
3. Approve original-code licence and each upstream notice/redistribution obligation, after a thorough scoped disclosure scan.
4. Provision verified private build inputs in a confidential, controlled builder; independently reconstruct the official Windows NSIS package and compare expected artifact metadata. Keep public GitHub runners without credentials.
5. Get **all required jobs green**, native release Owner approval, and actual Windows installed runtime verification before any release or Linear Done.

**Status: BLOCKED / In Progress.** Existing Windows v21 and contact data were not changed by this source review.

## Additional verified Page native-read source gap

A read-only diff of current owner source vs PR #13 identifies the `ui.tsx` delta as **71 added lines** of the Page human-visible native-read request to the original DSH Host. Its corresponding `ui/desktop-candidate/src/social-media-host-route.ts` has **58 additions and 1 deletion** in the owner source relative to PR #13 (SHA-256 owner `bfd4f5bbb2e6997d003d16c2554c50fd6c2999024b22603e96426acfd221a9ba`, PR #13 `2b9681c36a3947e5f49e9346899ddc81d66789cf81254b18b2b81dbb0d0ed1c0`). PR #13's currently reviewed source does not contain the corresponding Page-read endpoint string, so front-end-only copying would introduce an unsupported route.

Review the **paired Host and UI changes** together against the immutable v21 packaging inputs; preserve the visible-open, identity, original Meta provider and refusal semantics. Deployment-specific Cloud inbox identifiers must not be introduced unreviewed into public source. A provider-level accepted request must not be misrepresented as a recipient-side independently confirmed read. These results do not prove that the post-v19 candidate or the latest owner source is byte-for-byte the installed v21 bundle.

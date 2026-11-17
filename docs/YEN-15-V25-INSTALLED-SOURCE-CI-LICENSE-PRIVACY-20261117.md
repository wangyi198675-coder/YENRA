# YEN-15 — Actual installed v25 source, NSIS, CI, license and privacy admission

**Current scope:** owner-installed `0.2.1-rc.5.20261117.25`. **Status:** PRIVATE OWNER INSTALL VERIFIED; PUBLIC SOURCE / PUBLIC RELEASE **NO-GO**. This report contains only file hashes, code-path names, aggregate counts and technical findings. No private runtime files, binaries, original profile, tokens, account identifiers, contacts, messages, images, raw private SDK files or plugin archives were uploaded.

## Read-only owner-installed evidence (verified again on the actual installation)

| Check | Observed proof | Conclusion |
|---|---|---|
| Running YENRA.exe | FileVersion `0.2.1-rc.5.20261117.25` | Actual installed v25 |
| Official original Windows NSIS | 706,571,381 bytes, SHA256 `aa0b3ac2a660ff43ba6001f3a4741b91673ce2832a6a1de11f2e423c840aed05` | Exact owner build proof |
| Installed UI offline archive | 863,051 bytes, SHA256 `5ea4d995686236f0b3cb54404f7710297d64967f63d37e9a4bf063a990ea1442` | Exact owner v25 seed |
| Installed original Page Host | 564,100 bytes, SHA256 `c6cca8b97d485385082c25433aeb2ca614e7e0b3c9da383f1264f955a2bfb538` | Corrected Page read Host, not old a958… |
| Installed client | 816,994 bytes, SHA256 `40029f72258c1d506664f3db4ff23006b297a68bf83733ff7f21e49d75dd95cf` | v25 HH:mm and original reply controls |
| Actual installed/stage seed package.json | SHA256 `809675924691b7e50651c930bee884fa5e385daf66dc41ffe4b85fd96526f615` | Both exact |
| Actual installed/stage pnpm-lock | SHA256 `b6ad8285bb1d31751a991acc24b9108bdc1b0d885965703ad1c4afe523de9fde` | Both exact |
| Installed/stage Bridge manifest | SHA256 `ddfaf629a93333919d9dc2c1639af284ae8323420499e04d7ae0d7bfb8727dca` | Both exact |
| Original DSH-IM | `5.10.0-yenra.rc5compat.14`, TGZ SHA256 `57c8ad8db21c2e4e45c1cc979dc780541a78636fd829d8dbec769f1886cbaa37` | Correct rc14 version and pinned seed |
| Active plugin archives | All 13 stage/installed TGZ pairs SHA-equal | 13/13 |
| Original Bridge source files | Stage/installed 60/60 SHA-equal to frozen manifest | 60/60 |

The existing private installer proof reports **76/76** real NSIS package-integrity checks. The read-only, noninstalling `Assert-YEN17-InstalledReleaseParity-20261117.mjs --mode full` was **executed again for this audit**, returned **exit 0, 30/30 PASS**, installed v25, `releaseGo:false`. These are private packaged bytes and current installation checks, **not** an independently reproducible public GitHub source-to-NSIS build or external provider receipt. The owner also previously observed the new v25 Cloud HH:mm in 8/8 actual native time elements; that was not re-exercised by this source review.

## Source-to-GitHub parity: not yet achieved

- Installed v25 retains the original 60-file Bridge: local installed/stage/original owner source were exact, but the reviewed public PR #13 source is only **55/60 exact**. One original Page proof file is absent, and the original bridge index/server + Cloud platform-ACK / WA recent-sync sources differ. This is a real current source mirror gap, not a runtime v25 defect.
- The reviewed GitHub code branch is stacked on old v19/v18 Draft source. Seven sampled critical existing Host/Client/route files differed from formal owner source; one new Page native read helper was absent. These targeted findings do not replace a full all-file source manifest and independent rebuild.
- The updated v25 compiled Host and Client SHA are **not proven reproducible from current GitHub source**. The old Page-only Host is not a safe whole-file replacement; do not regress WA Presence, Memory Adopt, translation, private Contacts, official UI, original Sender or Cloud-only message source.
- Existing PR #3 and PR #13 remain Draft. The fact PR #13 may merge into its older base does not establish v25 parity or authorize main merge.

## License & attribution findings from the **actual v25 offline archives**

All 13 installed v25 archive `package.json` files were inspected **read-only**. **7 declare MIT**; **6 declare no license field** (the six are private YENRA/local packages). Four of the MIT-declaring archives included a package-root LICENSE/NOTICE/COPYING file; some declared MIT packages have no package-root notice file, which requires attribution review. `@xmanrui/dsh-im` rc14 declares MIT and includes a LICENSE.

The original compatibility Page SDK package itself has `private:true`, no declared license, and no top-level LICENSE/NOTICE/COPYING. Its exact provenance and permitted distribution need verification. Do not upload its raw source or DPAPI/account-store contents to a public repo without a documented authorization and secret/PII audit.

Pinned original DeepSeek Harness is MIT, and Chatwoot community/core is MIT Expat with specific terms; Chatwoot `enterprise/` has separate restrictive terms. A paid Cloud subscription does not automatically confer source redistribution permission. YENRA original-code licensing, relevant attribution for upstream and third-party components, direct/transitive dependency licensing and a real authorization receipt remain incomplete. **Undeclared metadata does not prove infringement; it does not authorize redistribution either.**

## Privacy and CI boundary

- Prior public PR #13 privacy gate detected **132 tracked files with deployment-like numeric identifiers**, despite the generic secret scan passing; numeric deployment IDs are not themselves proof of compromised credentials. This is an unresolved disclosure/privacy-history audit. Removing current source values later will not erase them from previous public Git commits; no protected-branch force-rewrite authorized.
- The new `docs/v25-owner-installed-sha256-only-provenance.json` and `scripts/ci/check-v25-installed-public-source-admission.mjs` contain only SHA256 values, package counts and generic technical paths. The public CI requires 60/60 actual v25 Bridge source equality, independently reproducible **public** Host/Client/NSIS hashes, original-code LICENSE, verified third-party notices, privacy-history clearance and owner-approved release sign-off. It deliberately refuses to infer these from local owner evidence.
- Existing `scripts/ci/audit-public-source.mjs` and public deployment-ID screening run alongside the v25 gate. **A green generic scanner/build alone cannot approve public redistribution.**
- All current open historical publication gates remain fail-closed. They must not be disabled to produce green checks.

## Resolution criteria and authority

1. Preserve actual installed v25 as source-of-truth; protect the private owner install/profile and existing release rollback.
2. Produce a clean private **full** v25 source manifest and an authorized public-source whitelist. Reconcile the 5 Bridge and critical Host/UI differences without transferring live private account configuration or duplicating Agent, Sender, database, model gateway or Electron host.
3. Audit the public branch and Git history for deployment identifiers and other secrets/PII; agree a controlled remediation plan for historical content. Never blindly force-push the protected main branch.
4. Complete original-work/third-party SDK provenance and license attribution. Do not self-assign original YENRA copyright ownership or create a fake approval.
5. Prove exact public-source-to-Host/Client reproducibility and separately run an authorized **protected** Windows NSIS rebuild where original proprietary/private inputs can legally be supplied. The exact owner-installed v25 NSIS hash must be correctly scoped: public rebuild proof cannot assume deterministic package bytes unless independently verified.
6. Owner/YEN-6 accepts actual platform/GUI runtime gates separately; a true private owner install can be valid even while public redistribution remains **NO-GO**.

**Review disposition:** v25 private installation hashes verified and frozen; v25 GitHub source mirror, third-party licensing and privacy/history clearance **blocked**. YEN-15 stays In Progress. This review did not send messages, alter Cloud/contacts/credentials, restart or reinstall the application, access friend machine, or upload private source/binaries.

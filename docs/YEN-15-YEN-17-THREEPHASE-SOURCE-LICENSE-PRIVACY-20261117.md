# YEN-15 + YEN-17 | Real three-phase next-owner-install wiring and source/license/privacy review

**Disposition:** OWNER v25 INSTALLED/EXACT BYTES VERIFIED. **NEXT PRIVATE RELEASE AND PUBLIC SOURCE MERGE: NO-GO pending documented findings.** This report is an audit record, not a self-signed licensing approval. It contains no credentials, deployment identifier values, raw private source code, contact/chat records, private SDK, plugin archives, installer binary, machine home path or source maps.

## 1. Three actual execution gates in the owner-local future installation entrypoint

The private owner project now contains the thin release orchestration entrypoint `scripts/Invoke-YENRA-Owner-Next-ThreePhase-GatedInstall-20261117.ps1` (SHA-256 `68b01f4d49086ffd039d58ff7e27a3e7707620596ebb1ff8dc69a46477bc3cb6`). It delegates the actual install to the *existing authorized YEN-6 installer*, not to a second app or second sender. It is not an alternative Electron installation implementation.

- **Before build:** `-PrebuildOnly` executes the original `Admit-YENRA-Next-Official-NSIS-NoRegression-20261117.mjs --phase prebuild`, then the new owner-local original-archive/source whitelist, license and privacy check. It cannot demand postinstall Meta/WhatsApp ACK, physical DPI or new PID.
- **Before installation:** preview/default and `-Apply` both repeat prebuild and privacy gates, execute `Admit ... --phase preinstall --install-script <same entrypoint>`, then explicitly re-execute the original `Assert-YEN17-Complete-OfficialNSIS-20261117.mjs` to inspect actual NSIS/package resources. The current installed v25 passed 30/30 owner installed parity; a v25 stage masquerading as a *newer release* is correctly rejected with exit 12.
- **Authorized private installation:** `-Apply` is impossible without an owner-authorized, exact stage-linked `owner-vnext-authorized-installer.json` matching the actual delegated installer script SHA, official NSIS SHA, version and owner approval. No such approval is created by this gate. If approved, execution goes through the original YEN-6 guarded identity-preserving installer, not an independent replacement installer.
- **After installation:** `-Apply` immediately executes `Assert-YEN17-NextInstalledClient-Postflight-20261117.mjs` and fails closed on any missing real installed GUI/host/identity evidence. `-PostinstallOnly` allows a separate read-only repeat after an authorized install.
- **Formal public release:** remains a distinct decision requiring independent Meta Page seen, true WA provider ACK, actual UI/physical DPI/cold PID evidence, public privacy and licensing, and a reproducible protected NSIS pipeline. A private preview or installer pass never sets formal GO.

All three new private scripts were read, hashed, and **not uploaded to public GitHub**. Their exact SHA-only receipt is in `docs/yen15-yen17-owner-private-three-phase-hash-review-20261117.json`. Public CI validates the safe receipt and separately fails the formal-release gate; it cannot run code on the private owner computer.

## 2. Actual owner-local QA completed

| Evidence | Result |
|---|---|
| Three-phase source order and owner-signoff regression | **10/10 PASS** |
| v24 old broken Page Host / HH:mm / native text buttons / actual NSIS fault injection | **11/11 PASS** |
| Four-channel/Memory/Contacts feature and pre-vs-post phase separation | **8/8 PASS** |
| Current owner v25 installed byte parity, original read-only gate | **30/30 PASS** |
| Original v25 exact official full NSIS package-integrity proof | **76/76 PASS** |
| Same v25 stage misrepresented as newer release | **REJECTED, exit 12** |
| Public distribution of private v25 code | **REJECTED, exit 12** |
| Current v25 full postinstall UI/DPI/cold PID | **NO-GO: five independent real-world evidence gaps** |

The new private script checksum audit found exactly 13 original plugin archives and 60 original Bridge source files. No app installation, account/profile write, real message, forced restart or friend-machine operation occurred. The v25 original installation remains untouched.

## 3. License and privacy audit: review performed, rights not approved

- All 13 original v25 offline package manifests were inspected: **7 declare MIT**, **6 private packages have undeclared license metadata**. Six of the seven MIT-declaring archives have a package-root license/notice. An absent license field alone does **not** prove infringement, and it does **not** grant public redistribution rights.
- The original Page compatibility SDK is marked `private: true`, has no license declaration and lacks a package-root LICENSE/NOTICE. Its original author/redistribution rights still require verification. Pinned official DSH is MIT; Chatwoot community/core and enterprise components have distinct licensing, and Cloud subscription seats do not waive enterprise restrictions.
- Original private IM rc13 and v25 installed rc14 both contain the **same one quoted Google API-key-format constant in the compiled host**. This pattern does not occur in the 283 original native IM source files or 190 plugin build inputs inspected; it may originate in a bundled dependency. The value was **never printed or uploaded**. It must be identified as a public/demo SDK constant or remediated before a future private package can pass the new high-confidence credential gate. Do not declare it a live leaked secret without further evidence.
- The original public PR source privacy check previously flagged **132 tracked files and 737 deployment-like numeric matches**, distinct from the general credentials scanner. These values are not necessarily authentication secrets but cannot be considered privacy-cleared; Git history also requires a controlled review.
- **Five proposed YEN-11 translation + YEN-12 CSS source files** were independently rehashed against specialist handoffs: **5/5 exact**, zero high-confidence credential matches, zero private-home path matches. **Two files contain 52 deployment-like numeric matches**. Therefore these private source files were **not uploaded raw**. Source maps were also excluded. Their source tests are not installed-v25 runtime proof.
- The private-only whitelist source-checker intentionally refuses an unclassified embedded API-key-format constant; public authorization also refuses undeclared redistribution rights and deployment-specific literals. This is the correct fail-closed outcome, not a reason to disable scanning.

## 4. Public CI and merge authority

[Draft PR #13](https://github.com/wangyi198675-coder/YENRA/pull/13) remains on an older v19/v18 review base. Owner-installed Bridge sources were 60/60 exact against v25, but the GitHub reviewed tree remained 55/60, and current compiled Host/Client are not publicly reproducible. No protected `main` merge is authorized.

The new PR workflow now runs a **hash-only three-phase receipt review** as a separate step from the **public release admission** check. The first can pass as evidence-validation, while the latter must remain NO-GO until ownership, privacy, independent protected build and true runtime authorization are resolved. Public CI does not receive private code, build archives or operational credentials.

**Next release Owner YEN-6:** create the sole immutable next stage from v25 + reviewed YEN-10/11/12 changes, then use the newly connected private `-PrebuildOnly` gate before compiling, the same gated preview/`-Apply` entrypoint for the guarded installer, and `-PostinstallOnly` for real-world readback. First resolve the bundled-key-format candidate and acquire real owner-private delegated installer approval; never install an old v24 or current v25 again as if new.

**No false Done:** local functional gate orchestration and hash whitelist QA completed; legal public-source license/privacy clearance and end-to-end future NSIS install remain blocked pending outside facts and a new actual candidate.

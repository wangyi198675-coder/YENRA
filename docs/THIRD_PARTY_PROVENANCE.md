# YEN-15 — upstream provenance and public-source boundary

This document records source origins for the YENRA **public review branch**, not a claim that a full v18 installer is reproducible.

| Component | Provenance | License and policy | YENRA repository handling |
|---|---|---|---|
| Official DeepSeek Harness (DSH) 0.2.1-rc.5 | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), commit `b830ec950faba0a46dda564be3e2d854afed94f1` | [MIT license](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/LICENSE) | Original source is **not copied** into this repository. Owner modifications to 27 official DSH files are preserved as the diff `patches/deepseek-harness-v18-owner-integration.patch` (about 90 KB), which CI applies onto the pinned upstream before plugin builds. GitHub CI temporarily fetches the pinned upstream and installs its locked build dependencies. |
| Chatwoot Cloud and open-source client context | [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) | [Chatwoot license](https://github.com/chatwoot/chatwoot/blob/develop/LICENSE): community/core code is MIT Expat; `enterprise/` has a separate license | Cloud API and UI integration code only; no Chatwoot Cloud account database or enterprise source is committed. |
| Mature messaging-inbox and original social SDK sources | Referenced by existing DSH packaging and runtime | Must be traced to their own upstream source, license and version before redistributing their code or compiled assets | Existing non-YENRA source trees, build artifacts and runtime assets are excluded from this public review branch. This remains a clean-installer blocker. |
| Telephone normalization dependency | `libphonenumber-js` from `social-adapters/kt-dedupe-native/package-lock.json` | License accompanies the installed upstream npm package | Lockfile and integration sources included; `node_modules` not committed. |
| YENRA original bridge, Cloud overlay, UI, persona integration and KT adapter | Owner source `YENRA_SOURCE_ROOT` at the v18 review point | **YENRA repository has no root LICENSE on this branch yet.** The unified Owner must choose its original-code license before declaring the repository ready for third-party reuse. | Source-only migration; four frozen SHA mismatches remain release blockers. |

The Meta Ads UI source is sanitized to open generic official Meta URLs, not owner-specific ad account identifiers. No secrets, personal message history, profile, DPAPI material, contact media, archived installer, or friend-machine data belongs in the public repository.

**No blanket license is granted to code not owned by YENRA.** Preserve upstream notices and any applicable attribution when packaging permitted third-party components. A public repository is not itself an open-source license grant.

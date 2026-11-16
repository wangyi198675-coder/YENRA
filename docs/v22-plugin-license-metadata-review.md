# YEN-15 — v22 installed plugin license review (metadata inventory, not legal approval)

Status: **REVIEW REQUIRED**. This is a privacy-safe transcription of `package.json` metadata extracted **read-only** from the owner's actual installed v22 offline plugin archives. It does not upload, redistribute or include any private archive, runtime profile, executable, credential, contact or conversation.

Original installed profile seed: `0.2.1-rc.5.20261116.22`; 32 top-level dependency entries, including 13 local offline plugin archives and 19 other declared dependencies. The 13 local archives were all readable.

| Plugin | Installed version | Archive package.json license |
|---|---|---|
| `@deepseek-ai/dsh-subagent-claude-code` | `0.2.1-rc.5` | MIT declared |
| `@deepseek-ai/dsh-subagent-codex` | `0.2.1-rc.5` | MIT declared |
| `@guntur-d/dsh-memory` | `0.1.0-yenra.rc5compat.10` | MIT declared |
| `@xmanrui/dsh-im` | `5.10.0-yenra.rc5compat.13` | MIT declared |
| `@yenra/brain-host-overlay` | `0.1.0` | **Undeclared** |
| `@yenra/chatwoot-embed` | `0.3.0-route.9` | **Undeclared** |
| `@yenra/desktop-ui-candidate` | `0.1.0-yenra.unified.20261116.22` | **Undeclared** |
| `dsh-codex-oauth` | `0.1.1` | MIT declared |
| `dsh-model-settings` | `0.2.2-yenra.unified.20261115.2` | MIT declared |
| `dsh-plugin-health` | `3.1.1` | MIT declared |
| `@local/yenra-private-themes` | `1.1.1` | **Undeclared** |
| `@local/yenra-typography-fix` | `1.0.1` | **Undeclared** |
| `@local/yenra-personal-chrome` | `1.0.1` | **Undeclared** |

Counts: **7 MIT-declaring packages, 6 without a license metadata field**. "Undeclared" does **not** prove infringement or that the work is not licensed. A metadata declaration alone also does not prove every embedded file is distributable under that license.

## Attribution and licensing boundaries

- Original official DeepSeek Harness source at `b830ec950faba0a46dda564be3e2d854afed94f1` has [MIT LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/LICENSE), requiring retention of copyright and permission notices on redistribution.
- [Chatwoot community/core](https://github.com/chatwoot/chatwoot/blob/develop/LICENSE) uses MIT Expat with exceptions. [Chatwoot enterprise source](https://github.com/chatwoot/chatwoot/blob/develop/enterprise/LICENSE) has **separate subscription/redistribution restrictions**. A paid Cloud seat does not by itself grant third-party source redistribution rights.
- The one reviewed committed `social-adapters/kt-dedupe-native/package-lock.json` describes 13 package nodes: 12 MIT and 1 BSD-3-Clause according to package lock metadata. It is **not** the entire runtime dependency graph.

## Still required

1. Confirm YENRA-owned contributions and select the **original-code** root LICENSE; do not relicense upstream or proprietary code.
2. Individually trace and review the six undeclared YENRA/local plugin archives, copied mature inbox/social SDK files and any embedded community-versus-enterprise source.
3. Review the other 19 top-level dependency entries and all relevant transitive dependencies, plus the attribution/redistribution requirements of 42 packaged bundles and third-party assets.
4. Produce verified source-specific `docs/THIRD_PARTY_NOTICES.md` and an authorized `docs/v22-release-license-approval.json` only after the substantive review, never to force CI green.
5. Keep the full original private plugin archives and profile out of the public Git repository.

Release license gate remains **NO-GO** pending these items.

# YEN-15｜v18 保护与 v19 源码交接（2026-11-16）

**归属：** GitHub 源码与 CI 专项；v18 已发布不可变，v19 仅为审核候选。
**唯一仓库：** https://github.com/wangyi198675-coder/YENRA
**唯一审核 PR：** https://github.com/wangyi198675-coder/YENRA/pull/3 （Draft）
**任务：** https://linear.app/yenra/issue/YEN-15

## 【正式源码】实际文件、根因与差异

根因：原 PR #3 是早期 v18 工作目录抽取的快照，后续专项 2/4/5/6 修复继续落在主人电脑的正式源码内；既有 CI 错把所有当前源码直接和发布冻结哈希比较，造成 **v19 真实改动被错误判定为 v18 被篡改**。

- 从 v18 官方冻结目录按字节校验并归档 **58/58 Bridge 文件** 到 `baselines/v18/bridge/`。
- 从原冻结目录或 PR 早期确证匹配的源文件恢复 **19/20 个冻结正式源码** 到 `baselines/v18/latest-formal/`；唯一缺失的原始 `ui/chatwoot-embed/src/client/cloud-native-inbox.tsx` 不虚构、不改哈希。
- 保留原来的 `docs/v18-source-hashes.json`，其 SHA-256 固定为 `7d1be9e7d3a2809e0e0b0c7d6a96149b0b8cf8cd6d7731552c36d6669993c232`。
- 新增 `scripts/ci/verify-v18-published-baseline.mjs` 验证以上冻结字节独立不可变；不再将 v19 新源码当作 v18 测试对象。
- 从正式源码按白名单批量接收 **22 个 v19 源码及回归测试文件**，相关 SHA-256、Linear 归属、先前候选 SHA 保存在 `docs/v19-owner-candidate-sha256.json`；校验脚本 `scripts/ci/verify-v19-candidate-sources.mjs`。
- 关联模块：YEN-7（真人建议及防重复）、YEN-9/YEN-10/YEN-14（WhatsApp 原始 MID、ACK、Cloud Webhook、联系人选择与 Bridge）、YEN-11（Cloud 译文/联系人预览）、YEN-12（Windows 拖动/UI）、YEN-8 相关记忆作用域集成。
- 一个 Webhook 测试中原硬编码密钥形态的 **测试数据** 在公开候选里改成动态合成的无效测试字符串；原正式源码未改动，原 SHA 与公开 SHA 单独记录。另两份包含疑似真实号码和主人电脑绝对路径的 QA 测试按自动策略排除，详情见 v19 ledger。
- 保留 `patches/deepseek-harness-v18-owner-integration.patch` 的既有 27 文件上游改动，仍使用固定 DSH 原始提交进行 Linux/Windows 构建；**不复制整个 DSH**。
- 额外归档 13 个 v18 安装包专属离线插件的 SHA、名称、字节数和冻结构建输入哈希至 `docs/v18-nsis-inputs.json`；不上传可能受许可或隐私限制的二进制。
- 公开仓库的安全扫描和实际构建门禁仍严格区分源码与运行数据。

## 【真实执行】已在独立 staging 环境运行

- `node scripts/ci/import-v18-published-baseline.mjs <v18-release-dir> <review-repo>`：58/58 Bridge；19/20 发布源码原件找到且 SHA 完全一致。
- `node scripts/ci/sync-v19-owner-sources.mjs <formal-owner-root> <review-repo> --apply`：22 文件批量导入，两个隐私 QA 排除，正式工程不写入。
- `node scripts/ci/audit-public-source.mjs`：已运行，0 条未排除的隐私或凭据命中。
- `node scripts/ci/verify-v18-published-baseline.mjs`：通过，验证 77 个冻结源文件与原发布哈希。
- `node scripts/ci/verify-v19-candidate-sources.mjs`：通过，22 个 v19 候选哈希一致。
- `node --test` 指定 11 份与本次改动相关的离线回归文件：**100 通过、0 失败**（未发真人消息）。
- `node scripts/ci/check-v18-nsis-inputs.mjs`：明确阻断，公开检出缺少 **13/13 个原始冻结离线插件包**，退出码 12；这不是 NSIS 构建成功。
- GitHub Actions 增加 v18 档案、v19 SHA、双平台独立 UI 插件打包、源码来源与 NSIS 输入门禁；CI 生成的 UI 包只作为审核证据，不自动发布。

## 【运行验证】

主人电脑正式运行基线仍为 `0.2.1-rc.5.20261116.18`；本专项**没有安装、重启、覆写正式软件，没有发送真人测试消息，也没有操作朋友电脑**。v19 未进入正式安装版。100 项离线回归不等于平台出站和已读回执真人端闭环。

## 【剩余问题】

1. v18 原冻结文件 `cloud-native-inbox.tsx` 缺少原始字节，只有冻结 SHA；不能用新文件凑数。
2. 13 个插件 tarball、KT 离线资源、语法资源和正式安装包封装输入尚无法从公开 GitHub 自动合法重建；Windows NSIS 真正干净检出的全包构建**未成功**。
3. YENRA 自研源码尚需总 Owner 明确开源许可证并保留上游版权；无许可文本不代表允许公开再分发所有第三方内容。
4. 专项交叉文件 `ui.tsx`、`cloud-native-inbox.tsx`、`social-agent-actions.ts` 必须由总 Owner 以 v19 最新 SHA 统一合并，禁止用 PR #3 较早代码覆写当前正式工程。
5. 真实 WhatsApp、Facebook Page/Personal 发送、ACK、已读、联系人与译文端到端检查仍由各业务专项及总 Owner 在正式授权环境验收。

## 【交付】

唯一 GitHub PR #3（保持 **Draft**）；22 文件源哈希清单、v18 77 文件归档、双平台构建/回归 CI、安装输入缺口清单和可逆 DSH 补丁均保存在该 PR。**不得将 PR #3 合并或自动发布为 v19，直到总 Owner 审核全部门禁。**

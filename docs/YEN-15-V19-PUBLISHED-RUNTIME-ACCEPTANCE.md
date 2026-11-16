# YEN-15 | 已发布 v19 主人电脑真实运行与 GitHub 对齐报告

验收对象：唯一正式 Windows 主机 `DESKTOP-029FH47`；正式源码目录为主人电脑的 YENRA 唯一工程路径（具体本机绝对路径不写入公开仓库）。本文为 **GitHub Draft PR 的来源核验记录**，不表示已发布下一修正版、也不表示独立 GitHub NSIS 已复现。

## 1. 真实运行和官方 NSIS（2026-11-16）

- 主人电脑 **实际安装并正在运行** `0.2.1-rc.5.20261116.19`；已读取 `%LOCALAPPDATA%\Programs\YENRA\YENRA.exe` 的 Windows FileVersion。观察到 1 个主窗口和 Electron 子进程（非旧 v18）。
- 生产 NSIS：`YENRA-0.2.1-rc.5.20261116.19-win-x64-BETA-unsigned.exe`，**707,406,885 字节**，经本机 `certutil -hashfile ... SHA256` 再次直接读取校验，SHA-256 `8eab5ffdedbc04726e551a2bab853ff43ebbcf171a61b3147979457562144e64`。
- v19 官方独立包检验报告：**87/87 完整性项通过**，包括 13 原始包、42 个原生 bundle、32 个依赖、59 Bridge 文件、1,317 KT 文件和 4 个语法资源。报告的 `ownerInstalled:false` 表示 **校验器不执行安装**，不能否定另行读取到的已安装运行状态。
- 本视窗未触碰安装程序、没有重启 YENRA、没有写联系人或向真人发送测试消息；其他专项的功能交互闭环不在 YEN-15 验收范围。

## 2. 对齐已发布 v19 的源码（不是 v18 隔离代码）

原始 v19 发布冻结文件中记录的 Source 05 manifest SHA-256 为 `5376e69488b9782037027cb22ec7e824b4a143367800f8347bd8e75348f2944b`。新 `scripts/ci/audit-v19-published-source.mjs` 在主人电脑只读检查：

- **96/96** 已发布源码快照文件与完整 SHA 完全一致；首次审计时正式源码目录对该快照的差异为 **0**。但在第二次审计期间，其他专项并发修改了以下发布后候选源码（详见末节），不能把这 3 处新的工作区差异误报为 v19 原发布字节有问题。
- v19 冻结 Bridge **59/59** 文件哈希完全一致；首次审计正式工程相对冻结 Bridge 差异 **0**。第二次审计发现正式工程的 `cloud-wa-recent-sync.mjs` 已被其他专项修改（发布后源码差异 **1**），冻结文件仍正确。
- 对比原 PR #3 候选发现 **9 项差异**；已补齐其中 5 项并记录逐个 SHA：
  `cloud-wa-recent-sync.mjs`、对应回归测试、`cloud-dsh-translator-script.ts`、v19 右键翻译回归测试及对应 tsdown QA 配置。
- **4 项有意不复制原始私有或非便携 QA 代码**：模拟 webhook 的原测试 fixture 在公开版保持等效安全假 secret；私人联系人号码测试 fixture 不公开；两个仅用于主人电脑 CDP / 本地产物收集的 QA 脚本不纳入公开复现源码。例外逐条登记在 `docs/v19-published-release-provenance.json`。
- 先前 22 个源码收据保持可读且校验通过；新增五个 SHA 由 `scripts/ci/verify-v19-published-receipt.mjs` 在 CI 校验。**不修改** v18 `docs/v18-source-hashes.json` 及原冻结哈希。

## 3. 可复现构建前提与已实测的失败边界

- 在主人电脑用 **真正的 v19 发布私有输入**执行 `scripts/ci/check-v19-nsis-inputs.mjs`，结果 `PROVENANCE_INPUTS_VERIFIED_NOT_NSIS_BUILT`：**13/13** 原始插件归档、**1,317/1,317** KT 文件、**4/4** 语法资源字节及锁文件约束全部通过。没有复制、上传或公开这批私有字节。
- 公开 GitHub Windows Actions 没有这些原始授权输入，同一校验应以退出码 **12** 报告 `OWNER_PRIVATE_INPUTS_NOT_PROVISIONED`，而不是伪称成功的独立 NSIS 编译。新增 `docs/v19-nsis-input-provenance.json` 是 **只含名称、字节数和哈希**的发布来源收据。
- 独立 Windows NSIS 全流程的下一步：由唯一总 Owner 批准 **隔离的 Windows 构建环境和受权限控制的私有输入供应**；按相同 SHA 供应 13 个原包、KT/语法资源，复用官方 DSH 指定提交与补丁，锁定 Windows 构建依赖，再生成新的可对照安装包，做安装与真实 GUI 冒烟。**这一整步未获证明，不可作为已闭环报告。**
- v19 官方 NSIS 完整性通过和“GitHub 能从公开源码独立构建同一 NSIS”是两个不同事实。官方包为 unsigned，不能宣称正式代码签名。

## 4. 本轮测试与交付边界

- 新增 v19 MID、防重/UNKNOWN 与右键翻译专项 **31/31 mock 通过**。测试不触发真人平台发送。
- 公共源码安全检查 **0 拦截**；原 v18 冻结档案 **58 Bridge + 19 formal** 源码收据继续通过，仍诚实注明旧 v18 未找回的原始 Cloud UI 单文件（不作为 v19 正式源码依据）。
- GitHub Draft PR #3 仅收新源码 / 测试 / 哈希凭证 / CI 脚本。没有合并、没有正式构建或发布新的安装包。正式源码存在其他 Owner 共有工作，**未覆盖**。
- GitHub 双平台插件编译由本次 PR 的 GitHub Actions 对新增内容重新验证；Windows NSIS 私有输入门应保持如实受阻，直到获得安全供应。

## 5. 发布后并发源码漂移（本轮发现，不回填 v19）

对 v19 发布快照的第二次只读比对出现 **3 个正式工作区更新**：

- `social-adapters/chatwoot-cloud-direct/cloud-wa-recent-sync.mjs`（下一修正版 WhatsApp 同步 / MID 路径，专项 4）
- `social-adapters/chatwoot-cloud-direct/cloud-wa-recent-sync.test.mjs`（相应测试，专项 4）
- `ui/chatwoot-embed/src/client/cloud-merged-header.css`（下一修正版 Cloud UI，专项 6）

已发布 v19 冻结的 96 个快照原件仍 **96/96 完整**，59 Bridge 仍 **59/59 完整**；上述 3 项是正式工作区新改动，不属于本次已发布 v19。YEN-15 保护 Draft PR 内的 v19 发布源码，只向总 Owner 报告其与下一修正版候选的差异，**不覆盖、不自动合入**。

## 6. 需要总 Owner 接收

1. 审阅 PR #3 中 v19 五个源码差异、发布收据、Source 05 审计与 NSIS 私有输入门；与其他专项合并冲突统一处理，不自行合并。
2. 决定可合法再分发的 YENRA 自有代码许可证；第三方包/Chatwoot 权限与私有资源另行审查。
3. 授权独立隔离 Windows NSIS 构建的输入方式与复现验收，不要把本机官方 v19 包直接误报成 GitHub CI 构建产物。
4. 各功能专项按实际运行 v19 另行验收，确认下一修正版修复清单。

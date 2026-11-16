# YENRA · Linear × GitHub × 双机实机验收工作流

> Owner：唯一 YENRA 总发布 Owner。Linear 是任务权威，GitHub 是代码/审查权威，DSH + Chatwoot Cloud 是产品运行权威。

## 固定关联

- Linear 工作区：[YENRA](https://linear.app/yenra)
- 唯一项目：[YENRA · Core](https://linear.app/yenra/project/yenra-core-013990e3f8c0)
- 唯一私有源码仓库：`wangyi198675-coder/YENRA`
- 正式本机目录：`YENRA_SOURCE_ROOT`
- 机器：`DESKTOP-029FH47` / `SJKJ-20260928ZL`
- 源码尚未通过安全审计并正式同步时，不得声明已实现源码追踪。

## 任务驱动流程

1. **登记：** 所有工作先在 Linear 创建或找到唯一 `YEN-数字` 任务，选专项标签和 P0/P1，记录实际问题、根因假设及影响面。
2. **开发：** 从同一个正式代码基线创建分支 `yen-<任务号>-简短描述`，禁止在默认分支直接修改发布代码。
3. **审查：** PR 标题必须含 `YEN-数字`，正文附 Linear URL、修复内容、风险、测试命令、证据和回滚方案。GitHub PR 自动与 Linear 关联；未自动出现时须在 Linear 粘贴 PR 链接确认。
4. **检查：** CI 对分支名称、PR 关联、泄密路径进行最低检查；实际功能测试必须另留证据。CI 绿灯不等于已修复。
5. **合并：** 代码审查通过后才允许合并；涉及平台 Sender、Bridge、个人资料迁移、生产窗口时必须先遵守已有 `AGENTS.md` 身份与发布门禁。
6. **实机：** 主人机和朋友机按同一版本/安装包逐机做可复现验证；保留关键日志/版本 SHA/失败与成功结果。
7. **闭环：** 实际功能验证成功、发布证据和回滚点写入 Linear 后，才能标记 Done。PR merged 不自动等于用户可用，也不能取代人工验收。

## 状态语义

| Linear 状态 | 约束 |
| --- | --- |
| Backlog/Todo | 已登记尚未实施 |
| In Progress | 代码开发或取证 |
| In Review | PR 与回归检查，或者待真实实机验证 |
| Done | 双机（适用时）正式版本 + 真正功能验证 + 证据齐全 |
| Canceled/Duplicate | 必须注明原因或唯一主任务 |

**自动化原则：** GitHub PR 可以改变开发状态，但禁止把合并 PR 直接当作 Done；最终 Done 由唯一 Owner 根据 YENRA 真正的运行验收人工确认。

## 七个专项

- 专项01：双机版本统一、发布、安装包与旧版清理
- 专项02：Yeonhee 完整人格与真人回复
- 专项03：DSH 原生 MemoryService
- 专项04：四渠道消息、Bridge、媒体、ACK
- 专项05：自动双向翻译、持久化与联系人预览
- 专项06：UI、交互、主题、DPI
- 专项07：KT 欧洲查重、原生语法校对

## 私人数据安全

严禁上传：任何授权 Profile、Cloud/Bridge Token、cookie、历史消息、电话号码、姓名/头像、W25/SQLite/PostgreSQL、媒体、应用安装包、日志、`backups`/`exports`/`evidence` 原件。只上传审计通过的代码及去标识化验收报告。上游许可证要求保留，不能复制上游仓库或二次打包侵权。不要从机器复制秘密值到 Linear/GitHub issue。

## 完成报告格式

- Linear issue：
- 根因及同根因影响：
- PR/commit：
- CI 结果及本地测试命令：
- 主人机：版本 + 测试结果 + 时间 + 脱敏证据链接
- 朋友机：版本 + 测试结果 + 时间 + 脱敏证据链接（适用时）
- Cloud/Bridge：唯一 Sender / MID / ACK / 持久化（适用时）
- 统一发行包 SHA/版本及可回滚点：
- 待解决风险：
- Owner 最终人工验收：通过/不通过

## 本次 YEN-5 安全验收

这是**仓库文档和 PR 工作流验证**，不包含任何真人消息、正式源码迁移、YENRA 安装包发布。验证成功只表示开发任务流程可追踪，不代表生产产品问题已闭环。

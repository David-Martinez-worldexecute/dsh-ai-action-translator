# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.4.0] — 2026-11-19

### 新增

- **快捷预设**：三档一键切档（`novice` 完全新手 / `guided` 有基础 / `deep` 深度党）。预设表在 `lib/presets.js` 是唯一事实源，设置页分区与独立页共用；切档只叠加字段，不覆盖用户手调过的人设。`POST /preset` 校验 id，未知 id 返回 400 且不写盘。
- **试一下预览**：`POST /preview` 调用真实的提示词构建函数，把下一轮模型会收到的段落原样回给面板显示（也支持带未保存草稿预览）。不编造示范效果。
- **配置导出 / 导入**：导出只含运行时白名单字段的 JSON；导入先本地解析，坏 JSON 只提示不发请求。
- **运行统计**：`health()` 新增 `uptimeMs` 与 `stats`（`observed` / `sensitive` / `previews` / `saves` / `resets`），全部来自真实事件计数；关闭观察开关后不再累加。
- **协议合规资源**：`locale/en.json` + `locale/zh.json`（Plugin Manager 标题与描述）、原创 `icon.svg`、`docs/DETAIL.md` 详情页；`package.json` 补 `./locale/*.json`、`./icon` 导出与 `files` 条目。
- **测试**：新增 7 条断言覆盖预设表形状、id 白名单、`/preset` 与 `/preview` 路由（含 400/405 分支）。用变异测试验证过：删掉 id 校验后测试确实变红。

### 变更

- `GET /settings` 现在同时下发 `presets`，两个 UI 不再各自维护一份预设表。

### 安全

- 预设只允许运行时白名单字段；`enabled` / `order` 无法通过预设修改
- `/preview` 的草稿字段同样走 `validateOverrides`，未知字段 400

## [0.3.1] — 2026-11-19

首个公开版本。

### 新增

- **固定系统提示词段**：通过 `systemPrompt.section()` 注入讲解规则，让 Agent 在可观察动作前后主动翻译成人话
- **分级讲解**：`knowledgeLevel` 四档（`plain` / `guided` / `balanced` / `deep`）
- **项目地图**：六层结构定位（入口/启动点 → 配置与依赖 → 核心模块 → 工具/服务边界 → 输出/界面 → 测试与验证）
- **阶段小结**：完成可验证小阶段后用 2～4 句承接（完成了什么 / 在地图哪层 / 仍未知 / 下一步）
- **图形配置面板**：DSH 设置页内嵌分区（`client.js`）+ 服务端渲染独立页（`lib/page.js`）
- **只读动作摘要**：订阅 `tools/result` 生成最近动作摘要，不干预任何工具执行
- **敏感工具标记**：`sensitiveTools` 支持前缀匹配，把危险命令单独标出来
- **快捷预设**：三档一键切档（`novice` / `guided` / `deep`），预设表在 `lib/presets.js` 是唯一事实源，两个 UI 共用；只叠加字段，不覆盖用户手调的人设
- **试一下预览**：`POST /preview` 用真实构建函数生成提示词段落并在面板显示——所见即下一轮模型所得，不编造示范效果
- **配置导出 / 导入**：JSON 文件下载与上传，导入前本地解析 + 白名单净化
- **运行统计**：`health()` 暴露真实计数（`observed` / `sensitive` / `previews` / `saves` / `resets`）与 `uptimeMs`
- **协议合规资源**：`locale/en.json` + `locale/zh.json`（Plugin Manager 标题与描述）、原创 `icon.svg`、`docs/DETAIL.md` 详情页
- **隐私检查器**：`scripts/privacy-check.mjs`，扫描本机路径、令牌与私钥形状；含负向自测证明它会失败

### 安全

- 面板仅应答本机回环请求（Host 白名单 + Origin/Referer 同源校验）
- 请求体上限 64KB；未知字段与坏 JSON 返回 400
- 密钥形状字段名主动拦截
- `enabled` / `order` 属结构配置，面板无法修改，只能通过 YAML
- 不使用任何 waterfall 事件，结构上无法否决或改写工具调用
- 零网络代码，零运行时依赖（`@deepseek-ai/schemastery` 只作开发依赖，运行期由宿主提供）

### 已知边界

- 直接手敲 `/api/ai-action-translator/` 会返回 `401 dsh web authentication required` —— 这是 `dsh web` 内核的票据保护，不是插件缺陷。请从设置页分区进入
- 只能解释 DSH 暴露的可观察事实，不读取模型隐藏推理
- 解释不等于授权：删除、覆盖、安装依赖、停止服务、重启 DSH、系统级命令、跨边界读写与内容外发仍需用户明确确认
- **只适配 DeepSeek Harness**：依赖 `systemPrompt.section()`、`settings.section` 槽位、`~/.dsh/` 目录等 DSH 独有机制，不能用于其他 Agent 工具

---

[未发布]: https://github.com/David-Martinez-worldexecute/dsh-ai-action-translator/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/David-Martinez-worldexecute/dsh-ai-action-translator/releases/tag/v0.3.1

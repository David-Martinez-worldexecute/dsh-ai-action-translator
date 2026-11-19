# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.7.0] — 2026-11-19

### 新增

- **事前守门（`guardMode` / `guardLevel` / `guardAllow` / `guardAllowTools` / `guardQuiet`，默认 `off`）**：在工具真正执行**之前**看一眼参数，认出 10 类高风险形状（递归删除 / 关机与改权限 / 读凭据 / 破坏性 git / 写系统目录 / 装依赖 / 停服务 / 外发网络 / 原地覆盖写文件），分 `warn`（提醒后照做）与 `deny`（真拦下，返回 deny 而不是拒绝服务）两档。`off` 时**连 `tools/pre-execute` 监听都不注册**，所以默认形态不碰执行链路、不增加任何延迟。守门只认参数里的字面特征，不猜意图，也不读文件内容。
- **多 Agent 名册**：时间线与面板按 `exec.agent` 标出「这条动作是谁做的」。没有 agent 上下文（系统级调用）时**如实留空**，不猜成「主 agent」——看不见归属比看错归属安全。名册只存在内存里，只记 id / cwd / 计数，不落盘、不读对话内容、不拦子 agent。
- **侧栏常驻面板**：在 DSH 右侧栏注册「动作回看」页签（`sidebar.right.pane.tab`），挂载时拉一次 `/activity`，给时间线、失败案例、术语卡片与 agent 归属。宿主没有 `sidebarRightTabs` 服务时**静默跳过**，设置页照常可用。
- **学习练习册（`drill` / `drillEvery`，默认关 / 3）**：攒够 N 条**真实跑过**的动作就出一张三问卡（「你看到了什么」/「你能复述的技术点」/「下一步练习」），只引用时间线里真有的条目，并明确要求「上面没列出来的动作不要编」。卡片是幂等的：同一批动作只出一次，第二次返回空串。
- **本轮装配说明**：静态提示词段是启动期拼好的，面板上关掉开关后那些文字仍留在提示词里，模型可能照讲。新增一个**每轮现算**的动态 context，明确写出「本轮生效什么、关掉了什么、关掉的不要主动讲」，并强调「无论开关怎么设，安全边界始终有效」。
- **「默认简洁 + 高级选项」两档**：守门、练习册、规则与工具放行名单收进折叠的高级区（`advancedMode`），默认只露最常用的几个开关。

### 修复

- **守门规则 `in-place-overwrite` 永远静音不了**：`evaluateGuard` 没有读 `includeQuiet`，带 `quiet: true` 的规则在 `warn` 下每次写文件都会报一条，正好违背「写文件最高频、默认不报」的设计。
- **「写到系统目录」规则永不命中**：`JSON.stringify` 把 `C:\Windows` 转义成 `C:\\Windows`，而规则正则只认单个反斜杠。现在把原文与反转义后的文本一起喂给正则。
- **「读凭据」规则永不命中**：`read` 在跳过名单里被整体提前放行，而凭据泄露恰恰只发生在读类工具上。改为「跳过名单只跳过普通规则，标了 `alwaysCheck` 的规则照查」。
- **`GET /activity` 把新字段全丢了**：路由是字段白名单转发，数据层加了 `guardRules` / `agents` / `agentSummary` / `drill` / `assemble`，出口层没加，面板和侧栏永远拿到 `undefined`。补进白名单并同步兜底默认值。
- **`drillEveryOf(null)` 返回 2 而不是传入的 fallback**：`Number(null) === 0`。null / undefined / 空串现在视为「没给」，回落 fallback。
- **`validate` 对缺省 `drillEvery` 误报**：老表单没有这个控件时算出 `NaN`，多报一条 problem；现在缺省回落 3（与 `toForm` / `toPayload` 一致，且 `toPayload` 不回落 0——0 会被后端收敛成下限 2）。

### 变更

- 运行时字段 **20 → 28**（`guardMode` / `guardLevel` / `guardAllow` / `guardAllowTools` / `guardQuiet` / `advancedMode` / `drill` / `drillEvery`）。
- 提示词 context **2 → 4**（新增练习册卡与本轮装配说明，两者都是 `text` 函数、关掉时返回空串）。
- `package.json` 的 `dsh.client.inject` 加入 `@deepseek-ai/dsh-client-ui-sidebar-right`。

### 工程

- 测试 **84 → 132 项**，七组：插件契约 18 / 模块 30 / 浏览器半身 13 / 动作回看 23 / 守门 21 / 名册 14 / 练习册 13。
- `npm run check` 覆盖 **9 → 13 个源文件**（新增 `guard.js` / `agents.js` / `drill.js` / `assemble.js`）。
- 装载冒烟扩到真的走一遍：订阅三个新事件、喂一个带 agent 的工具结果、调练习册 context 两次验幂等、调装配 context、用删除命令验 `warn` 放行、再重取 `/activity` 验 `live` 归零。

## [0.6.0] — 2026-11-19

### 新增

- **动作时间线（`timeline` / `timelineSize`，默认开 / 40 条）**：把这一路的工具调用按时间排成只读列表，每条带分类、耗时、成功/失败标记与参数摘要。它**只在面板里回看，绝不注入提示词**，所以看历史不占模型上下文。
- **术语卡片（`glossary`，默认开）**：16 条词表（`waterfall` / `emit` / `peerDependency` / `inject` / `slot` / `HMR` / `manifest` / ring buffer / atomic write / loopback / `401` / `EPERM` / `link:` / 幂等 / sandbox / token）随提示词注入「第一次出现就解释一句、只解释一次」的规则；表外术语要求按可观察行为现讲，不许编造定义。
- **失败案例库（`failureBook`，默认开）**：报错按 8 层归档（鉴权 / 权限 / 路径 / 依赖 / 网络 / 服务 / 语法 / 测试 + 未知兜底），文本先归一成签名（小写、数字与路径替换），同一签名只记一条并累计次数，落 `~/.dsh/ai-action-translator/failures.json`。
- **`GET /activity` 只读路由**：一次返回时间线、汇总、失败案例、分类表与术语表，支持 `?limit=`；`POST` 返回 405。
- **动作分类器 `lib/classify.js`**：11 类（桌面 / 检索 / Agent / 插件 / 记忆 / 媒体 / 网络 / 任务 / 执行 / 写入 / 读取），`exec` 再细分依赖安装 / 服务控制 / 版本控制。
- **`scripts/load-smoke.mjs` 假宿主装载冒烟**：用假 ctx 把 `apply()` 完整跑一遍（注册段 → 订阅 `tools/result` → 请求 `/settings` 与 `/activity` → 跑 teardown），CI 里新增 `Load smoke` 步骤。
- **英文文档**：`docs/DETAIL.en.md` 与 `docs/SKILL.en.md`。
- **`test/activity.test.mjs`（23 项）**：覆盖分类器、失败分层、时间线只留最新、失败库按签名累计、术语表、`/activity` 路由，以及「时间线不得进提示词」的反向守卫。

### 变更

- 运行时字段 **16 → 20**：`RUNTIME_KEYS`、`FIELD_IDS`、`BOOL_FIELDS`、`SPECIAL_FIELDS`、三档预设、`cordis.patch.yml` 全部同步。
- `lib/page.js` 新增 `var SPECIAL = ['digestSize', 'timelineSize', 'sensitiveTools']`：把「专用控件字段」的清单放到产品侧声明，守卫测试只核对、不再在测试里抄字段名。
- 面板与设置页分区各新增「动作回看（只读）」区块：时间线、失败案例库、术语卡片。
- 版本三处同步 **0.6.0**（`package.json` / `package-lock.json` / `lib/page.js` 的 `PAGE_VERSION`）。
- 测试 **61 → 84 项**；`npm run check` 覆盖 9 个源文件。
- README / `docs/DETAIL.md` / `SKILL.md` / locale 同步三新能力；README 路线图勾掉已完成的四项。

### 工程

- CI 的 `verify` 矩阵（Node 20/22/24）新增装载冒烟，挡「代码层面装不起来」。
- `.gitignore` 继续忽略 `preview/`（截图与临时脚本不进仓库）。

## [0.5.0] — 2026-11-19

### 新增

- **一步一步解析（`stepParse`，默认开）**：把动作拆成编号小步，每步点明用了什么工具、碰了哪个文件、处在项目哪一层，只拆必要步骤、不冗余复述。提示词中英各一节其实 0.4.0 就写进了 `lib/index.js`，但没接到配置白名单、界面、预设和 YAML——用户在面板上看不见、也存不进去（服务端会按未知字段回 400）。这次把六层入口补齐：`Config` → `server.js` 的 `RUNTIME_KEYS` → `client.js` 的 `FIELD_IDS` / `BOOL_FIELDS` → 设置页分区与独立页共用的控件 → 三档预设 → `cordis.patch.yml`。
- **字段一致性守卫**：新增 3 条服务端测试 + 1 条客户端测试，强制「`Config` 里每个运行时字段都必须出现在后端白名单、服务端页面控件、以及某一张控件分类表里」；预设三档必须打开 `stepParse`；YAML 必须带 `stepParse: true`。这类断层以前只能靠人读注释保，现在靠断言。

### 变更

- 版本 `0.4.0` → `0.5.0`（`package.json` / `package-lock.json` / `lib/page.js` 的 `PAGE_VERSION` 三处同步，防漂移测试会盯）。
- `client.js` 新增 `SPECIAL_FIELDS`（`digestSize` / `sensitiveTools`）：把「用专用控件的字段」显式声明出来，不再由测试硬编码名字。
- README / DETAIL / SKILL / `locale/*.json` 同步「一步一步解析」这项能力与测试总数。

### 工程

- 测试总数 49 → 61（modules 30 / plugin 18 / client 13）。

## [0.4.0] — 2026-11-19

### 新增

- **中途介入窗口**：提示词中英双语各新增一整节，要求 Agent 在每完成一个可验证小步时标出「现在可以打断我」并说明此刻改方向的最小代价（例如「还没写文件，改主意零成本」/「已写入，改主意需要回滚备份」）；用户中途换目标时先复述放弃了什么、切换到了什么。这把插件从「事后解释」变成「人在回路的控制」。
- **快捷预设**：三档一键切档（`novice` 完全新手 / `guided` 有基础 / `deep` 深度党）。预设表在 `lib/presets.js` 是唯一事实源，设置页分区与独立页共用；切档只叠加字段，不覆盖用户手调过的人设。`POST /preset` 校验 id，未知 id 返回 400 且不写盘。
- **试一下预览**：`POST /preview` 调用真实的提示词构建函数，把下一轮模型会收到的段落原样回给面板显示（也支持带未保存草稿预览）。不编造示范效果。
- **配置导出 / 导入**：导出只含运行时白名单字段的 JSON；导入先本地解析，坏 JSON 只提示不发请求。
- **运行统计**：`health()` 新增 `uptimeMs` 与 `stats`（`observed` / `sensitive` / `previews` / `saves` / `resets`），全部来自真实事件计数；关闭观察开关后不再累加。
- **协议合规资源**：`locale/en.json` + `locale/zh.json`（Plugin Manager 标题与描述）、原创 `icon.svg`、`docs/DETAIL.md` 详情页；`package.json` 补 `./locale/*.json`、`./icon` 导出与 `files` 条目。
- **测试**：新增 7 条断言覆盖预设表形状、id 白名单、`/preset` 与 `/preview` 路由（含 400/405 分支）。用变异测试验证过：删掉 id 校验后测试确实变红。

### 变更

- `GET /settings` 现在同时下发 `presets`，两个 UI 不再各自维护一份预设表。
- README / DETAIL 的定位从「学习辅助」扩展为「及时翻译 + 半路可介入」，并新增 `## 适配范围` 明确只适用于 DSH。
- CI 改用 `npm ci` 严格按 lockfile 安装，matrix 从 `20`/`22` 扩到 `20`/`22`/`24` 与 `engines.node >= 20` 对齐。

### 安全

- 预设只允许运行时白名单字段；`enabled` / `order` 无法通过预设修改
- `/preview` 的草稿字段同样走 `validateOverrides`，未知字段 400

### 工程

- 新增 `CODE_OF_CONDUCT.md`（Contributor Covenant 2.1 改编）、`.editorconfig`
- 新增 GitHub issue forms（`bug_report.yml` / `feature_request.yml` / `config.yml`，其中 bug 模板明确写出「401 不是 bug」）与 `pull_request_template.md`（含五条自检清单）
- `CONTRIBUTING.md` 补充 `npm ci` 与 `package-lock.json` 进仓库的理由

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
- **隐私检查器**：`scripts/privacy-check.mjs`，扫描本机路径、令牌与私钥形状；含负向自测证明它会失败

### 安全

- 面板仅应答本机回环请求（Host 白名单 + Origin/Referer 同源校验）
- 请求体上限 64KB；未知字段与坏 JSON 返回 400
- 密钥形状字段名主动拦截
- `enabled` / `order` 属结构配置，面板无法修改，只能通过 YAML
- 不使用任何 waterfall 事件，结构上无法否决或改写工具调用
- 零网络代码，零运行时依赖（`@deepseek-ai/schemastery` 只作开发依赖，运行期由宿主提供）

## 已知边界（所有版本通用）

- 直接手敲 `/api/ai-action-translator/` 会返回 `401 dsh web authentication required` —— 这是 `dsh web` 内核的票据保护，不是插件缺陷。请从设置页分区进入
- 只能解释 DSH 暴露的可观察事实，不读取模型隐藏推理
- 解释不等于授权：删除、覆盖、安装依赖、停止服务、重启 DSH、系统级命令、跨边界读写与内容外发仍需用户明确确认
- **只适配 DeepSeek Harness**：依赖 `systemPrompt.section()`、`settings.section` 槽位、`~/.dsh/` 目录等 DSH 独有机制，不能用于其他 Agent 工具

---

[未发布]: https://github.com/David-Martinez-worldexecute/dsh-ai-action-translator/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/David-Martinez-worldexecute/dsh-ai-action-translator/releases/tag/v0.4.0
[0.3.1]: https://github.com/David-Martinez-worldexecute/dsh-ai-action-translator/releases/tag/v0.3.1

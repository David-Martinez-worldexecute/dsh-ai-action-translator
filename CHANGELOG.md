# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.8.0] — 2026-11-19

### 新增

- **多宿主适配层（`adapters/`）**：把同一套判断规则做成四家宿主各自能读的形态——`claude-code/`（`.claude/settings.json` 的 `PreToolUse` + 钩子脚本 + `CLAUDE.md` 段）、`codebuddy/`（同一份钩子外多包一层 `hookSpecificOutput`，一套覆盖 CodeBuddy 与 WorkBuddy）、`qwen-code/`（`QWEN.md` + 钩子，官方 hooks 文档确认的 `hookSpecificOutput.permissionDecision` 嵌套信封）、`codex/`（只有 `AGENTS.md` 提示词段，**没有可挂的钩子**）。**插件本体仍然只适用于 DSH**，这一层是平行的部分能力，不是移植。
- **宿主无关核心（`adapters/_core/`）**：`policy.json`（由 `lib/guard.js` 导出，10 条规则 / 62 条正则 / 13 个只读工具名）、`judge.mjs`（判定器，与 `evaluateGuard` 逐条对齐，额外支持 `mcp__xxx__*` 这类前缀放行）、`prompt.mjs`（中英双语提示词段，`guard` 状态必须由调用方传，不猜）、`timeline.mjs`（只追加的脱敏事件日志）、`hook.mjs`（三档回复信封 `top` / `nested` / `plain` 的运行时）。**`_core/` 里不许出现任何宿主名，有测试扫。**
- **两个生成器**：`tools/build-policy.mjs`（`lib/guard.js` → `policy.json`，`--check` 比对漂移）、`tools/build-adapters.mjs`（渲染四家薄壳 + 总入口 README，`--check` 逐字节比对）。产物共 16 个文件，全部带 `GENERATED` 头注释。
- **新脚本**：`npm run build:policy` / `npm run build:adapters` / `npm run check:adapters`；`npm run verify` 现在会额外跑一次适配层漂移检查。
- **事后时间线已接线（默认关）**：`_core/hook.mjs` 新增 `runRecord()`，三个有钩子的宿主都在 `settings.json` 里挂了 `PostToolUse`（command 末尾带 ` record`；**不写 matcher**，靠「省略 matcher = 匹配全部」覆盖所有工具）；`.aiact/config.json` 里 `"audit": true` 才写入 `.aiact/timeline.jsonl`，文件涨到约 128 KB（比 500 行略多）时裁到最近 500 行。`audit` 是**独立开关**：想回看不必先开拦截，开了拦截也不会被顺手写一堆日志。

### 修复

- **钩子脚本里的 `<PROJECT>` 是字面占位符**：生成的脚本 `import ... from '<PROJECT>/.aiact/core/hook.mjs'` 永远解析失败。改成相对路径 `../../.aiact/core/hook.mjs`——绝对路径在换机器、换目录后立刻失效，而钩子失效是**静默的**。
- **`settings.json` 不是合法 JSON**：生成器在它前面套了两行 `//` 注释和一个 `$schema_note` 字段，宿主 `JSON.parse` 失败后通常「当作没配」，钩子静默失效而界面看着正常。改成纯 JSON，并加了一条测试专门防它回归。
- **Codex 的 README 说了不存在的事**：它没有钩子，文档却仍教用户「复制隐藏目录」「去 `.aiact/config.json` 里写 `mode`」，还留着「钩子脚本出错时一律放行」这类描述。装法、边界、待核实三段现在按「有没有钩子」分流，Codex 只有两步，并明说「这里没有任何强制力」。
- **Qwen Code 的能力先被低估、后经核实上调**：0.8.0 最初写「hooks JSON 结构未核实」，按最保守的「退出码 2」走；后来在官方 hooks 文档里找到原文（POST `{tool_name, tool_input, …}` in，`hookSpecificOutput.permissionDecision` out），与 CodeBuddy 是同一套嵌套信封，已改成 `nested` 并由测试钉住。
- **提示词里的守门段缺前提**：生成时按「有钩子」就写「守门是开着的」，而 `readConfig` 的默认是 `mode: 'off'`。补了前提句：「`mode` 不是 `off` 才算开着；文件不存在或写着 `off`，就什么都没在拦，那种状态下不许说你拦下了风险。」
- **时间线会把密钥明文写进磁盘**：`summarizeArguments` 原本只按**键名**判断敏感（`token` / `password` / …），于是键名是 `command` 时，值里的 `--token=supersecret`、`Authorization: Bearer …` 全部原样落盘。现在对每个字符串值再跑一遍 `SCRUB_RULES`，命中就改写并置 `redacted: true`。实测三条：`npm test --token=***`、`Authorization: Bearer ***`、`https://***:***@github.com/…`。
- **`Bearer` 被当成值吃掉，真令牌漏在星号后面**：第一版规则把 `Bearer` 整个替换成 `***`，于是它后面的真令牌没人管。现在鉴权值允许带 scheme 前缀（`Bearer|Basic|Token|Digest`），scheme 保留、只吃凭据。
- **时间线的裁剪阈值永远够不着**：`runRecord` 里写的是 `size > 512 * 1024` 才裁，而一行才 150–250 字节 —— 500 行不过 75–125 KB，要涨到 512 KB 得两千多行。于是 README 写着「超 500 行裁旧」、代码一次都没裁过，两边都不报错。阈值改为 `timeline.mjs` 导出的 `TIMELINE_PRUNE_BYTES = 128 * 1024`（略高于 500 行的体量），并加了一条测试断言「这个阈值必须够得着」。

### 变更

- 测试 **134 → 154 项**，新增第八组 `test/adapters.test.mjs`（20 项）。
- `npm run check` 覆盖的源文件 **13 → 19 个**（多了 `_core` 四个模块与两个生成器）。
- `lib/guard.js` 只多了一个导出（`GUARD_SKIP_TOOLS`，原 `SKIP_TOOLS`），`evaluateGuard` 行为不变。

### 还没做（别当成已经能用）

- **Codex 的钩子字段名仍未核实**：官方 `docs/config.md` 取回是空文件、`codex-rs/config.md` 只写着「文档已迁移」、`docs/advanced.md` 是 404，而 `developers.openai.com` 是单页应用（curl 只拿到一个空壳）。所以 `codex/` 至今只有提示词那一半，README 里明说「这里没有任何强制力」，不自称能拦。

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

### 发布前自检又修掉 9 处

整个 0.7.0 改动做完后，又从 UI 往下逐层重审了一遍（面板控件 → 浏览器半身 → 服务端路由 → 数据层 → 测试夹具），修掉下面这些。它们都属于「测试全绿但用户会看见坏结果」的类型，所以单独记一笔：

- **三个多行文本域从不按行拆分**（`lib/page.js`）：`.split(/\\r?\\n/)` 写成了双反斜杠，正则里那是「字面反斜杠 + r」，匹配不到真实换行；回填时的 `.join('\\n')` 同理。后果是「敏感工具」「规则放行」「工具放行」三个名单每行都不会成为独立条目，回填也不换行。这是 0.5.0 就带进来的老问题——测试只查控件是否存在，抓不到值的行为。
- **守门监听器按启动期配置决定注册**（`lib/index.js`）：默认 `off` 时根本不注册 `tools/pre-execute`，用户在面板里改成 `warn` / `deny` 后界面显示「已开」却一次都不拦。**「看起来保护了你」比不保护更危险**，改成无条件注册、`off` 在第一行就放行。
- **侧栏「其中失败」永远显示 0**（`client.js`）：读的是 `summary.failed`，后端字段叫 `errors`。
- **面板「上限」永远显示 0**（`lib/timeline.js`）：`summary()` 只返回 `total` / `errors` / `byClass`，没有 `limit`。
- **`/activity` 又漏了一个字段**（`lib/server.js`）：白名单补了 `guardRules` / `agents` / `agentSummary` / `drill` / `assemble`，却漏了自己的 `guard`（模式 / 等级 / 放行名单）。
- **练习册永远显示「关着」**（`lib/index.js`）：`drill: drill.summary()` 少了 `on`——关着时 `size` 天然是 0，光看计数分不出「还没动作」和「根本没开」。
- **侧栏调 `fill()` 会 ReferenceError**（`client.js`）：`fill` 原本是 `SettingsSection` 内部的局部 `const`，而 `ActivityPanel` 定义在它之前。提到模块级，一处实现两处用。
- **`lib/index.js` 两行常量顶格**：纯风格，但和全文件缩进不一致，顺手对齐。
- **三个测试夹具写了真实本机路径**：`test/agents.test.mjs` 与 `test/guard.test.mjs` 里用了本机用户目录做样例，触发隐私扫描。换成中性的假路径（`.ssh` 字样保留，断言语义不变）。

### 变更

- 运行时字段 **20 → 28**（`guardMode` / `guardLevel` / `guardAllow` / `guardAllowTools` / `guardQuiet` / `advancedMode` / `drill` / `drillEvery`）。
- 提示词 context **2 → 4**（新增练习册卡与本轮装配说明，两者都是 `text` 函数、关掉时返回空串）。
- `package.json` 的 `dsh.client.inject` 加入 `@deepseek-ai/dsh-client-ui-sidebar-right`。

### 工程

- 测试 **84 → 134 项**，七组：插件契约 18 / 模块 31 / 浏览器半身 14 / 动作回看 23 / 守门 21 / 名册 14 / 练习册 13。
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

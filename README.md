# AI Action Translator · Agent 动作的解释层

**你的 Agent 改对了代码，但你说不出它为什么这么改。**

这个插件把 Agent 的**动作**留下来并讲成人话：做了什么、失败落在哪一层、这个术语指什么，
以及此刻你还能怎么改变方向。它不替你操作，只让过程变得可读、可追、可回放。

**安装（一条命令，复制粘贴即可）**

```bash
npx -y @deepseek-ai/dsh plugin --profile desktop add dsh-ai-action-translator
```

重启 DSH 生效——右侧栏出现「AI 动作翻译器」即安装成功。
需要 Node ≥ 20、DSH ≥ 0.2.2-rc.3；其它安装方式（本地开发、离线）见 [§安装](#安装)。

> 路线图：0.8 解决「解释」；0.9 计划解决「复盘」——记录改了什么、为什么选这个方案、
> 被否掉的方案是什么、失败根因在哪一层。设计稿见 [docs/decisions-replay.md](docs/decisions-replay.md)，
> **尚未实现**，这里先写清楚边界，免得你以为它已经有了。

**English** — A DSH plugin that makes an agent's actions explainable: what it did, which layer a
failure came from, what the jargon means, and that you can still change direction mid-run.
It registers no tools, intercepts nothing, and makes no network calls.

![AI 动作翻译器配置面板](docs/screenshot.png)

<sub>配置面板实拍。学习区第一行是「一步一步解析」；「观察与摘要」里多了「学习练习册」；展开「高级选项」能看到事前守门——图里把它开成了「提醒」，所以运行统计多出「守门命中 3 / 守门拦下 1」两张卡，下面的规则清单点一下就能把规则 id 填进放行名单。图为本地离线预览快照（不联网，数据为演示值）。</sub>

**English summary** — This DeepSeek Harness (DSH) plugin injects a fixed instruction section into the agent's system prompt. From then on, the agent explains its own observable actions — tool calls, shell commands, file reads and writes, dependency installs, service starts, and error handling — in beginner-friendly language, before and after each action. It also marks, at every verifiable step, that you can still interrupt and change course, and states what changing your mind would cost at that moment. A small GUI panel personalises how much explanation you get. It registers **no tools**, intercepts **nothing**, makes **no network calls**, reads and writes **none of your project files**, and never executes actions on its own. All of its tests run offline with `npm test`.

---

## 这是什么

一个**学习辅助插件**，不是自动化工具。它解决一个很具体的问题：

> AI 正在操作我的电脑，它到底在干什么？为什么这么做？报错了是什么意思？

装上它之后，AI 每次动手前后都会用你能看懂的话解释一遍，同时把这次动作放回项目结构里告诉你它的位置。

第二个问题很少有人明说，但一直存在：

> 它已经在跑了，我现在还能改主意吗？改了要付出什么代价？

所以它还会在每个可验证的小步骤上标出**「现在可以打断我」**，并说清此刻改变方向要付什么：还没写文件就是零成本，已经写入了就需要回滚备份。**决定的权力始终在你手上，插件只负责把选择摆到你面前。**

## 它给谁用

- 刚接触编程、看不懂命令行和报错的初学者
- 想理解 AI Agent 到底怎么工作的人
- 带学生做项目、需要「可解释过程」的老师

## 它做什么

| 能力 | 说明 |
|---|---|
| 动作翻译 | 工具调用前说清「要做什么、为什么、影响」，返回后说清「实际发生了什么、对下一步意味着什么」 |
| **一步一步解析** | `stepParse`（默认开）：把动作拆成编号小步，每步点明用了什么工具、碰了哪个文件、处在项目哪一层；只拆必要步骤，不冗余复述。这是「看懂 AI 怎么干活」最直接的一层 |
| **动作时间线** | `timeline`（默认开）：把这一路的工具调用按时间排成一张只读列表，带分类、耗时、成功/失败标记。它**只出现在面板里，不写进提示词**——回看用，不占模型上下文 |
| **术语卡片** | `glossary`（默认开）：`waterfall`、`peerDependency`、`HMR`、`EPERM` 这类词第一次出现时就地给一句话，只解释一次、不复述。表里没有的词，要求按可观察行为现讲，不许编定义 |
| **失败案例库** | `failureBook`（默认开）：报错按层归档（鉴权 / 权限 / 路径 / 依赖 / 网络 / 服务 / 语法 / 测试），同一类只记一条并累计次数。下次遇到同类，先翻这里看「上次是什么层、怎么修的」 |
| **中途介入** | 每完成一个可验证小步就标出「现在可以打断我」，并说明此刻改方向的最小代价；你换目标时它先复述放弃了什么 |
| 分级讲解 | `knowledgeLevel` 四档：`plain` 全白话、`guided` 边做边学、`balanced` 白话+术语+机制、`deep` 追到调用链 |
| 项目地图 | 用固定六层地图定位每个动作：入口/启动点 → 配置与依赖 → 核心模块 → 工具/服务边界 → 输出/界面 → 测试与验证 |
| 阶段小结 | 完成一个可验证小阶段后，用 2～4 句总结「完成了什么 / 在地图哪一层 / 仍未知 / 下一步」 |
| 人物语气 | `persona` 可自定义讲解者风格（≤600 字）；只影响表达，不影响事实与安全边界 |
| 可视化配置 | DSH 设置页内有图形面板，改完下一轮生效，不用手改配置文件 |
| **快捷预设** | 三档一键切整套参数：完全新手 / 有基础 / 深度党；预设只叠加，不动你手调过的人设 |
| **试一下** | 用当前配置**真实生成**一次提示词段落并显示在面板里——所见即下一轮模型所得 |
| **导出 / 导入** | 配置存成 JSON，换电脑、备份、分享给别人 |
| **运行统计** | 已观察工具调用数、敏感命中数、预览次数、运行时长；确认它真的在工作 |
| **事前守门** | `guardMode`（默认 `off`）：动作**执行前**检查这一条有没有高风险形状（递归删、关机、改权限、读凭据、破坏性 git、写系统目录、装依赖、停服务、外连）。`warn` 只提醒不拦，`deny` 会真的拦下并给出「怎么临时放行」的原话。它只读参数、不改参数，`off` 时连监听都不注册 |
| **多 Agent 名册** | 一个会话里跑起子 agent / 团队时，时间线每条会标出「是谁做的」；面板显示参与数、在跑的还有几个、各做了几次。没有 agent 上下文的系统级调用**如实留空**，不猜成「主 agent」 |
| **侧栏常驻面板** | 右侧栏多一个「动作回看」页签：时间线、失败案例、术语卡片一眼可见，不用每次点进设置页。只读回看，仍**不写进提示词** |
| **学习练习册** | `drill`（默认 `off`）：攒够 `drillEvery` 条真实动作，自动出一道复述练习（「你看到了什么 / 你能复述的技术点 / 下一步练什么」），只引用真跑过的动作，同一批只出一次 |
| **本轮装配说明** | 面板上的开关改成运行时，静态提示词段改不了；于是每轮动态生成一段「本轮生效什么、关掉了什么、关掉的不要主动讲」，让模型不会照着旧文字讲一件其实已经关掉的事 |

## 它不做什么

这些是**设计上刻意排除**的，不是还没做：

- ❌ 不注册任何工具，不接管工具执行
- ❌ 不拦截、不否决、不改写任何工具结果（只用 `tools/result` 这个纯广播事件做只读观察）
- ❌ 不联网、不外发任何内容
- ❌ 不读写你的项目文件
- ❌ 不自动执行动作
- ❌ 不声称知道模型的隐藏推理 —— 只解释可观察的事实

## 适配范围

这件事分两层，先说清哪一层能给你什么——别把两层的承诺混在一起看。

### 第一层：DSH 原生插件（完整形态）

在 DeepSeek Harness 里它是完整形态：提示词注入、设置面板、侧栏常驻面板、事前守门、多 Agent 名册、学习练习册、动作时间线与失败案例库。

**插件本体**依赖三样 DSH 独有的东西：

| 依赖 | 用途 | 别的工具有没有 |
|---|---|---|
| `systemPrompt.section()` / `systemPrompt.context()` | 注入讲解规则与动态段 | ❌ Claude Code / Cursor / Cline 都没有这个 API |
| `settings.section` UI 槽位 | 把配置面板挂进设置页 | ❌ 这是 DSH 的 Client Slots 机制 |
| `~/.dsh/` 数据目录与 `ctx.inject(['webServer'])` | 存配置、挂路由 | ❌ DSH 的服务与目录约定 |

这三样是 API，不是配置项——所以**插件本体装不到别的 Agent 工具上**，这一点没有变。

### 第二层：`adapters/` 多宿主适配层（部分能力）

为了在别的宿主上也有「动作翻译 + 事前守门」，仓库里另有一层 `adapters/`：一套**宿主无关**的判定核心（`adapters/_core/`）+ 每个宿主一个薄壳（配置 + 钩子脚本 + 提示词）。

| 宿主 | 动作前拦截 | 提示词写到 | 说明 |
|---|---|---|---|
| Claude Code | ✅ 可阻断 | `CLAUDE.md` | `PreToolUse` 钩子返回 deny |
| CodeBuddy / WorkBuddy | ✅ 可阻断 | `AGENTS.md` | 同一份钩子，外面多包一层 `hookSpecificOutput` |
| Qwen Code（千问） | ✅ 可阻断 | `QWEN.md` | 官方 hooks 文档确认：入参 `{tool_name, tool_input}`，回 `hookSpecificOutput.permissionDecision` |
| Codex | ❌ 没有可挂的钩子 | `AGENTS.md` | 只有提示词，**不假装能拦** |

**「动作前拦截」那一列是唯一值得仔细看的地方**：能拦的宿主会在命令真正执行**之前**返回 deny；不能拦的宿主只有提示词，模型可以不理它。这一层**没有**设置面板、侧栏、名册、练习册——它是「动作翻译 + 守门」的移植，不是整个插件的移植。

两层的规则出处是同一个 `lib/guard.js`，`adapters/_core/policy.json` 由脚本从它生成，改规则只需改一处。装法见 [`adapters/README.md`](adapters/README.md)。

版本要求：DSH Desktop ≥ 0.2.2-rc.3（由 `package.json` 的 `dsh.engines.dsh` 声明；未在更低版本上验证，不承诺行为一致）；`manifestVersion: 1`；Node.js ≥ 20。

---

## 安装

前置条件：Node.js ≥ 20（用命令行安装需要 `npx` 与网络）。

### 方式一：一条命令（推荐）

```bash
npx -y @deepseek-ai/dsh plugin --profile desktop add dsh-ai-action-translator
```

它会自动建/复用 profile、把包 `pnpm add` 进去，并**把包名登记进该 profile 的
`dsh.profile.bundles`**——不需要你手改任何 JSON。重启 DSH 后生效。

`--profile` 后面按你自己的 profile 名改（本机有 `desktop` / `web` / `headless` 等，桌面版通常就是 `desktop`）。
不确定叫什么，可以看 `~/.dsh/profiles/` 下的目录名。

### 方式二：从源码装（本地开发）

```bash
git clone https://github.com/David-Martinez-worldexecute/dsh-ai-action-translator.git
cd dsh-ai-action-translator
npm ci            # 按 package-lock 精确安装开发依赖（运行期依赖由 DSH 提供）
```

### 方式三：Windows 一键同步（改代码时用）

仓库自带 `scripts/install-local.ps1`：把当前工作区同步到 `~/.dsh/plugins/dsh-ai-action-translator`，**先备份旧版本**，再读回校验版本号与三处 `stepParse` 入口（`lib/page.js` / `client.js` / `cordis.patch.yml`），最后做一次语法检查。

```powershell
# 在仓库根目录执行；先只看检查结果，不写磁盘
pwsh -File scripts/install-local.ps1 -DryRun

# 确认无误后真装（旧版本会备份成 ...bak-<时间戳>）
pwsh -File scripts/install-local.ps1
```

脚本**不**改 profile 的 `package.json`，也**不**替你重启 DSH——那一步需要你自己决定（插件在启动时加载，替换已装包必须重启才生效）。

回滚：

```powershell
# 备份目录名见脚本输出
Rename-Item ~\.dsh\plugins\dsh-ai-action-translator ~\.dsh\plugins\dsh-ai-action-translator.bad
Rename-Item ~\.dsh\plugins\dsh-ai-action-translator.bak-<时间戳> ~\.dsh\plugins\dsh-ai-action-translator
```

### 手动安装

在 DSH profile 的 `package.json` 里以本地链接方式引用：

```json
{
  "dependencies": {
    "dsh-ai-action-translator": "link:<仓库克隆的绝对路径>"
  }
}
```

再把 `cordis.patch.yml` 的内容合并进 profile 的 patch 文件，然后重启 DSH。

> ⚠️ 修改官方 profile 前请先备份。`enabled: false` 时插件完全不注册。

## 使用技巧

按「第一次装」到「长期用」排序，每条都能立刻验证。

| 场景 | 怎么做 | 为什么有效 |
|---|---|---|
| 第一次装好 | 先点「有基础」预设，再确认「一步一步解析」是开的 | 预设只**叠加**、不重置，所以你能先拿到一套能跑的基线，再单独微调介意的项 |
| 某一步看不懂 | 把「讲解深度」调到 `deep`，下一轮再看同一条动作 | 深度档会追到调用链；不用重装，改完下一轮生效 |
| 觉得太啰嗦 | 只关「一步一步解析」，别关整段 | 编号拆解是最占篇幅的一层；关掉后仍保留动作前/后两段翻译 |
| 想确认它真在工作 | 打开「运行统计」，看已观察工具调用数是否在涨 | 那是只读计数，不依赖模型的自我报告 |
| 想确认改对了 | 用「试一下 → 生成一段样例」 | 它用当前配置**真实生成**提示词段落，所见即下一轮模型所得，不是假预览 |
| 换电脑 / 团队统一 | 「导出配置」存 JSON，另一台「导入配置」 | 配置就是 JSON，可进版本库；不含任何密钥 |
| 怕摘要读到敏感参数 | 在「敏感工具名单」加工具名前缀（如 `git*`） | 命中后参数在摘要里只显示「已省略」，但工具调用本身照常执行 |

两个容易踩的坑：

- **改完要等下一轮**：配置存到 `~/.dsh/ai-action-translator/settings.json`，经动态上下文段生效，**不需要重启 DSH**；但当前这一轮已经发出去的提示词不会回溯改变。
- **不要去手敲面板网址**：`/api/ai-action-translator/` 走的是 DSH 内核鉴权，直接访问会 401。入口在设置页分区里。

## 配置项

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | bool | `true` | 总开关；`false` 时完全不注册 |
| `order` | int | `9500` | 提示词段排序 |
| `language` | `zh` \| `en` | `zh` | 讲解语言 |
| `detail` | 枚举 | `thorough` | 讲解详细程度 |
| `learningStage` | `foundation` \| `framework` \| `runtime` \| `code` | `framework` | 学习阶段起点 |
| `knowledgeLevel` | `plain` \| `guided` \| `balanced` \| `deep` | `guided` | 知识量档位 |
| `frameworkMap` | bool | `true` | 是否给六层项目地图 |
| `stepParse` | bool | `true` | 是否把动作拆成编号小步（一步一步解析） |
| `stageSummary` | bool | `true` | 是否做阶段小结 |
| `skillCollaboration` | bool | `true` | 是否说明各 Skill 分工 |
| `learningFocus` | string ≤240 | — | 当前想学的方向 |
| `playfulness` | `off` \| `gentle` \| `cheerful` | `gentle` | 趣味程度 |
| `encouragement` | `off` \| `gentle` \| `active` | `active` | 鼓励强度 |
| `persona` | string ≤600 | 中性学习搭档 | 讲解者风格；空值用内置默认 |
| `observeTools` | bool | `true` | 是否只读观察工具结果 |
| `digestSize` | int 0–50 | `8` | 最近动作摘要条数 |
| `timeline` | bool | `true` | 是否记录完整动作时间线（只给面板回看，不写进提示词） |
| `timelineSize` | int 0–200 | `40` | 时间线保留条数；`0` = 不记录 |
| `glossary` | bool | `true` | 是否在提示词里注入「术语第一次出现就解释一句」的规则与词表 |
| `failureBook` | bool | `true` | 是否把失败动作按层归档到本地（`~/.dsh/ai-action-translator/failures.json`） |
| `drill` | bool | `false` | 学习练习册：攒够 `drillEvery` 条真实动作就出一道复述练习（只引用真跑过的动作） |
| `drillEvery` | int 2–10 | `3` | 每多少个动作出一道；太小会刷屏，太大会等很久 |
| `guardMode` | `off` \| `warn` \| `deny` | `off` | 事前守门：`off` 完全不注册监听；`warn` 只提醒；`deny` 真的拦下高风险动作 |
| `guardLevel` | `high` \| `medium` | `high` | 守门层级：`high` 只拦高风险，`medium` 连装依赖/停服务/外连也拦 |
| `guardAllow` | string[] ≤50 | `[]` | 规则白名单：列出的规则 id 永不触发 |
| `guardAllowTools` | string[] ≤50 | `[]` | 工具白名单：列出的工具跳过检查（大小写不敏感） |
| `guardQuiet` | bool | `false` | 是否也报静音的规则（`in-place-overwrite`，写文件最高频，默认不报） |
| `advancedMode` | bool | `false` | 面板高级区是否展开（只是 UI 状态，跟着配置一起存） |
| `sensitiveTools` | string[] | 见 YAML | 标记为敏感的工具有前缀匹配 |

## 图形配置面板

**主入口：DSH 设置页里的「AI 动作翻译器」分区。**

保存后经动态上下文段注入，下一轮对话自动生效；「刷新」重新拉取配置与状态，「恢复默认」回到 YAML 基线。面板底部展示最近 20 条插件日志。

- **独立页面**：分区里的「打开完整页面」按钮会打开服务端渲染的完整面板，它继承同一会话所以能通过内核校验。
- **为什么不能手敲网址**：`dsh web` 内核把 `/api*` 与首页锁在「启动令牌 → 签名 Cookie」之后。直接在浏览器敲插件地址会先被内核拦下返回 `401 dsh web authentication required`，请求根本到不了插件。这是内核的票据保护，不是插件缺陷 —— 所以请从设置页分区进入，不要把这个地址写进书签。
- **写入位置**：`~/.dsh/ai-action-translator/settings.json`，插件自己的数据文件；不回写 `cordis.patch.yml`，不改官方 profile。

## 安全边界

这只插件能做的事**在结构上**就被限死了：

- 静态依赖只有 `systemPrompt`；配置面板需要的 `webServer` 走运行时注入，服务缺失时提示词层照常工作
- 仅应答本机回环请求（Host 限 `127.0.0.1` / `[::1]` / `localhost`，Origin/Referer 须同源）
- 请求体上限 64KB；未知字段与坏 JSON 返回 400
- 含 `password` / `secret` / `token` / `api_key` / `credential` 等形状的字段名会被主动拦截
- `enabled` / `order` 属结构配置，只能通过 YAML 修改，面板改不了
- 所有注册通过 `ctx.effect` / disposer 绑生命周期，卸载即干净移除

详见 [SECURITY.md](SECURITY.md)。

## 验证

```bash
npm ci     # 首次需要，按 lock 精确安装开发依赖
npm run verify  # 语法检查 + 154 项测试 + 适配层漂移检查 + 隐私扫描
node scripts/load-smoke.mjs   # 假宿主装载冒烟（可选，单独跑）
```

单独跑：

```bash
npm run check           # 19 个源文件语法检查
npm test                # 154 项测试
npm run check:adapters  # 适配层与 lib/guard.js 是否漂移（只比对，不写盘）
npm run check:privacy   # 扫描是否误提交本机路径/密钥
node scripts/load-smoke.mjs   # 假宿主装载冒烟：注册段 / 订阅工具事件 / 面板应答 / 卸载清理
```

八组测试的分工：

- `test/plugin.test.mjs` —— 插件契约：`apply()` 注册了哪些段、默认值、`enabled: false` 时不注册
- `test/modules.test.mjs` —— 服务端模块：store 原子写入与损坏隔离、回环围栏、路由与 400、日志环，文档回归（README/SKILL/page 不得教用户手敲那个必然 401 的网址），以及「`activity()` 的每个字段都必须穿过 `/activity` 的响应白名单」——这条是因为 0.7.0 真的漏过一次：数据层加了、出口层没加，测试全绿而面板永远拿到 `undefined`
- `test/client.test.mjs` —— 浏览器半身：用 `node:vm` 造假浏览器加载 `client.js`，断言字段清单与后端完全一致、`toPayload` 只发白名单字段、坏输入本地挡住、缺宿主服务时只警告不崩
- `test/activity.test.mjs` —— 动作回看：分类器（11 类，含 exec 的依赖安装 / 服务控制 / 版本控制细分）、失败分层（8 层 + 未知兜底）、时间线只留最新、失败案例库按签名累计、术语表、`/activity` 路由，以及「时间线不得进提示词」的反向守卫
- `test/guard.test.mjs` —— 事前守门：递归删除 / 关机 / 改权限 / 读凭据 / 破坏性 git 必须命中；装依赖 / 停服务 / 联网 / 覆盖写按 `guardLevel` 分流；`warn` 绝不返回 deny；写系统目录只对写类工具报；带 `quiet` 的规则默认静音、`includeQuiet` 才出声；参数被 JSON 转义过（`C:\\Windows`）时也要认得出
- `test/agents.test.mjs` —— 多 Agent 名册：身份归一化（`agent.id` 缺失时回落 session header）、字段白名单、`born` / `gone` / `touch` 计数、超上限丢最早、`list()` 返回副本（调用方改不坏内部状态）
- `test/drill.test.mjs` —— 学习练习册：`drillEvery` 收敛（`null` / `undefined` / 空串算「没给」，不是「给了 0」）、攒够就出卡且同一批只出一张（幂等）、窗口裁剪时已出卡计数跟着回落、卡里只引用真发生过的动作
- `test/adapters.test.mjs` —— 多宿主适配：三家的 `settings.json` 必须是**纯 JSON**（里面不能有 `//` 注释——宿主 `JSON.parse` 失败时通常「当作没配」，钩子就静默失效了，这条是 0.8.0 真踩过的坑）、真喂 stdin 跑钩子脚本（`rm -rf build` → deny，`npm test` → 零输出）、各家回复信封形状正确（Claude 顶层 / CodeBuddy 与 Qwen 都套 `hookSpecificOutput`）、`PostToolUse` 记账真的写进 `.aiact/timeline.jsonl` 而 `audit` 关着时一行都不写、命令里的 token 与 Bearer 不会明文落盘、`mode: 'off'` 与坏 policy / 坏 stdin 都 fail-open 且把原因写进 stderr、`_core/` 里不许出现任何宿主名、生成器幂等

## 项目结构

```
.
├── lib/
│   ├── index.js     # 插件入口：配置 schema、提示词段、时间线订阅、面板挂载
│   ├── server.js    # 回环 HTTP 路由、64KB 上限、400 处理
│   ├── store.js     # 原子写入、损坏隔离
│   ├── trust.js     # Host / Origin 同源围栏
│   ├── classify.js  # 动作分类（11 类，exec 再细分依赖安装 / 服务控制 / 版本控制）
│   ├── glossary.js  # 术语表（16 条）与提示词片段生成
│   ├── timeline.js  # 时间线环 + 失败分层 + 失败案例库
│   ├── guard.js     # 事前守门：10 条高风险规则、三种模式、放行通道
│   ├── agents.js    # 多 Agent 名册（只认 id / cwd / 计数，不猜意图）
│   ├── drill.js     # 学习练习册：攒够动作就出一道复述卡（幂等）
│   ├── assemble.js  # 本轮装配说明：把「哪些开关真的生效」现算进提示词
│   └── page.js      # 服务端渲染的独立面板
├── client.js        # DSH 设置页内嵌分区（浏览器半身）
├── cordis.patch.yml # bundle 补丁（安装入口）
├── scripts/
│   ├── privacy-check.mjs  # 隐私检查器
│   └── load-smoke.mjs     # 假宿主装载冒烟（CI 里跑）
├── test/            # 八组测试（插件契约 / 模块 / 浏览器半身 / 动作回看 / 守门 / 名册 / 练习册 / 多宿主适配）
├── adapters/        # 多宿主适配层（生成物）：_core 宿主无关判定 + claude-code / codebuddy / qwen-code / codex
├── tools/           # 生成器：build-policy.mjs（guard.js → policy.json）、build-adapters.mjs（渲染各宿主薄壳）
├── SKILL.md         # 可选的详细学习规则（给 Agent 看的）
└── README.md
```

## 路线图

按「对学习者的价值」排，不按实现难度排。

- [x] **动作时间线** —— 把一轮对话里的工具调用按时间排成可回看的列表（仍只读，不拦截；**不写进提示词**）
- [x] **术语卡片** —— 某个术语第一次出现时就地给一句话解释，而不是塞进长段落（16 条词表 + 「不许编定义」的兜底规则）
- [x] **失败案例库** —— 把「报错 → 分层定位 → 下次怎么避免」沉淀成可复用片段（只存本地 `failures.json`，不外发）
- [x] **英文文档对齐** —— 新增 `docs/DETAIL.en.md` 与 `docs/SKILL.en.md`
- [x] **事前守门** —— 动作执行前检查高风险形状；`off` / `warn` / `deny` 三档，默认 `off`（不注册监听、零开销），放行通道与静音规则都有测试守住
- [x] **多 Agent 名册** —— 时间线标出每条动作的 agent 归属（`agent/created` / `agent/disposed` 只读订阅）；没有上下文就留空，不猜
- [x] **侧栏常驻面板** —— `sidebar.right.pane.tab` 页签，时间线/失败案例/术语卡片一眼可见
- [x] **学习练习册** —— 攒够真实动作出一道复述卡，只引用真跑过的动作，同一批幂等
- [x] **默认简洁 + 高级选项** —— 面板默认收起守门/白名单等进阶项，勾「高级选项」才展开
- [x] **本轮装配说明** —— 每轮现算「哪些开关真的生效」，避免静态提示词段与运行时开关不一致
- [x] **多宿主适配层** —— `adapters/` 四家薄壳（Claude Code / CodeBuddy·WorkBuddy / Qwen Code / Codex），共享同一个宿主无关 `_core` 判定；**能阻断的只有前三家，Codex 明确只有提示词，不假装能拦**；`settings.json` 必须是纯 JSON、钩子脚本出错一律 fail-open，两条都有测试钉住
- [ ] **版本矩阵** —— 在 CI 里对 `dsh.engines.dsh` 声明的下限做一次**真实装载**验证（目前只有假宿主 smoke，不等于真装进 DSH）

已明确**不做**的：接管工具执行、拦截或改写结果、联网检索、跨项目读文件。理由见上面「它不做什么」。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。最重要的一条：**改 `package.json` 的 `version` 必须同步改 `lib/page.js` 的 `PAGE_VERSION`**，否则「版本防漂移」测试会红。

## 协议

[MIT](LICENSE) © 2026 David-Martinez-worldexecute

---

<sub>本项目在开发过程中使用 AI 辅助。所有功能行为由自动化测试守护。</sub>

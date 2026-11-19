# AI Action Translator · AI 动作翻译器

> A DSH plugin that turns what an AI agent is doing into plain language — for people who are still learning how computers and agents work.

**English summary** — This DeepSeek Harness (DSH) plugin injects a fixed instruction section into the agent's system prompt. From then on, the agent explains its own observable actions — tool calls, shell commands, file reads and writes, dependency installs, service starts, and error handling — in beginner-friendly language, before and after each action. It also ships a small GUI panel for personalising how much explanation you get. It registers **no tools**, intercepts **nothing**, makes **no network calls**, reads and writes **none of your project files**, and never executes actions on its own. All of its tests run offline with `npm test`.

---

## 这是什么

一个**学习辅助插件**，不是自动化工具。它解决一个很具体的问题：

> AI 正在操作我的电脑，它到底在干什么？为什么这么做？报错了是什么意思？

装上它之后，AI 每次动手前后都会用你能看懂的话解释一遍，同时把这次动作放回项目结构里告诉你它的位置。

## 它给谁用

- 刚接触编程、看不懂命令行和报错的初学者
- 想理解 AI Agent 到底怎么工作的人
- 带学生做项目、需要「可解释过程」的老师

## 它做什么

| 能力 | 说明 |
|---|---|
| 动作翻译 | 工具调用前说清「要做什么、为什么、影响」，返回后说清「实际发生了什么、对下一步意味着什么」 |
| 分级讲解 | `knowledgeLevel` 四档：`plain` 全白话、`guided` 边做边学、`balanced` 白话+术语+机制、`deep` 追到调用链 |
| 项目地图 | 用固定六层地图定位每个动作：入口/启动点 → 配置与依赖 → 核心模块 → 工具/服务边界 → 输出/界面 → 测试与验证 |
| 阶段小结 | 完成一个可验证小阶段后，用 2～4 句总结「完成了什么 / 在地图哪一层 / 仍未知 / 下一步」 |
| 人物语气 | `persona` 可自定义讲解者风格（≤600 字）；只影响表达，不影响事实与安全边界 |
| 可视化配置 | DSH 设置页内有图形面板，改完下一轮生效，不用手改配置文件 |

## 它不做什么

这些是**设计上刻意排除**的，不是还没做：

- ❌ 不注册任何工具，不接管工具执行
- ❌ 不拦截、不否决、不改写任何工具结果（只用 `tools/result` 这个纯广播事件做只读观察）
- ❌ 不联网、不外发任何内容
- ❌ 不读写你的项目文件
- ❌ 不自动执行动作
- ❌ 不声称知道模型的隐藏推理 —— 只解释可观察的事实

---

## 安装

前置条件：已安装 DeepSeek Harness，Node.js ≥ 20。

```bash
git clone https://github.com/David-Martinez-worldexecute/dsh-ai-action-translator.git
cd dsh-ai-action-translator
npm install          # 仅安装开发依赖（运行期依赖由 DSH 提供）
```

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
| `stageSummary` | bool | `true` | 是否做阶段小结 |
| `skillCollaboration` | bool | `true` | 是否说明各 Skill 分工 |
| `learningFocus` | string ≤240 | — | 当前想学的方向 |
| `playfulness` | `off` \| `gentle` \| `cheerful` | `gentle` | 趣味程度 |
| `encouragement` | `off` \| `gentle` \| `active` | `active` | 鼓励强度 |
| `persona` | string ≤600 | 中性学习搭档 | 讲解者风格；空值用内置默认 |
| `observeTools` | bool | `true` | 是否只读观察工具结果 |
| `digestSize` | int 0–50 | `8` | 最近动作摘要条数 |
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
npm install     # 首次需要，安装开发依赖
npm run verify  # 语法检查 + 49 项测试 + 隐私扫描
```

单独跑：

```bash
npm run check           # 6 个源文件语法检查
npm test                # 49 项测试
npm run check:privacy   # 扫描是否误提交本机路径/密钥
```

三组测试的分工：

- `test/plugin.test.mjs` —— 插件契约：`apply()` 注册了哪些段、默认值、`enabled: false` 时不注册
- `test/modules.test.mjs` —— 服务端模块：store 原子写入与损坏隔离、回环围栏、路由与 400、日志环，以及文档回归（README/SKILL/page 不得教用户手敲那个必然 401 的网址）
- `test/client.test.mjs` —— 浏览器半身：用 `node:vm` 造假浏览器加载 `client.js`，断言字段清单与后端完全一致、`toPayload` 只发白名单字段、坏输入本地挡住、缺宿主服务时只警告不崩

## 项目结构

```
.
├── lib/
│   ├── index.js     # 插件入口：配置 schema、提示词段、面板挂载
│   ├── server.js    # 回环 HTTP 路由、64KB 上限、400 处理
│   ├── store.js     # 原子写入、损坏隔离
│   ├── trust.js     # Host / Origin 同源围栏
│   └── page.js      # 服务端渲染的独立面板
├── client.js        # DSH 设置页内嵌分区（浏览器半身）
├── cordis.patch.yml # bundle 补丁（安装入口）
├── scripts/
│   └── privacy-check.mjs  # 隐私检查器
├── test/            # 三组测试
├── SKILL.md         # 可选的详细学习规则（给 Agent 看的）
└── README.md
```

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。最重要的一条：**改 `package.json` 的 `version` 必须同步改 `lib/page.js` 的 `PAGE_VERSION`**，否则「版本防漂移」测试会红。

## 协议

[MIT](LICENSE) © 2026 David-Martinez-worldexecute

---

<sub>本项目在开发过程中使用 AI 辅助。所有功能行为由自动化测试守护。</sub>

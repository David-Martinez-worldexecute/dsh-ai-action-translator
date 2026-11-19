# 贡献指南

感谢你愿意帮忙。这个项目的目标是「让初学者看懂 AI 在做什么」，所以**清晰**比**聪明**更重要。

## 快速开始

```bash
git clone https://github.com/David-Martinez-worldexecute/dsh-ai-action-translator.git
cd dsh-ai-action-translator
npm install     # 只装开发依赖；运行期依赖由 DSH 宿主提供
npm run verify  # 语法 + 49 测试 + 隐私扫描，三者都必须绿
```

## 三条硬规矩

### 1. 版本双写

改 `package.json` 的 `version` 时，**必须同时**改 `lib/page.js` 顶部的 `PAGE_VERSION`。

有测试守着这件事（`test/modules.test.mjs` 的 `page version tracks the package version`），只改一处会红。

### 2. 文档不许教用户手敲网址

`/api/ai-action-translator/` 这条路会被 `dsh web` 内核的票据校验拦成 401。文档必须指向「设置页分区」，并且要说明 401 的原因。

三条断言守着（`test/modules.test.mjs` 的 `docs point at the GUI settings section, not a typed URL`）：

- README 必须含 `打开完整页面` 和 `401`，且**不得**出现 `本机浏览器打开`
- SKILL.md 必须含 `不要建议用户手敲` 和 `打开完整页面`
- `lib/page.js` 必须含 `不要手敲`

### 3. 不引入运行时依赖

插件本体零运行时依赖。新增任何 `dependencies` 前请先开 issue 说明理由 —— 依赖会扩大攻击面，也会让安装变复杂。

## 文件职责

| 文件 | 职责 | 改动注意 |
|---|---|---|
| `lib/index.js` | 插件入口：配置 schema、提示词段、面板挂载 | 只订阅 `tools/result`；**不要**接入 `tools/pre-execute` 等 waterfall 事件，那会给插件否决/改写工具的能力 |
| `lib/server.js` | 回环 HTTP 路由、64KB 上限、400 处理 | 新增路由要同步更新 `RUNTIME_KEYS` |
| `lib/store.js` | 原子写入、损坏隔离 | 写文件必须走临时文件 + rename |
| `lib/trust.js` | Host / Origin 同源围栏 | 放宽围栏属于安全变更，需单独说明 |
| `lib/page.js` | 服务端渲染面板 | HTML 里不能出现 `http://` 或 `https://` 字面量（有测试断言） |
| `client.js` | 设置页内嵌分区 | 字段清单必须与后端 `RUNTIME_KEYS` 完全一致 |
| `scripts/privacy-check.mjs` | 隐私检查器 | 规则用「形状」描述，不要在规则里写具体人名 |

## 提交流程

1. Fork 并从 `main` 切分支：`git checkout -b fix/short-description`
2. 改代码 + 加测试（**新行为必须有测试**）
3. `npm run verify` 全绿
4. 提交信息用约定式前缀：`feat:` / `fix:` / `docs:` / `test:` / `chore:` / `refactor:`
5. 开 PR，说明「改了什么、为什么、怎么验证的」

## 调试安装到本地 DSH

在 DSH profile 的 `package.json` 里用 `link:` 指向你的克隆路径，然后在 `cordis.patch.yml` 合并 bundle 配置，重启 DSH。

验证面板是否起来：DSH 设置页应出现「AI 动作翻译器」分区。启动日志里会有一行 `config panel ready ...`。

> 改完 profile 记得备份，出问题先设 `enabled: false`。

## 关于 AI 辅助

本项目在开发过程中使用 AI 辅助。这不影响贡献要求：**你提交的代码你负责**，请确认自己理解每一行，并且测试是真的在跑（不是只在注释里说跑过了）。

## 行为准则

- 技术讨论对事不对人
- 不用「这很简单」「你怎么连这个都不会」这类表达 —— 这个项目的用户就是初学者
- 不提交他人的私人信息（真实姓名、本机路径、令牌）

## 协议

贡献即表示同意以 [MIT](LICENSE) 协议发布。

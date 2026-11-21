# 分发闭环 · dsh-ai-action-translator

> 这份文件只做三件事：把「发出去」的步骤写死、把「被看见」的材料备好、把「怎么说」定调。
> 凡是标 **【人工】** 的，都需要作者本人操作（账号、身份、外部发布）；标 **【已做】** 的是本轮已验证或已改好的。

## 0 · 现状（2026-11-21 实测）

| 项 | 状态 | 证据 |
|---|---|---|
| npm 包是否存在 | **不存在** | `npm view dsh-ai-action-translator version` → `E404` |
| 包名可用性 | 未知，需发布时才知道 | 同上：E404 表示这个名字**当前没有被占用**（大概率可发） |
| 本机 npm 身份 | `corvou_4` | `npm whoami` |
| 2FA | `auth-and-writes` | `npm profile get` → `two-factor auth: auth-and-writes` |
| 发布是否需要 OTP | **是** | 同上；发布命令必须带 6 位一次性码 |
| `publishConfig` | 【已做】`public` + 官方 registry | `package.json` |
| `dsh.engines.dsh` | 已有 `>=0.2.2-rc.3` | `package.json`；本机桌面版运行时就是 `@deepseek-ai/dsh-desktop-runtime@0.2.2-rc.3` |
| 版本号 | `0.8.0` | 首次发布可用，但建议先发 `0.8.1` 或保持 `0.8.0` 由作者定 |

## 1 · npm 发布检查清单

| 检查项 | 要求 | 当前 |
|---|---|---|
| `name` | 唯一、小写、无空格 | `dsh-ai-action-translator`（E404 = 未被占用） |
| `version` | 必须是没发过的版本 | `0.8.0`，未发过 |
| `files` | 只发运行时需要的文件 | 已含 `lib` / `client.js` / `cordis.patch.yml` / `locale/*.json` / `docs` / `icon.svg` / `README.md` / `SKILL.md` |
| `license` | 必须有 | `MIT` + `LICENSE` 文件存在 |
| `repository` / `homepage` / `bugs` | 有 | 齐全 |
| `publishConfig` | `access: public` | 【已做】 |
| `main` / `exports` | 指向真实文件 | `lib/index.js`、`./client`、`./icon` 均存在 |
| 构建脚本 | 发布前不需要 `prepare` 生成物 | 无 `prepare`；`lib/` 是源码直发（ESM），正确 |
| 版本号同步点 | 改 `version` 必须同步 `lib/page.js` 的 `PAGE_VERSION` | README 第 309 行已写明 |
| tarball 无本机路径 | `npm pack --dry-run` 后检查 | 【待验证】本轮会跑 |
| `docs/screenshot.png` 在 `files` 内 | 是（`docs`） | 会进包，注意体积 |

### 发布命令（【人工】，需要 OTP）

```bash
cd <仓库目录>
npm run check          # 先跑一遍语法自检，红了就别发
npm pack --dry-run     # 看清单与体积，确认没有本机路径
npm version patch      # 或 major/minor，按语义化版本自己定
npm publish --otp=<6位码>
```

- 发布前先 `npm login` 确认登录的是 `corvou_4`。
- `--otp` 那 6 位码来自手机上的验证器；**不要**把码贴到任何文档或聊天里。
- 发完立刻验：`npm view dsh-ai-action-translator version`，以及在一个空目录 `npx -y @deepseek-ai/dsh plugin --profile probe2 add dsh-ai-action-translator`。
- **回滚**：npm 不支持删除后复用同名同版本；发错了只能 `npm deprecate` 并立刻发补丁版。

## 2 · 社区索引提交材料

### 通用字段（复制粘贴区）

| 字段 | 内容 |
|---|---|
| 标题 | `AI Action Translator — Agent 动作的解释层` |
| 一句话描述（中） | 让 Agent 的每一步都有中文旁路说明：做了什么、为什么、影响是什么、此刻能不能打断；决策与失败根因会沉淀成可回放的记录。 |
| 一句话描述（英） | A reviewable explanation layer for DSH agents: every action gets a plain-language why/what-changed/can-I-still-change-direction note, with decisions and failure root causes kept for replay. |
| 标签 | `dsh-plugin` `explainable-ai` `agent-audit` `decision-log` `observability` `learning` |
| 安装命令 | `npx -y @deepseek-ai/dsh plugin --profile desktop add dsh-ai-action-translator` |
| 仓库 | https://github.com/David-Martinez-worldexecute/dsh-ai-action-translator |
| 版本要求 | DSH ≥ 0.2.2-rc.3 · Node ≥ 20 |
| 截图 | `docs/screenshot.png`（配置面板）；建议补一张侧栏正文解释的实拍/GIF |

### 提交入口

| 索引 | 入口 | 状态 |
|---|---|---|
| awesome-dsh-plugin.com | 该站是否有提交表单/PR 入口 —— **需确认** | 不要凭猜测填表；先打开站点找 "submit" / 仓库 README |
| dsh-plugin-catalog（`cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`） | 它由 npm 上的 `dsh-plugin-catalog` 包生成；收录方式可能是「扫 npm 关键词」或「仓库收 PR」—— **需确认** | 发布 npm 后先观察 24–48h 是否自动出现 |
| 其它 awesome-list | 每个 list 的收录规则不同 —— **需确认** | 优先挑有「DSH / agent observability」分类的 |

> 原则：**先发 npm，再提交索引**。索引多数靠扫 npm 发现插件；没包的时候提交，等于让人点进 404。

## 3 · 冷启动文案（三条，按渠道区分，不是硬广）

### ① DSH-Guild / 社区面板（自我介绍式）

> 做了个插件，解决我自己反复踩的一个坑：Agent 改完代码说「好了」，但我复盘时讲不清它当时为什么选这条路、否掉了什么。
> `dsh-ai-action-translator` 现在做的是把每个动作翻成人话（做了什么/为什么/能不能打断），下一步想做「决策回放」——只记关键决策点，不刷屏。
> 想找几位愿意被「被 Agent 改坏过」的人试一下，装一条命令：`npx -y @deepseek-ai/dsh plugin --profile desktop add dsh-ai-action-translator`。
> 我更想要负面反馈：哪句话你最想删掉、哪一步你其实不需要解释。

### ② GitHub Release / README 顶部（一句话版）

> 你的 Agent 改对了代码，但你说不出它为什么这么改。这个插件给每一步一个人话旁路，并把决策留成可回放的记录。

### ③ 中文技术社区（问题先行，不贴功能表）

> 问个具体问题：Agent 一口气改了 6 个文件，你怎么确认它没有顺手删掉你以为还在的东西？
> 我给的答案不是「更多日志」，是「每个动作一句人话 + 关键决策单独留档」。顺手做成了 DSH 插件，欢迎拿真实项目来打脸。

## 4 · 7 天节奏（不需要预算）

| 天 | 动作 | 谁做 |
|---|---|---|
| D1 | 发 npm（0.8.x）+ 真机跑一次安装命令 | 【人工】 |
| D1 | README 首屏已是「一句话 + 一条命令 + 一张图」 | 【已做】 |
| D2 | 补一张侧栏解释的 GIF（≥8 秒，字幕自带） | 【人工】录屏 |
| D2 | 提交 1–2 个索引（入口确认后再动） | 【人工】 |
| D3 | DSH-Guild 发 ①，明确「要负面反馈」 | 【人工】 |
| D4–D5 | 收 3 条真实反馈 → 只改文案/默认值，不加功能 | 我 |
| D6 | 发 0.8.x 补丁，Release 里写「根据 X 位用户反馈改了什么」 | 【人工】发版 |
| D7 | 复盘：安装命令有没有人真的跑、卡在哪一步 | 一起 |

## 5 · 验收标准

- [ ] `npm view dsh-ai-action-translator version` 返回版本号（不再是 E404）
- [ ] 在**没装过本插件**的机器/profile 上，一条命令装完，重启后侧栏出现面板
- [ ] README 第一屏在 1080p 下不用滚动就能看到：标题、一句话、安装命令
- [ ] `npm pack --dry-run` 的清单里没有 `C:\Users\lin`、没有 `node_modules`、没有 `.env`
- [ ] 至少一个索引页能搜到本插件

# 安全策略

## 设计上的安全边界

这个插件能做的事情**在结构上就被限死了**，不依赖「作者承诺不干坏事」：

### 1. 只观察，不干预

插件只订阅 `tools/result` —— 这是一个**纯 emit 广播事件**，没有返回值语义。因此从代码结构上，它就无法否决、改写或阻止任何工具动作。

它**刻意不使用** `tools/pre-execute` / `tools/execute` / `tools/post-execute` 这三个 waterfall 事件，因为一旦介入，插件就获得了改结果、挡调用的能力。

### 2. 不联网

零网络代码。不发任何请求，不上报任何数据。

### 3. 不碰用户项目

不读写用户的任何项目文件。插件只写自己的一个数据文件：`~/.dsh/ai-action-translator/settings.json`。

### 4. 面板只应答本机回环

- Host 必须匹配 `127.0.0.1` / `[::1]` / `localhost`（含端口）
- Origin / Referer 必须同源
- 请求体上限 64KB
- 未知字段与坏 JSON 返回 400
- `enabled` / `order` 属结构配置，面板无法修改，只能通过 YAML

### 5. 密钥字段主动拦截

字段名匹配 `password` / `passwd` / `secret` / `token` / `api_key` / `credential` / `authorization` / `cookie` / `session_id` 等形状时，插件会主动拒绝记录。

### 6. 生命周期干净

所有注册都通过 `ctx.effect` / disposer 绑定。卸载插件即干净移除，不留悬挂监听。

### 7. 不猜测隐藏推理

插件只解释**可观察的事实**：消息、工具名、参数摘要、路径、命令、工具返回。它不会、也不声称能读取模型的隐藏 Chain-of-Thought。

## 报告漏洞

**请不要开公开 issue 报告安全问题。**

请通过 GitHub 的私密安全公告功能报告：

> 仓库页 → Security → Advisories → Report a vulnerability

如果该入口不可用，请开一个不含细节的 issue，说明「有安全问题需要私下沟通」，维护者会联系你。

### 请包含

- 受影响的版本（`package.json` 的 `version`）
- 复现步骤
- 影响范围（能读到什么 / 能做什么）
- 如果可能，给出修复建议

### 我们的承诺

- 48 小时内确认收到
- 修复前不公开细节
- 修复后经你同意才会在 CHANGELOG 里署名致谢

## 支持的版本

| 版本 | 安全更新 |
|---|---|
| 0.5.x | ✅ 支持中 |
| 0.3.x – 0.4.x | ⚠️ 仅关键修复，建议升级 |
| < 0.3 | ❌ 不再支持 |

运行环境：DSH Desktop ≥ 0.2.2-rc.3（由 `package.json` 的 `dsh.engines.dsh` 声明），Node.js ≥ 20。在更低的 DSH 上未做验证，不承诺行为一致。

## 已知的「不是漏洞」

下面这些是**内核设计**，不是本插件的缺陷：

- **直接手敲 `/api/ai-action-translator/` 返回 401** —— `dsh web` 内核把 `/api*` 锁在「启动令牌 → 签名 Cookie」之后。请从设置页分区进入。
- **面板只能在已登录的 DSH 界面内使用** —— 同源票据的要求，不是权限 bug。

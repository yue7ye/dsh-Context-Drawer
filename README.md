# dsh-context-date-pruner

给 DeepSeek Harness (DSH) 用的上下文编辑插件：**按时间段挑出会话里已经结束的轮次，把选中的那几条从模型上下文中移走**。

DSH plugin for DeepSeek Harness: **filter a live session by time range and remove individual finished turns from the model-visible context**.

## 它做什么 · What it does

- 在输入框下方加一个「上下文编辑」按钮，按本地时区（默认 `Asia/Shanghai`）列出当前打开着的会话里所有**已经结束的轮次**：每条带开始时间、预览、节点数和粗略 token。
- 用「从 / 到」时间输入框或「今天 / 近 3 天 / 近 7 天 / 全部时间」快速筛选时间段，再逐条勾选要删除的轮次；也可以按天全选或全选当前列表。
- 先「预演」确认会删掉多少轮、多少节点、大约多少 token，再点两次「删除」。
- 删除只作用于**模型后续请求看到的上下文**：会话日志是 append-only 的，插件不删除、不改写任何已有事件；聊天记录里原来的消息仍然在。
- 系统提示永远保留；当前正在进行的那一轮不能删除。
- Adds an **Edit context** button below the composer. It lists the finished turns of the live session with start time, preview, node count and approximate tokens. Filter by a time range (or quick chips), select the turns to remove, run a dry run, then confirm twice. The append-only session log and the rendered transcript are left untouched, the system prompt is always kept, and the active turn is never listed.

## 安装 · Install

从市场安装：**插件 → 发现 → 搜索 `dsh-context-date-pruner` → 安装**。

Or install directly in a DSH profile:

```sh
dsh plugin --profile <your-profile> add dsh-context-date-pruner
```

## 使用 · Usage

1. 打开一个会话（插件只对正在运行的 live 会话生效）。
2. 点输入框下方的「上下文编辑」。
3. 用时间范围筛选，或直接按日期看；勾选具体轮次 →「预演」→「删除」，再点一次确认。
4. 「全选当前列表」可以一次处理筛选结果里的所有可删轮次。

## 语义与限制 · Semantics and limits

- 删除方式：向会话日志追加带 `surfaceOp: replace` 的占位事件（空内容的 developer 消息），让被选中的 surface 节点从 `deriveMessages()` 里消失。历史事件原样保留，所以事后仍可从日志恢复。
- 只影响模型上下文；不删除聊天记录、不删除磁盘日志。
- **不可撤销**：被移出上下文的内容不会再回到后续模型的请求里。
- 只对打开着的会话生效；会话关闭后无法编辑。
- 系统提示（surface 第 0 个节点）永远不会被删除。
- 进行中的 turn 不会被列出或删除。
- Deleting is implemented as surface replacements: the session log stays append-only, the transcript keeps the original messages, and only the model-visible derivation changes. There is no undo offered by the plugin.

## 兼容性 · Compatibility

- DSH `>= 0.2.0-rc.2`（已在桌面版 0.2.1-rc.2 上验证）。
- 纯 Host + 浏览器 UI 插件，无运行时依赖。

## 开发 · Development

```sh
npm test        # node --test  —— 纯逻辑测试，不需要 DSH 检出
```

`logic.js` 不 import 任何 Harness 包，只依赖传进来的 session 对象，方便离线测试。

## License

MIT

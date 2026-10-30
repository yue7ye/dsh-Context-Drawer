# dsh-Context-Drawer

A DeepSeek Harness (DSH) plugin with exactly **one** job:

> When the conversation context reaches a threshold (default **50%** of the model window), move older messages into a **folder associated with that conversation**, then release the oldest finished turns from the model-visible context.

There is no UI, no button, no route, no memory bridge, no prompt injection. The chat transcript and the append-only session log are never modified — the released part is only invisible to the model, and the archive on disk always has it.

## Behaviour

- Every turn, at the first step, the plugin estimates context usage (real provider usage when available, character estimate otherwise).
- When usage reaches `thresholdRatio` (default `0.5`) of the model window:
  1. Append the messages newer than the last archive watermark to `{archiveDir}/{sessionShort}/{date}.md`, fsync first;
  2. Only after the file is safely on disk, remove the oldest **finished** turns from the model-visible context with a surface `replace` event.
     The latest `keepRecentTurns` (default 6) turns are never touched, at most `releaseMaxTurns` (default 40) per pass, stopping near `releaseTargetRatio` (default 0.45).
- Session log and transcript remain complete; the archive file is plain Markdown you can open at any time.
- State lives in `~/.dsh/context-drawer/state/state.json` (one watermark per session, prevents duplicates).

## Where the files go

Default: `~/上下文存档/{sessionShort}/{YYYY-MM-DD}.md`

`sessionShort` is the session id with the `session-` prefix removed, first 8 characters — one subfolder per conversation, so you can always tell which conversation a file belongs to.

## Configuration (`cordis.patch.yml`)

```yaml
- insert:
    - id: context-drawer
      name: dsh-context-drawer
      config:
        archiveDir: C:/deepseek/上下文存档   # optional; default ~/上下文存档
        thresholdRatio: 0.5
```

Other optional fields: `thresholdTokens` (absolute token threshold), `modelWindow` (default 1048576),
`charsPerToken`, `baselineTokens`, `keepRecentTurns`, `releaseMaxTurns`, `releaseTargetRatio`,
`format` (`md` | `jsonl` | `txt`), `includeRoles`, `minTextLength`, `maxEntryChars`,
`timeZone` (default `Asia/Shanghai`), `stateDir`.

## Install

From the DSH plugin market, search **dsh-Context-Drawer** and install, or:

```bash
dsh plugin --profile <profile> add dsh-context-drawer
```

## Test

```bash
node test.mjs
```

Offline mock session: 10 finished turns → threshold → 20 archive entries + 8 released turns → second trigger only appends the new messages → non-first steps and low usage do nothing.

## 中文说明

只做一件事：上下文占用到达阈值（默认 50%）时，把更早的对话追加进「跟这个会话关联的外部文件夹」，落盘之后再把最旧的已结束轮次从模型可见上下文里移走。没有界面、没有按钮、不写记忆、不碰聊天记录原文。

默认存档位置 `~/上下文存档/{会话短号}/{日期}.md`，一个会话一个文件夹；状态在 `~/.dsh/context-drawer/state/state.json`。最近 6 轮永远保留，单次最多释放 40 轮。

MIT License.

// 离线 smoke 测试：不需要 DSH，跑 `node test.mjs`。
// 用假 session 模拟：10 个已结束轮次 → 上下文超阈值 → 存档进外部文件夹 + surface replace 释放旧轮次。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apply } from "./index.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-drawer-test-"));
const archiveDir = path.join(tmp, "存档");
const stateDir = path.join(tmp, "state");

const logs = [];
let handler = null;
const ctx = {
  logger: {
    info: (message) => logs.push("info " + message),
    warn: (message) => logs.push("warn " + message),
  },
  on(event, fn) {
    assert.equal(event, "agent/pre-step");
    handler = fn;
  },
  provide() {},
  sessions: { flush: async () => {} },
};

apply(ctx, {
  archiveDir,
  thresholdRatio: 0.5,
  thresholdTokens: 0,
  modelWindow: 1000,
  charsPerToken: 1,
  baselineTokens: 0,
  keepRecentTurns: 2,
  releaseMaxTurns: 100,
  releaseTargetRatio: 0.2,
  stateDir,
  timeZone: "Asia/Shanghai",
  format: "md",
});
assert.equal(typeof handler, "function", "pre-step 钩子应已注册");

function makeSession(id = "session-testdrawer01") {
  const events = [];
  const surface = [];
  const session = {
    id,
    header: {},
    surface: { nodes: surface },
    seq: 0,
    snapshotEvents: () => events,
    deriveEventMessage(event) {
      if (String(event?.type ?? "").endsWith("/message") && event.data?.message) return event.data.message;
      return null;
    },
    append(type, data, opts = {}) {
      const event = { type, seq: session.seq, time: Date.now(), data };
      if (opts.surfaceOp) event.surfaceOp = opts.surfaceOp;
      session.seq += 1;
      events.push(event);
      if (opts.surfaceOp?.op === "replace") {
        const { startSeq, endSeq } = opts.surfaceOp;
        const kept = [];
        for (const seq of surface) {
          if (seq < startSeq || seq > endSeq) kept.push(seq);
        }
        kept.push(event.seq);
        kept.sort((a, b) => a - b);
        surface.length = 0;
        surface.push(...kept);
      } else {
        surface.push(event.seq);
      }
      return event;
    },
    surfaceManager: {
      validateNext(candidate) {
        assert.equal(candidate?.type, "developer/message");
        assert.equal(candidate?.surfaceOp?.op, "replace");
        const { startSeq, endSeq } = candidate.surfaceOp;
        assert.ok(startSeq <= endSeq, "范围要正着来");
        assert.ok(surface.some((seq) => seq >= startSeq && seq <= endSeq), "范围得在 surface 里");
        assert.ok(String(candidate.data?.message?.source?.kind ?? "").length > 0);
      },
    },
  };

  function addTurn(turn, usage) {
    const push = (type, data, onSurface) => {
      const event = { type, seq: session.seq, time: Date.now(), data };
      session.seq += 1;
      events.push(event);
      if (onSurface) surface.push(event.seq);
      return event;
    };
    push("turn/start", { turn }, false);
    push("step/start", { turn, step: 1 }, false);
    push("user/message", { turn, step: 1, message: { role: "user", content: [{ type: "text", text: "用户说" + "啊".repeat(100) }] } }, true);
    push("assistant/message", { turn, step: 1, message: { role: "assistant", content: [{ type: "text", text: "助手答" + "嗯".repeat(100) }] }, usage }, true);
    push("turn/end", { turn }, false);
  }
  return { session, events, surface, addTurn };
}

const { session, events, surface, addTurn } = makeSession();
for (let turn = 1; turn <= 10; turn += 1) addTurn(turn);

const decision = { kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "当前这一轮" }] }] };
const payload = { agent: { session }, step: 1, signal: { aborted: false } };

const result1 = await handler(payload, async () => decision);
assert.equal(result1, decision, "decision 原样返回");
assert.equal(result1.messages.length, 1, "不往 messages 里塞东西");

// 1. 外部文件夹：按会话子文件夹 + 日期文件
const sessionFolder = path.join(archiveDir, "testdraw");
const files = fs.existsSync(sessionFolder) ? fs.readdirSync(sessionFolder) : [];
assert.equal(files.length, 1, "应生成 1 个存档文件，实际 " + JSON.stringify(files));
const archiveFile = path.join(sessionFolder, files[0]);
const text = fs.readFileSync(archiveFile, "utf8");
assert.ok(text.includes("# 上下文存档"), "存档应有批次头");
assert.ok(text.includes("会话 testdraw"), "存档应标会话短号");
assert.ok((text.match(/^## /gmu) ?? []).length === 20, "10 轮 × 2 条消息应存 20 条，实际 " + (text.match(/^## /gmu) ?? []).length);

// 2. 释放：8 个最旧轮次被移出模型上下文（保留最近 2 轮）
const replacements = events.filter((event) => event.type === "developer/message");
assert.equal(replacements.length, 8, "应释放 8 轮，实际 " + replacements.length);
assert.ok(replacements.every((event) => event.surfaceOp?.op === "replace"));
const remainingTurns = new Set();
for (const seq of surface) {
  const event = events[seq];
  if (event?.type === "user/message") remainingTurns.add(event.data.turn);
}
assert.deepEqual([...remainingTurns].sort((a, b) => a - b), [9, 10], "surface 里应只剩最近 2 轮");
// 原文事件都还在日志里（聊天记录不动）
assert.equal(events.filter((event) => event.type === "user/message").length, 10, "日志原文不动");

// 3. 状态水位
const stateFile = path.join(stateDir, "state.json");
assert.ok(fs.existsSync(stateFile), "state.json 应存在");
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const bucket = state.sessions[session.id];
assert.ok(bucket.lastArchivedSeq > 0, "水位应推进");
assert.equal(bucket.archivedTotal, 20);

// 4. 再触发一次：只把新增的一条轮次（2 条消息）补进去，旧的不重复存
addTurn(11);
const countEntries = (raw) => (raw.match(/^## /gmu) ?? []).length;
const before = countEntries(fs.readFileSync(archiveFile, "utf8"));
const result2 = await handler({ ...payload, step: 1 }, async () => ({ kind: "enter", messages: [] }));
assert.equal(result2.kind, "enter");
const after = countEntries(fs.readFileSync(archiveFile, "utf8"));
assert.equal(before, 20);
assert.equal(after, 22, "第二遍只应补存新轮次的 2 条消息，实际 " + after);

// 5. 阈值以下不应该动
const quiet = makeSession("session-quiet");
quiet.addTurn(1);
const quietBefore = quiet.surface.length;
await handler({ agent: { session: quiet.session }, step: 1, signal: { aborted: false } }, async () => ({ kind: "enter", messages: [] }));
assert.equal(quiet.surface.length, quietBefore, "没超阈值不应改 surface");

// 6. 非第一步不触发
const step2 = makeSession("session-step2");
for (let turn = 1; turn <= 10; turn += 1) step2.addTurn(turn);
const step2Before = step2.surface.length;
await handler({ agent: { session: step2.session }, step: 2, signal: { aborted: false } }, async () => ({ kind: "enter", messages: [] }));
assert.equal(step2.surface.length, step2Before, "step 2 不应触发");

console.log("smoke 测试通过 ✔");
console.log("  archiveDir =", archiveDir);
console.log("  存档文件 =", archiveFile);
console.log("  释放事件 =", replacements.length, "轮");
console.log("  日志行 =", logs.filter((line) => line.startsWith("info")).join(" | "));

// dsh-context-drawer · DSH 插件入口
// 唯一功能：上下文占用达到阈值（默认 50%）时，把更早的对话追加进「跟会话关联的外部文件夹」，
// 落盘成功后再把最旧的已结束轮次从模型上下文移走（surface replace）。
// 日志与聊天记录原文都不动；不提供任何界面、路由或手动操作。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  VERSION,
  normalizeConfig,
  estimateContext,
  readContextWindow,
  collectSurface,
  buildArchiveEntries,
  composeArchiveAppendBody,
  resolveArchiveDir,
  resolveTargetFile,
  buildReleasePlan,
  buildReplacementEvent,
  formatTime,
  localDate,
  clip,
  sessionShortId,
} from "./core.mjs";

export const name = "dsh-context-drawer";
export const inject = ["agents", "sessions"];

const DEFAULT_STATE_DIR = path.join(os.homedir(), ".dsh", "context-drawer", "state");

export function apply(ctx, input = {}) {
  try {
    return applyInner(ctx, input);
  } catch (error) {
    warn(ctx, "init failed: " + (error?.message || error));
  }
}

function warn(ctx, message) {
  try {
    ctx.logger?.warn?.("[context-drawer] " + message);
  } catch {}
}

function applyInner(ctx, input = {}) {
  const config = normalizeConfig(input);
  config.stateDir = config.stateDir && String(config.stateDir).trim().length > 0
    ? String(config.stateDir)
    : DEFAULT_STATE_DIR;
  try {
    fs.mkdirSync(config.stateDir, { recursive: true });
  } catch (error) {
    warn(ctx, "无法创建状态目录: " + (error?.message || error));
  }

  const logInfo = (message) => {
    try { ctx.logger?.info?.("[context-drawer] " + message); } catch {}
  };
  const logWarn = (message) => warn(ctx, message);

  // ── 外部存档文件夹（跟会话关联：每个会话一个子文件夹） ──
  const resolved = resolveArchiveDir(config);
  let archiveDir = resolved.dir;
  if (resolved.error) {
    const fallback = path.join(config.stateDir, "context-archive");
    logWarn("存档目录不安全（" + resolved.error + "），改用 " + fallback);
    archiveDir = fallback;
  }
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
  } catch (error) {
    logWarn("无法创建存档目录: " + (error?.message || error));
  }

  // ── 状态：只记每个会话的存档水位，防重复 ──
  const stateFile = path.join(config.stateDir, "state.json");
  const state = loadState(stateFile);

  const now = () => Date.now();

  function persist() {
    try {
      writeFileAtomic(stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      logWarn("写入 state.json 失败: " + (error?.message || error));
    }
  }

  function appendToFile(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let fd;
    try {
      fd = fs.openSync(file, "a");
      fs.writeSync(fd, text, null, "utf8");
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch {}
      }
    }
  }

  const bucketFor = (sessionId) => {
    if (!state.sessions[sessionId]) {
      state.sessions[sessionId] = { lastArchivedSeq: 0, archivedTotal: 0 };
    }
    return state.sessions[sessionId];
  };
  const hasArchiveForSession = (sessionId) => (Number(bucketFor(sessionId).archivedTotal) || 0) > 0;

  /** 存档：把上次水位之后的新 surface 消息追加进该会话的存档文件。返回 {archived, file}。 */
  function archiveNewMessages(session, events) {
    const sessionId = String(session?.id ?? "unknown");
    const bucket = bucketFor(sessionId);
    const nodes = collectSurface(session, events)
      .filter((node) => node.seq > (Number(bucket.lastArchivedSeq) || 0));
    if (nodes.length === 0) return { archived: 0, file: null };
    let file = null;
    let archived = 0;
    const stamp = now();
    // 先推进水位（即使条目被过滤光，也别反复扫描同一段），再落盘
    bucket.lastArchivedSeq = Math.max(...nodes.map((node) => node.seq), Number(bucket.lastArchivedSeq) || 0);
    const entries = buildArchiveEntries(session, nodes, config);
    if (entries.length > 0) {
      file = resolveTargetFile(config, session, stamp);
      const exists = fs.existsSync(file);
      const body = composeArchiveAppendBody(entries, session, stamp, exists, config);
      if (body) {
        appendToFile(file, body);
        archived = entries.length;
        bucket.archivedTotal = (Number(bucket.archivedTotal) || 0) + archived;
        bucket.lastSpillTime = stamp;
      }
    }
    persist();
    return { archived, file };
  }

  /** 释放：把最旧的已结束轮次从模型上下文移走（这个会话先落过盘才允许释放）。 */
  async function applyRelease(session, events, stats) {
    const sessionId = String(session?.id ?? "unknown");
    const manager = session?.surfaceManager;
    if (!manager || typeof manager.validateNext !== "function") {
      logWarn("surfaceManager 不可用，跳过释放");
      return null;
    }
    if (!hasArchiveForSession(sessionId)) {
      logWarn("这个会话还没有任何存档，拒绝释放（避免对话内容从上下文消失）");
      return null;
    }
    const targetRatio = Number(config.releaseTargetRatio);
    const options = targetRatio > 0
      ? { currentTokens: stats.tokens, targetTokens: Math.round(targetRatio * config.modelWindow) }
      : {};
    const plan = buildReleasePlan(session, events, config, options);
    if (plan.runs.length === 0) return null;
    const valid = [];
    for (const run of plan.runs) {
      try {
        const candidate = buildReplacementEvent(session, run);
        manager.validateNext(candidate);
        valid.push(candidate);
      } catch (error) {
        logWarn("跳过一段释放（校验未过）: " + (error?.message || error));
      }
    }
    let done = 0;
    for (const candidate of valid) {
      try {
        session.append("developer/message", candidate.data, {
          surfaceOp: candidate.surfaceOp,
          sourceEventSeqs: candidate.sourceEventSeqs,
        });
        done += 1;
      } catch (error) {
        logWarn("写入释放事件失败: " + (error?.message || error));
      }
    }
    if (done === 0) return null;
    if (ctx.sessions !== undefined && typeof ctx.sessions?.flush === "function") {
      try { await ctx.sessions.flush(session); } catch (error) { logWarn("flush 失败: " + (error?.message || error)); }
    }
    return { turns: done, approxTokens: plan.approxTokens, planned: plan.runs.length };
  }

  // ── 每轮第一步：估算 → 超阈值 → 存档 → 释放 ──
  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    try {
      if (decision?.kind !== "enter") return decision;
      if (payload?.signal?.aborted) return decision;
      if (payload?.step !== undefined && payload.step !== 1) return decision;
      const session = payload?.agent?.session;
      if (!session) return decision;
      if (session?.header?.origin === "subagent") return decision;
      const sessionId = String(session.id ?? "unknown");

      const events = session.snapshotEvents();
      const providerWindow = readContextWindow(events);
      if (providerWindow !== null && providerWindow !== config.modelWindow) {
        config.modelWindow = providerWindow;
      }
      const stats = estimateContext(session, events, config);
      const overRatio = stats.ratio >= config.thresholdRatio;
      const overTokens = config.thresholdTokens > 0 && stats.tokens >= config.thresholdTokens;
      if (!overRatio && !overTokens) return decision;

      const archived = archiveNewMessages(session, events);
      let released = null;
      if (archived.archived > 0 || hasArchiveForSession(sessionId)) {
        released = await applyRelease(session, events, stats);
      }

      if (archived.archived > 0 || released !== null) {
        logInfo(
          "上下文约 " + stats.tokens.toLocaleString("en-US") + " token（" + (stats.ratio * 100).toFixed(0) + "%，" + stats.source + "）" +
          " → 存档 " + archived.archived + " 条" + (archived.file ? " → " + archived.file : "") +
          (released !== null ? "；释放 " + released.turns + " 轮（约 " + released.approxTokens.toLocaleString("en-US") + " token）" : ""),
        );
      }
      return decision;
    } catch (error) {
      logWarn("pre-step 失败: " + (error?.message || error));
      return decision;
    }
  });

  ctx.provide("contextDrawer", {
    version: VERSION,
    config,
    state,
    archiveDir,
    stateFile,
    folderFor: (sessionId) => path.join(archiveDir, sessionShortId(sessionId)),
    stats: () => ({
      version: VERSION,
      archiveDir,
      stateFile,
      sessions: Object.keys(state.sessions).length,
      archivedTotal: Object.values(state.sessions).reduce((acc, item) => acc + (Number(item.archivedTotal) || 0), 0),
      thresholdRatio: config.thresholdRatio,
      modelWindow: config.modelWindow,
    }),
  });

  logInfo(
    "ready · v" + VERSION +
    " · 阈值 " + (config.thresholdRatio * 100).toFixed(0) + "%" +
    (config.thresholdTokens > 0 ? " / " + config.thresholdTokens + " token" : "") +
    " · 存档 " + archiveDir + "（每个会话一个子文件夹）" +
    " · 保留最近 " + config.keepRecentTurns + " 轮",
  );
}

function writeFileAtomic(file, text) {
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

function loadState(stateFile) {
  const empty = { sessions: {} };
  try {
    if (!fs.existsSync(stateFile)) return empty;
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      sessions: raw && typeof raw.sessions === "object" && raw.sessions !== null ? raw.sessions : {},
    };
  } catch {
    return empty;
  }
}

// dsh-context-drawer · 核心逻辑（不 import 任何 Harness 包，可离线测试）
// 唯一功能：上下文占用达到阈值时，把更早的对话写进跟会话关联的外部文件夹，
// 再把最旧的已结束轮次从模型上下文中移走（surface replace；日志与聊天记录原文都不动）。
import os from "node:os";
import path from "node:path";

export const VERSION = "0.1.0";

export const DEFAULT_CONFIG = {
  // ── 触发 ──
  thresholdRatio: 0.5, // 上下文占窗口比例达到它就整理（0.5 = 50%）
  thresholdTokens: 0, // 绝对 token 阈值（>0 时与占比满足任一即触发）
  modelWindow: 1048576, // 模型上下文窗口（拿不到 request/context 时的兜底）
  charsPerToken: 1.8, // 无真实用量时的字符→token 估算
  baselineTokens: 24000, // 无真实用量时的固定开销（系统提示+工具定义）
  timeZone: "Asia/Shanghai",
  // ── 外部文件夹（跟会话关联：每个会话一个子文件夹） ──
  archiveDir: "", // 空 = 用户主目录下「上下文存档」；推荐绝对路径，如 C:/deepseek/上下文存档
  targetFile: "", // 空 = {archiveDir}/{session}/{date}.{ext}；支持 {date} {time} {session} {archiveDir} {stateDir} {ext}
  format: "md", // md | jsonl | txt
  includeRoles: ["user", "assistant", "developer", "tool"],
  minTextLength: 6,
  maxEntryChars: 8000, // 单条消息最多存档多少字符（工具输出很长，会截断）
  // ── 释放：把最旧的已结束轮次移出模型上下文（日志与原文都保留） ──
  keepRecentTurns: 6, // 最近 N 轮永不释放
  releaseMaxTurns: 40, // 单次最多释放几轮
  releaseTargetRatio: 0.45, // 释放到窗口占比约 45% 就停（0 = 不管目标，直接按上限释放）
  // ── 其他 ──
  stateDir: "", // 空 = ~/.dsh/context-drawer/state
};

const MESSAGE_EVENT_TYPES = new Set([
  "system/message",
  "developer/message",
  "user/message",
  "assistant/message",
  "tool/result",
]);

const COMPACTION_EVENT_TYPES = new Set([
  "compaction/start",
  "compaction/end",
  "compaction/summary",
  "compaction/prune",
]);

const PLACEHOLDER_TYPES = new Set(["system", "user", "assistant", "developer", "tool"]);

const FORBIDDEN_ARCHIVE_PREFIXES = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
  "c:\\$recycle.bin",
  "c:\\system volume information",
];

export function normalizeConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG };
  if (input === null || typeof input !== "object") return config;
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (input[key] !== undefined && input[key] !== null) config[key] = input[key];
  }
  config.thresholdRatio = clamp(Number(config.thresholdRatio) || DEFAULT_CONFIG.thresholdRatio, 0.05, 0.98);
  config.thresholdTokens = Math.max(0, Number(config.thresholdTokens) || 0);
  config.modelWindow = Math.max(1024, Number(config.modelWindow) || DEFAULT_CONFIG.modelWindow);
  config.charsPerToken = Math.max(0.5, Number(config.charsPerToken) || DEFAULT_CONFIG.charsPerToken);
  config.baselineTokens = Math.max(0, Number(config.baselineTokens) || 0);
  config.keepRecentTurns = Math.max(0, Math.floor(Number(config.keepRecentTurns) || 0));
  config.releaseMaxTurns = Math.max(1, Math.floor(Number(config.releaseMaxTurns) || 1));
  config.releaseTargetRatio = clamp(Number(config.releaseTargetRatio) || 0, 0, 0.98);
  config.maxEntryChars = Math.max(200, Math.floor(Number(config.maxEntryChars) || 8000));
  config.format = ["md", "jsonl", "txt"].includes(config.format) ? config.format : "md";
  if (typeof config.archiveDir !== "string") config.archiveDir = "";
  if (typeof config.targetFile !== "string") config.targetFile = "";
  if (!Array.isArray(config.includeRoles) || config.includeRoles.length === 0) {
    config.includeRoles = [...DEFAULT_CONFIG.includeRoles];
  }
  config.includeRoles = config.includeRoles.filter((role) => typeof role === "string" && PLACEHOLDER_TYPES.has(role));
  if (config.includeRoles.length === 0) config.includeRoles = [...DEFAULT_CONFIG.includeRoles];
  return config;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// ────────────────────────────── 时间 ──────────────────────────────

export function localDate(timestamp, timeZone = "Asia/Shanghai") {
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
}

export function formatTime(timestamp, timeZone = "Asia/Shanghai") {
  if (!Number.isFinite(timestamp)) return "?";
  try {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(timestamp));
    return `${date} ${clock}`;
  } catch {
    return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
  }
}

/** 文件名安全的短时间，用于模板 {time}。 */
export function shortTime(timestamp, timeZone = "Asia/Shanghai") {
  return formatTime(timestamp, timeZone).replace(/[: ]/g, "-");
}

/** 会话短号：去掉 "session-" 前缀再取前 8 位，用作「跟上下文关联的文件夹」名。 */
export function sessionShortId(sessionId) {
  const raw = String(sessionId ?? "").replace(/^session-/u, "");
  return raw.length > 0 ? raw.slice(0, 8) : "unknown";
}

// ────────────────────────────── 文本工具 ──────────────────────────────

export function clip(text, max) {
  if (typeof text !== "string") return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** 从模型消息里取纯文本（跳过工具调用、图片标记）。 */
export function textOf(message) {
  if (message === null || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block.type === "image") parts.push("[图片]");
    else if (block.type === "file" || block.type === "document") parts.push("[文件]");
  }
  return parts.join(" ").replace(/\s+/gu, " ").trim();
}

// ────────────────────────────── 路径与安全 ──────────────────────────────

/**
 * 检查存档目录是否安全可写。返回错误文本（不安全）或 null（安全）。
 * 保护点：只允许绝对路径、不能是盘符根目录、不能是系统目录、路径长度受限。
 */
export function validateArchiveDir(dir) {
  if (typeof dir !== "string" || dir.trim().length === 0) return "存档目录不能为空";
  const raw = dir.trim();
  if (!path.isAbsolute(raw)) return "存档目录必须是绝对路径（例如 C:\\deepseek\\上下文存档）";
  let resolved;
  try {
    resolved = path.resolve(raw);
  } catch {
    return "存档目录无法解析";
  }
  const parsed = path.parse(resolved);
  const root = parsed.root.replace(/[\\/]+$/u, "");
  const normalized = resolved.replace(/[\\/]+$/u, "");
  if (normalized === root) return "不能直接把存档目录设成盘符根目录";
  if (resolved.length > 180) return "存档目录路径太长（最多 180 个字符）";
  const lower = resolved.toLowerCase().replace(/\//gu, "\\");
  for (const prefix of FORBIDDEN_ARCHIVE_PREFIXES) {
    if (lower === prefix || lower.startsWith(prefix + "\\")) {
      return "不允许把存档写进系统目录：" + prefix;
    }
  }
  if (lower.includes("\\.dsh\\sessions") || lower.includes("\\dsh\\sessions\\")) {
    return "不允许把存档写进 DSH 会话数据目录";
  }
  if ((resolved + path.sep).includes(path.sep + path.sep + path.sep) && !resolved.startsWith("\\\\")) {
    return "路径里有异常的分隔符";
  }
  return null;
}

/** 解析实际生效的存档目录：返回 { dir, error }。 */
export function resolveArchiveDir(config = DEFAULT_CONFIG) {
  const raw = typeof config.archiveDir === "string" && config.archiveDir.trim().length > 0
    ? config.archiveDir.trim()
    : path.join(os.homedir(), "上下文存档");
  const error = validateArchiveDir(raw);
  return { dir: path.resolve(raw), error };
}

/** 根据配置生成存档文件路径（默认每个会话一个子文件夹）。 */
export function resolveTargetFile(config, session, timestamp) {
  const ext = config.format === "jsonl" ? "jsonl" : config.format === "txt" ? "txt" : "md";
  const date = localDate(timestamp, config.timeZone) || "unknown-date";
  const time = shortTime(timestamp, config.timeZone);
  const sessionShort = sessionShortId(session?.id);
  const archiveDir = config.archiveDir && String(config.archiveDir).trim().length > 0
    ? String(config.archiveDir).trim()
    : path.join(os.homedir(), "上下文存档");
  const template = config.targetFile && config.targetFile.trim().length > 0
    ? config.targetFile.trim()
    : "{archiveDir}/{session}/{date}.{ext}";
  const replaced = template
    .replaceAll("{date}", date)
    .replaceAll("{time}", time)
    .replaceAll("{session}", sessionShort)
    .replaceAll("{archiveDir}", archiveDir)
    .replaceAll("{stateDir}", config.stateDir ?? "")
    .replaceAll("{ext}", ext);
  return path.normalize(replaced);
}

// ────────────────────────────── 估算 ──────────────────────────────

function usagePromptTokens(usage) {
  if (usage === null || typeof usage !== "object") return null;
  const input = Number(usage.inputTokens);
  if (!Number.isFinite(input)) return null;
  const cacheRead = Number(usage.cacheReadTokens);
  const cacheWrite = Number(usage.cacheWriteTokens);
  const total = input
    + (Number.isFinite(cacheRead) && cacheRead > 0 ? cacheRead : 0)
    + (Number.isFinite(cacheWrite) && cacheWrite > 0 ? cacheWrite : 0);
  return total > 0 ? total : null;
}

function surfaceTextChars(session, nodes) {
  let chars = 0;
  for (const node of nodes) {
    try {
      const message = session.deriveEventMessage(node.event);
      if (message) chars += textOf(message).length;
    } catch {
      // 单条消息推导失败不影响整体估算
    }
  }
  return chars;
}

/**
 * 估算当前上下文占用。优先用模型真实用量：
 *   最近一条 assistant/message 的 usage（input+cacheRead+cacheWrite = 当次提示词 token）
 *   + 其后 surface 新增内容按 charsPerToken 估算；
 * 找不到真实用量（或之后发生过压缩，锚点失效）时退回字符启发式。
 * 返回 { tokens, chars, nodes, ratio, source, heuristicTokens, anchorSeq }。
 */
export function estimateContext(session, events, config = DEFAULT_CONFIG) {
  const nodes = collectSurface(session, events);
  const chars = surfaceTextChars(session, nodes);
  const heuristicTokens = Math.ceil(chars / config.charsPerToken) + config.baselineTokens;

  let lastUsage = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    if (event.type !== "assistant/message") continue;
    const prompt = usagePromptTokens(event.data?.usage);
    if (prompt === null) continue;
    lastUsage = { seq: event.seq, prompt };
    break;
  }

  let compactionAfterUsage = false;
  if (lastUsage !== null) {
    for (const event of events) {
      if (event === undefined || event === null) continue;
      if (COMPACTION_EVENT_TYPES.has(event.type) && event.seq > lastUsage.seq) {
        compactionAfterUsage = true;
        break;
      }
    }
  }

  if (lastUsage !== null && !compactionAfterUsage) {
    const tailNodes = nodes.filter((node) => node.seq > lastUsage.seq);
    const tailChars = surfaceTextChars(session, tailNodes);
    const tokens = lastUsage.prompt + Math.ceil(tailChars / config.charsPerToken);
    return {
      tokens,
      chars,
      nodes: nodes.length,
      ratio: tokens / config.modelWindow,
      source: "provider-usage",
      heuristicTokens,
      anchorSeq: lastUsage.seq,
    };
  }

  return {
    tokens: heuristicTokens,
    chars,
    nodes: nodes.length,
    ratio: heuristicTokens / config.modelWindow,
    source: "heuristic",
    heuristicTokens,
    anchorSeq: null,
  };
}

/** 从会话日志里取模型窗口（request/context 事件），拿不到返回 null。 */
export function readContextWindow(events) {
  for (let index = (events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "request/context") continue;
    const window = Number(event.data?.contextWindow);
    if (Number.isFinite(window) && window > 0) return window;
  }
  return null;
}

// ────────────────────────────── 事件/轮次 ──────────────────────────────

/**
 * 从事件序列切出 turn 区间。只有 turn/end 正常收尾的轮次才 closed:true（可释放）。
 * 未收尾的轮次是当前正在进行的对话。
 */
export function collectTurns(events) {
  const turns = [];
  let open = null;
  for (const event of events) {
    if (!event) continue;
    if (event.type === "turn/start") {
      if (open !== null) {
        open.endSeq = event.seq - 1;
        turns.push(open);
      }
      const rawTurn = event.data !== null && typeof event.data === "object" ? event.data.turn : undefined;
      open = {
        turn: typeof rawTurn === "number" ? rawTurn : turns.length + 1,
        startSeq: event.seq,
        endSeq: null,
        startTime: event.time,
        endTime: null,
        closed: false,
      };
    } else if (event.type === "turn/end" && open !== null) {
      open.endSeq = event.seq;
      open.endTime = event.time;
      open.closed = true;
      turns.push(open);
      open = null;
    }
  }
  if (open !== null) turns.push(open);
  return { turns, activeTurn: open !== null };
}

/** 在按 startSeq 升序的 closed turns 里找 seq 所属的 turn。 */
export function findTurn(turns, seq) {
  let low = 0;
  let high = turns.length - 1;
  let found = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = turns[mid];
    if (candidate.startSeq <= seq) {
      found = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found !== null && seq <= found.endSeq) return found;
  return null;
}

/** 扫描到 endSeq 为止，取最近的 turn/start 与 step/start 数值（占位事件需要）。 */
export function latestTurnStep(events, endSeq) {
  let turn = 0;
  let step = 0;
  const limit = Math.min(endSeq, events.length - 1);
  for (let index = 0; index <= limit; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    const data = event.data;
    if (data === null || typeof data !== "object") continue;
    if (event.type === "turn/start" && typeof data.turn === "number") turn = data.turn;
    else if (event.type === "step/start" && typeof data.step === "number") step = data.step;
  }
  return { turn, step };
}

/** 当前 surface（模型真正看到的节点）列表：[{seq, index, event}]。 */
export function collectSurface(session, events) {
  const nodes = [];
  const surfaceNodes = session?.surface?.nodes;
  if (surfaceNodes === undefined || surfaceNodes === null) return nodes;
  const seqs = Array.from(surfaceNodes);
  for (let index = 0; index < seqs.length; index += 1) {
    const seq = seqs[index];
    const event = events[seq];
    if (event !== undefined) nodes.push({ seq, index, event });
  }
  return nodes;
}

// ────────────────────────────── 存档 ──────────────────────────────

/** 把一批 surface 节点转成存档条目（只收消息事件、过滤空/短文本）。 */
export function buildArchiveEntries(session, nodes, config) {
  const entries = [];
  for (const node of nodes) {
    if (!node || !node.event || !MESSAGE_EVENT_TYPES.has(node.event.type)) continue;
    let message;
    try {
      message = session.deriveEventMessage(node.event);
    } catch {
      message = null;
    }
    if (!message) continue;
    const role = typeof message.role === "string" ? message.role : node.event.type.split("/")[0];
    if (!config.includeRoles.includes(role)) continue;
    const text = textOf(message);
    if (text.length < config.minTextLength) continue;
    entries.push({ seq: node.seq, time: node.event.time, role, text: clip(text, config.maxEntryChars) });
  }
  return entries;
}

const ROLE_LABEL = { user: "用户", assistant: "助手", developer: "开发者", system: "系统", tool: "工具" };

/** 把存档条目渲染成文件内容。 */
export function renderArchive(entries, config) {
  if (entries.length === 0) return "";
  const tz = config.timeZone;
  if (config.format === "jsonl") {
    return entries
      .map((entry) => JSON.stringify({ time: formatTime(entry.time, tz), role: entry.role, text: entry.text }))
      .join("\n") + "\n";
  }
  if (config.format === "txt") {
    return entries
      .map((entry) => `[${formatTime(entry.time, tz)}] ${ROLE_LABEL[entry.role] ?? entry.role}: ${entry.text}`)
      .join("\n\n") + "\n";
  }
  // md（默认）
  return entries
    .map((entry) => `## ${formatTime(entry.time, tz)} [${ROLE_LABEL[entry.role] ?? entry.role}]\n${entry.text}`)
    .join("\n\n") + "\n";
}

/** 每次存档写入的批次头（md 用），方便看出这是哪次、哪个会话的批次。 */
export function archiveHeader(timestamp, session, config, entryCount = 0) {
  const count = entryCount > 0 ? ` · ${entryCount} 条` : "";
  return `---\n# 上下文存档 · ${formatTime(timestamp, config.timeZone)} · 会话 ${sessionShortId(session?.id)}${count}\n\n`;
}

/** 追加进文件前要写的文本（md 带批次头；新文件带 UTF-8 BOM 方便记事本打开）。 */
export function composeArchiveAppendBody(entries, session, timestamp, exists, config) {
  const body = renderArchive(entries, config);
  if (!body) return "";
  const bom = exists ? "" : "\uFEFF";
  if (config.format === "md") {
    return bom + (exists ? "\n" : "") + archiveHeader(timestamp, session, config, entries.length) + body;
  }
  return bom + body;
}

// ────────────────────────────── 释放（surface replace） ──────────────────────────────

/**
 * 构造 surface replace 候选事件（复刻 dsh-session 的合法形状）：
 * - 空 content 的 developer/message 不产生模型消息、聊天记录不渲染卡片；
 * - surfaceOp replace 让 [startSeq, endSeq] 这段 surface 节点从 deriveMessages 消失；
 * - 日志与原文不动。
 */
export function buildReplacementEvent(session, plan) {
  return {
    type: "developer/message",
    seq: session.seq,
    time: Date.now(),
    data: {
      turn: plan.turn,
      step: plan.step,
      message: {
        id: `context-drawer-${session.seq}-${plan.startSeq}-${plan.endSeq}`,
        role: "developer",
        content: [],
        source: { kind: "context-drawer" },
      },
    },
    surfaceOp: { op: "replace", startSeq: plan.startSeq, endSeq: plan.endSeq },
    sourceEventSeqs: plan.seqs,
  };
}

/**
 * 生成释放计划：按时间顺序取最旧的若干已结束轮次（跳过最近 keepRecentTurns 轮），
 * 每轮去掉系统提示节点，返回可直接 append 的 runs。
 * options.currentTokens / options.targetTokens：给了就按 token 目标贪心取；否则按 releaseMaxTurns 上限取。
 */
export function buildReleasePlan(session, events, config, options = {}) {
  const { turns } = collectTurns(events);
  const closedTurns = turns.filter((turn) => turn.closed === true);
  const activeTurn = turns.length > 0 && turns[turns.length - 1].closed === false;
  const sorted = [...closedTurns].sort((a, b) => a.startSeq - b.startSeq);
  const keep = Math.max(0, Number(options.keepRecentTurns ?? config.keepRecentTurns) || 0);
  const maxTurns = Math.max(1, Number(options.releaseMaxTurns ?? config.releaseMaxTurns) || 1);
  const releasable = sorted.slice(0, Math.max(0, sorted.length - keep));

  const surfaceNodes = collectSurface(session, events);
  const turnNodes = new Map();
  for (const turn of closedTurns) turnNodes.set(turn.turn, []);
  for (const node of surfaceNodes) {
    const turn = findTurn(closedTurns, node.seq);
    if (turn !== null) turnNodes.get(turn.turn).push(node);
  }

  const currentTokens = Number(options.currentTokens);
  const targetTokens = Number(options.targetTokens);
  const hasTarget = Number.isFinite(currentTokens) && Number.isFinite(targetTokens);
  const needed = hasTarget ? Math.max(0, currentTokens - targetTokens) : Infinity;

  const position = latestTurnStep(events, events.length - 1);
  const runs = [];
  let totalTokens = 0;
  for (const turn of releasable) {
    if (runs.length >= maxTurns) break;
    if (hasTarget && runs.length > 0 && totalTokens >= needed) break;
    const nodes = turnNodes.get(turn.turn) ?? [];
    const removable = nodes.filter((node) => !(node.index === 0 && node.event.type === "system/message"));
    if (removable.length === 0) continue;
    let chars = 0;
    for (const node of removable) {
      const message = session.deriveEventMessage(node.event);
      chars += textOf(message).length;
    }
    const approxTokens = Math.ceil(chars / config.charsPerToken);
    runs.push({
      turn: position.turn,
      step: position.step,
      turns: [turn.turn],
      seqs: removable.map((node) => node.seq),
      startSeq: removable[0].seq,
      endSeq: removable[removable.length - 1].seq,
      nodeCount: removable.length,
      approxTokens,
      date: localDate(turn.startTime, config.timeZone),
    });
    totalTokens += approxTokens;
  }
  return {
    runs,
    activeTurn,
    closedTurns: sorted.length,
    totalTurns: runs.length,
    totalNodes: runs.reduce((acc, run) => acc + run.nodeCount, 0),
    approxTokens: totalTokens,
    needed: hasTarget ? needed : null,
    targetTokens: hasTarget ? targetTokens : null,
  };
}

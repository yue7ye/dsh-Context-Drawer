/**
 * 上下文编辑器：把会话日志按本地日期分组，并生成「从模型上下文中删除某几天」的
 * surface replace 计划。
 *
 * 设计前提（已核对 dsh-session 源码）：
 * - 会话日志 append-only，本插件不删除任何事件；
 * - 通过 session.append('developer/message', 空内容, { surfaceOp: { op:'replace', startSeq, endSeq }, sourceEventSeqs })
 *   让被选中的 surface 节点从 deriveMessages() 里消失，聊天记录和磁盘日志保持原样；
 * - 空内容 developer/message 不会产生模型消息，也不会在聊天记录里渲染卡片；
 * - surface 的第 0 个节点（系统提示）永远不删。
 *
 * 本模块不 import 任何 Harness 包，只依赖传进来的 session 对象，便于离线测试。
 */

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

/** 把毫秒时间戳格式化成指定时区里的 YYYY-MM-DD。 */
export function localDate(timestamp, timeZone = DEFAULT_TIME_ZONE) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(timestamp));
    const value = (type) => {
      const part = parts.find((item) => item.type === type);
      return part === undefined ? '' : part.value;
    };
    const year = value('year');
    const month = value('month');
    const day = value('day');
    if (year === '' || month === '' || day === '') return null;
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

/** 从模型消息里提取可读文本（用于预览与粗略 token 估算）。 */
export function messageText(message) {
  if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return '';
  const parts = [];
  for (const block of message.content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'image') parts.push('[图片]');
    else if (block.type === 'file' || block.type === 'document') parts.push('[文件]');
  }
  return parts.join(' ').replace(/\s+/gu, ' ').trim();
}

/** 粗略 token 估算：中文约 1 字 0.6 token、英文约 4 字符 1 token，取中间值。 */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 1.6));
}

function clip(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * 从事件序列里切出 turn 区间。
 * 只有被 turn/end 正常收尾的 turn 才标记 closed:true（可删）；未收尾的 turn 是当前
 * 正在进行的对话，绝不会出现在可删列表里。
 */
export function collectTurns(events) {
  const turns = [];
  let open = null;
  for (const event of events) {
    if (event.type === 'turn/start') {
      if (open !== null) {
        open.endSeq = event.seq - 1;
        turns.push(open);
      }
      const rawTurn = event.data !== null && typeof event.data === 'object' ? event.data.turn : undefined;
      open = {
        turn: typeof rawTurn === 'number' ? rawTurn : turns.length + 1,
        startSeq: event.seq,
        endSeq: null,
        startTime: event.time,
        closed: false,
      };
    } else if (event.type === 'turn/end' && open !== null) {
      open.endSeq = event.seq;
      open.closed = true;
      turns.push(open);
      open = null;
    }
  }
  if (open !== null) turns.push(open);
  return { turns, activeTurn: open !== null };
}

/** 在按 startSeq 升序排列的 closed turns 里找 seq 所属的 turn。 */
function findTurn(turns, seq) {
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

/** 扫描到 endSeq 为止，取最近的 step/start 与 turn/start 数值，供占位事件使用。 */
function latestTurnStep(events, endSeq) {
  let turn = 0;
  let step = 0;
  const limit = Math.min(endSeq, events.length - 1);
  for (let index = 0; index <= limit; index += 1) {
    const event = events[index];
    const data = event.data;
    if (data === null || typeof data !== 'object') continue;
    if (event.type === 'turn/start' && typeof data.turn === 'number') turn = data.turn;
    else if (event.type === 'step/start' && typeof data.step === 'number') step = data.step;
  }
  return { turn, step };
}

function analyze(session, options = {}) {
  const timeZone = typeof options.timeZone === 'string' && options.timeZone.length > 0 ? options.timeZone : DEFAULT_TIME_ZONE;
  const events = session.snapshotEvents();
  const { turns, activeTurn } = collectTurns(events);
  const closedTurns = turns.filter((turn) => turn.closed === true);
  const nodes = [];
  const surfaceNodes = Array.from(session.surface.nodes);
  for (let index = 0; index < surfaceNodes.length; index += 1) {
    const seq = surfaceNodes[index];
    const event = events[seq];
    if (event !== undefined) nodes.push({ seq, index, event });
  }
  const groups = new Map();
  for (const turn of closedTurns) {
    const date = localDate(turn.startTime, timeZone);
    if (date === null) continue;
    let group = groups.get(date);
    if (group === undefined) {
      group = { date, turns: [], nodes: [] };
      groups.set(date, group);
    }
    group.turns.push(turn);
  }
  for (const node of nodes) {
    const turn = findTurn(closedTurns, node.seq);
    if (turn === null) continue;
    const date = localDate(turn.startTime, timeZone);
    if (date === null) continue;
    const group = groups.get(date);
    if (group !== undefined) group.nodes.push(node);
  }
  return { timeZone, events, turns, closedTurns, activeTurn, nodes, groups };
}

function describeGroup(session, group) {
  const messages = [];
  let chars = 0;
  for (const node of group.nodes) {
    const message = session.deriveEventMessage(node.event);
    if (!message) continue;
    const text = messageText(message);
    if (text.length === 0) continue;
    messages.push({ role: message.role, text });
    chars += text.length;
  }
  const previews = [];
  for (const entry of messages) {
    if (entry.role === 'user') {
      previews.push({ role: 'user', text: clip(entry.text, 80) });
      if (previews.length >= 2) break;
    }
  }
  if (previews.length === 0) {
    const assistant = messages.find((entry) => entry.role === 'assistant');
    if (assistant !== undefined) previews.push({ role: 'assistant', text: clip(assistant.text, 80) });
  }
  const deletable = group.nodes.some((node) => !(node.index === 0 && node.event.type === 'system/message'));
  let reason;
  if (!deletable) {
    reason = group.nodes.length === 0 ? '该日期的内容已不在上下文中' : '这一天只剩系统提示，不需要删除';
  }
  return {
    date: group.date,
    turnCount: group.turns.length,
    nodeCount: group.nodes.length,
    approxTokens: Math.ceil(chars / 1.6),
    previews,
    deletable,
    reason,
  };
}

/** 生成给客户端看的日期报告。 */
export function buildDateReport(session, options = {}) {
  const state = analyze(session, options);
  const dates = [];
  for (const group of state.groups.values()) {
    dates.push(describeGroup(session, group));
  }
  dates.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0));
  return {
    sessionId: String(session.id),
    timeZone: state.timeZone,
    activeTurn: state.activeTurn,
    dates,
  };
}

/**
 * 生成删除计划：每个 plan 是一段在当前 surface 上连续、可一次性 replace 的节点区间。
 * 同一日期里若中间夹着不能删的节点（例如系统提示），会拆成多段。
 */
export function buildDeletePlan(session, dates, options = {}) {
  const state = analyze(session, options);
  const wanted = Array.isArray(dates) ? dates.filter((date) => typeof date === 'string') : [];
  const runs = [];
  const skipped = [];
  const seen = new Set();
  const selectedTurns = new Set();
  for (const date of wanted) {
    if (seen.has(date)) continue;
    seen.add(date);
    const group = state.groups.get(date);
    if (group === undefined || group.nodes.length === 0) {
      skipped.push({ date, reason: '该日期的内容已不在上下文中' });
      continue;
    }
    const candidates = group.nodes.filter((node) => !(node.index === 0 && node.event.type === 'system/message'));
    if (candidates.length === 0) {
      skipped.push({ date, reason: '这一天只剩系统提示，不需要删除' });
      continue;
    }
    for (const turn of group.turns) selectedTurns.add(turn.turn);
    let current = null;
    for (const node of candidates) {
      if (current !== null && node.index === current.lastIndex + 1) {
        current.nodes.push(node);
        current.lastIndex = node.index;
      } else {
        current = { date, nodes: [node], lastIndex: node.index };
        runs.push(current);
      }
    }
  }
  const plans = [];
  // 占位事件是“现在”追加到日志末尾的，turn/step 取日志末尾的最新值，避免时间线错位。
  const position = latestTurnStep(state.events, state.events.length - 1);
  for (const run of runs) {
    const seqs = run.nodes.map((node) => node.seq);
    const startSeq = seqs[0];
    const endSeq = seqs[seqs.length - 1];
    let chars = 0;
    for (const node of run.nodes) {
      chars += messageText(session.deriveEventMessage(node.event)).length;
    }
    plans.push({
      date: run.date,
      seqs,
      startSeq,
      endSeq,
      nodeCount: seqs.length,
      approxTokens: Math.ceil(chars / 1.6),
      turn: position.turn,
      step: position.step,
    });
  }
  const totals = plans.reduce(
    (acc, plan) => ({
      nodes: acc.nodes + plan.nodeCount,
      approxTokens: acc.approxTokens + plan.approxTokens,
    }),
    { nodes: 0, approxTokens: 0 },
  );
  return {
    timeZone: state.timeZone,
    runs: plans,
    skipped,
    totalTurns: selectedTurns.size,
    totalNodes: totals.nodes,
    totalTokens: totals.approxTokens,
  };
}

/**
 * 给一段 plan 构造 surface replace 候选事件；index.js 会先用它做 dry-run 校验，
 * 再用同样的数据真正 session.append。
 *
 * 占位消息必须是“可恢复”的完整消息：DSH 重启恢复会话时（Session.fromRestore 的
 * assertMessageEventShape）要求 message.id 非空、role 与事件类型一致、source.kind 非空、
 * content 为数组。空 content 仍会让 deriveEventMessage 返回 null、聊天记录不渲染卡片。
 */
export function buildReplacementEvent(session, plan) {
  return {
    type: 'developer/message',
    seq: session.seq,
    time: Date.now(),
    data: {
      turn: plan.turn,
      step: plan.step,
      message: {
        id: `ctx-editor-${session.seq}-${plan.startSeq}-${plan.endSeq}`,
        role: 'developer',
        content: [],
        source: { kind: 'tool-registry' },
      },
    },
    surfaceOp: { op: 'replace', startSeq: plan.startSeq, endSeq: plan.endSeq },
    sourceEventSeqs: plan.seqs,
  };
}

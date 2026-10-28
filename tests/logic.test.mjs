import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDateReport,
  buildDeletePlan,
  buildDeletePlanByTurns,
  buildEntryReport,
  buildReplacementEvent,
  buildTurnDetail,
  collectTurns,
  estimateTokens,
  formatClock,
  localDate,
  messageParts,
  messageText,
} from '../logic.js';

/** 构造一个只实现 logic.js 用到的接口的假 session。 */
function makeSession(events, surface) {
  return {
    id: 'session-logic-test',
    seq: events.length,
    snapshotEvents: () => events,
    surface: { nodes: surface },
    deriveEventMessage(event) {
      if (event.type === 'user/message') return event.data;
      if (
        event.type === 'system/message'
        || event.type === 'developer/message'
        || event.type === 'assistant/message'
      ) {
        const message = event.data.message;
        return Array.isArray(message?.content) && message.content.length > 0 ? message : null;
      }
      if (event.type === 'tool/result') return event.data.message;
      return null;
    },
  };
}

function textMessage(role, text, id) {
  const base = {
    role,
    id,
    content: [{ type: 'text', text }],
    source: {
      kind: role === 'user' ? 'user' : role === 'system' ? 'system-prompt' : 'model',
      ...(role === 'assistant' ? { provider: 'deepseek', model: 'deepseek-flash' } : {}),
    },
  };
  return base;
}

const t = (iso) => Date.parse(iso);

const events = [
  { type: 'system/message', seq: 0, time: t('2026-10-26T22:30:00+08:00'), data: { message: textMessage('system', 'system prompt', 'sys') } },
  { type: 'turn/start', seq: 1, time: t('2026-10-26T23:00:00+08:00'), data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: t('2026-10-26T23:00:00+08:00'), data: { step: 1 } },
  { type: 'user/message', seq: 3, time: t('2026-10-26T23:00:01+08:00'), data: textMessage('user', '昨天的问题', 'u1') },
  { type: 'assistant/message', seq: 4, time: t('2026-10-26T23:00:02+08:00'), data: { turn: 1, step: 1, message: textMessage('assistant', '昨天的回答', 'a1'), stream: [] } },
  { type: 'turn/end', seq: 5, time: t('2026-10-26T23:01:00+08:00'), data: { turn: 1, reason: 'completed' } },
  { type: 'turn/start', seq: 6, time: t('2026-10-27T09:00:00+08:00'), data: { turn: 2 } },
  { type: 'step/start', seq: 7, time: t('2026-10-27T09:00:00+08:00'), data: { step: 1 } },
  { type: 'user/message', seq: 8, time: t('2026-10-27T09:00:01+08:00'), data: textMessage('user', '今天第一问', 'u2') },
  { type: 'assistant/message', seq: 9, time: t('2026-10-27T09:00:02+08:00'), data: { turn: 2, step: 1, message: textMessage('assistant', '今天第一答', 'a2'), stream: [] } },
  { type: 'turn/end', seq: 10, time: t('2026-10-27T09:01:00+08:00'), data: { turn: 2, reason: 'completed' } },
  { type: 'turn/start', seq: 11, time: t('2026-10-27T10:00:00+08:00'), data: { turn: 3 } },
  { type: 'step/start', seq: 12, time: t('2026-10-27T10:00:00+08:00'), data: { step: 2 } },
  { type: 'user/message', seq: 13, time: t('2026-10-27T10:00:01+08:00'), data: textMessage('user', '今天第二问', 'u3') },
  { type: 'assistant/message', seq: 14, time: t('2026-10-27T10:00:02+08:00'), data: { turn: 3, step: 2, message: textMessage('assistant', '今天第二答', 'a3'), stream: [] } },
  { type: 'turn/end', seq: 15, time: t('2026-10-27T10:01:00+08:00'), data: { turn: 3, reason: 'completed' } },
  { type: 'turn/start', seq: 16, time: t('2026-10-27T11:00:00+08:00'), data: { turn: 4 } },
  { type: 'step/start', seq: 17, time: t('2026-10-27T11:00:00+08:00'), data: { step: 3 } },
  { type: 'user/message', seq: 18, time: t('2026-10-27T11:00:01+08:00'), data: textMessage('user', '正在问', 'u4') },
];

const surface = [0, 3, 4, 8, 9, 13, 14, 18];
const session = makeSession(events, surface);

test('localDate 按本地日期格式化，坏时间返回 null', () => {
  assert.equal(localDate(t('2026-10-27T23:30:00+08:00')), '2026-10-27');
  assert.equal(localDate(t('2026-10-28T00:30:00+08:00')), '2026-10-28');
  // 跨时区：UTC 16:30 是上海 00:30 次日
  assert.equal(localDate(Date.parse('2026-10-27T16:30:00Z')), '2026-10-28');
  assert.equal(localDate(t('2026-10-27T23:30:00+08:00'), 'UTC'), '2026-10-27');
  assert.equal(localDate(undefined), null);
  assert.equal(localDate(Number.NaN), null);
});

test('messageText 只取文本块，图片/文件用占位符', () => {
  assert.equal(messageText({ content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] }), 'hello world');
  assert.equal(messageText({ content: [{ type: 'image' }] }), '[图片]');
  assert.equal(messageText({ content: [{ type: 'file' }] }), '[文件]');
  assert.equal(messageText(null), '');
  assert.equal(messageText({}), '');
});

test('estimateTokens 为空返回 0，短文本至少 1', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 3);
  assert.equal(estimateTokens('中'), 1);
});

test('collectTurns 只把 turn/end 收尾的轮次标为 closed', () => {
  const { turns, activeTurn } = collectTurns(events);
  assert.equal(activeTurn, true);
  assert.equal(turns.length, 4);
  assert.deepEqual(
    turns.map((turn) => ({ turn: turn.turn, closed: turn.closed, startSeq: turn.startSeq })),
    [
      { turn: 1, closed: true, startSeq: 1 },
      { turn: 2, closed: true, startSeq: 6 },
      { turn: 3, closed: true, startSeq: 11 },
      { turn: 4, closed: false, startSeq: 16 },
    ],
  );
});

test('buildDateReport 按日期倒序分组，只含已结束轮次', () => {
  const report = buildDateReport(session, {});
  assert.equal(report.sessionId, 'session-logic-test');
  assert.equal(report.activeTurn, true);
  assert.deepEqual(report.dates.map((date) => date.date), ['2026-10-27', '2026-10-26']);

  const today = report.dates[0];
  assert.equal(today.turnCount, 2);
  assert.equal(today.nodeCount, 4);
  assert.equal(today.deletable, true);
  assert.deepEqual(today.previews.map((preview) => preview.text), ['今天第一问', '今天第二问']);
  assert.ok(today.approxTokens > 0);

  const yesterday = report.dates[1];
  assert.equal(yesterday.turnCount, 1);
  assert.equal(yesterday.nodeCount, 2);
  assert.deepEqual(yesterday.previews.map((preview) => preview.text), ['昨天的问题']);
});

test('buildDeletePlan 把同一天连续的 surface 节点合成一段', () => {
  const plan = buildDeletePlan(session, ['2026-10-27'], {});
  assert.equal(plan.runs.length, 1);
  const run = plan.runs[0];
  assert.equal(run.date, '2026-10-27');
  assert.equal(run.startSeq, 8);
  assert.equal(run.endSeq, 14);
  assert.deepEqual(run.seqs, [8, 9, 13, 14]);
  assert.equal(run.nodeCount, 4);
  assert.equal(run.turn, 4);
  assert.equal(run.step, 3);
  assert.equal(plan.totalTurns, 2);
  assert.equal(plan.totalNodes, 4);
  assert.equal(plan.skipped.length, 0);
});

test('buildDeletePlan 多日期生成多段，系统提示节点永远排除', () => {
  const plan = buildDeletePlan(session, ['2026-10-26', '2026-10-27'], {});
  assert.equal(plan.runs.length, 2);
  assert.deepEqual(plan.runs[0].seqs, [3, 4]);
  assert.deepEqual(plan.runs[1].seqs, [8, 9, 13, 14]);
  assert.equal(plan.totalTurns, 3);
  assert.equal(plan.totalNodes, 6);
  for (const run of plan.runs) assert.ok(!run.seqs.includes(0));
});

test('buildDeletePlan 跳过不在上下文里的日期与重复日期', () => {
  const missing = buildDeletePlan(session, ['2026-10-25'], {});
  assert.equal(missing.runs.length, 0);
  assert.equal(missing.skipped.length, 1);
  assert.match(missing.skipped[0].reason, /不在上下文中/u);

  const duplicated = buildDeletePlan(session, ['2026-10-27', '2026-10-27'], {});
  assert.equal(duplicated.runs.length, 1);
  assert.equal(duplicated.totalNodes, 4);
});

test('buildDeletePlan 不生成空日期列表就不报错', () => {
  const plan = buildDeletePlan(session, [], {});
  assert.equal(plan.runs.length, 0);
  assert.equal(plan.totalTurns, 0);
  assert.equal(plan.totalTokens, 0);
});

test('formatClock 按本地时区输出 HH:mm:ss', () => {
  assert.equal(formatClock(t('2026-10-27T23:30:05+08:00')), '23:30:05');
  assert.equal(formatClock(t('2026-10-27T23:30:05+08:00'), 'UTC'), '15:30:05');
  assert.equal(formatClock(Number.NaN), '');
});

test('buildEntryReport 每条已结束轮次一条，带时间与预览', () => {
  const report = buildEntryReport(session, {});
  assert.equal(report.sessionId, 'session-logic-test');
  assert.equal(report.activeTurn, true);
  assert.deepEqual(report.entries.map((entry) => entry.turn), [1, 2, 3]);
  assert.deepEqual(report.entries.map((entry) => entry.date), ['2026-10-26', '2026-10-27', '2026-10-27']);
  assert.deepEqual(report.entries.map((entry) => entry.time), ['23:00:00', '09:00:00', '10:00:00']);
  for (const entry of report.entries) {
    assert.equal(entry.deletable, true);
    assert.equal(entry.nodeCount, 2);
    assert.ok(entry.approxTokens > 0);
    assert.equal(entry.previews[0].role, 'user');
  }
});

test('buildDeletePlanByTurns 只删选中的轮次', () => {
  const plan = buildDeletePlanByTurns(session, [2], {});
  assert.equal(plan.runs.length, 1);
  assert.deepEqual(plan.runs[0].seqs, [8, 9]);
  assert.equal(plan.runs[0].date, '2026-10-27');
  assert.equal(plan.totalTurns, 1);
  assert.equal(plan.totalNodes, 2);
  assert.equal(plan.skipped.length, 0);
});

test('buildDeletePlanByTurns 相邻轮次合并、跨日或隔开轮次拆段', () => {
  const adjacent = buildDeletePlanByTurns(session, [2, 3], {});
  assert.equal(adjacent.runs.length, 1);
  assert.deepEqual(adjacent.runs[0].seqs, [8, 9, 13, 14]);
  assert.equal(adjacent.totalTurns, 2);

  const separated = buildDeletePlanByTurns(session, [1, 3], {});
  assert.equal(separated.runs.length, 2);
  assert.deepEqual(separated.runs.map((run) => run.seqs), [[3, 4], [13, 14]]);
  assert.equal(separated.totalNodes, 4);
});

test('buildDeletePlanByTurns 跳过进行中/不存在/重复的轮次', () => {
  const active = buildDeletePlanByTurns(session, [4], {});
  assert.equal(active.runs.length, 0);
  assert.equal(active.skipped.length, 1);

  const missing = buildDeletePlanByTurns(session, [99], {});
  assert.equal(missing.runs.length, 0);
  assert.equal(missing.skipped.length, 1);

  const duplicated = buildDeletePlanByTurns(session, [2, 2], {});
  assert.equal(duplicated.totalTurns, 1);
  assert.equal(duplicated.totalNodes, 2);
});

test('buildReplacementEvent 生成可恢复、可替换的占位事件', () => {
  const plan = buildDeletePlan(session, ['2026-10-27'], {});
  const candidate = buildReplacementEvent(session, plan.runs[0]);
  assert.equal(candidate.type, 'developer/message');
  assert.equal(candidate.seq, 19);
  assert.deepEqual(candidate.surfaceOp, { op: 'replace', startSeq: 8, endSeq: 14 });
  assert.deepEqual(candidate.sourceEventSeqs, [8, 9, 13, 14]);
  assert.deepEqual(candidate.data, {
    turn: 4,
    step: 3,
    message: {
      id: 'ctx-editor-19-8-14',
      role: 'developer',
      content: [],
      source: { kind: 'tool-registry' },
    },
  });
  // 重启恢复要求：id 非空、source.kind 非空、content 是数组
  assert.ok(candidate.data.message.id.length > 0);
  assert.ok(candidate.data.message.source.kind.length > 0);
  assert.ok(Array.isArray(candidate.data.message.content));
});

test('messageParts 拆出文本、思考与工具调用', () => {
  const parts = messageParts({
    content: [
      { type: 'text', text: '好的' },
      { type: 'reasoning', text: '先想一下' },
      { type: 'thinking', thinking: '再想一下' },
      { type: 'tool-call', callId: 'c1', name: 'search', arguments: { q: '天气' } },
      { type: 'tool-call', toolCallId: 'c2', toolName: 'read', input: { path: 'a.txt' } },
    ],
  });
  assert.equal(parts.text, '好的');
  assert.equal(parts.reasoning, '先想一下\n再想一下');
  assert.equal(parts.toolCalls.length, 2);
  assert.deepEqual(parts.toolCalls[0], { callId: 'c1', name: 'search', arguments: { q: '天气' } });
  assert.deepEqual(parts.toolCalls[1], { callId: 'c2', name: 'read', arguments: { path: 'a.txt' } });
  assert.deepEqual(messageParts(null), { text: '', reasoning: '', toolCalls: [] });
  assert.deepEqual(messageParts({ content: [] }), { text: '', reasoning: '', toolCalls: [] });
});

test('buildTurnDetail 列出整轮明细并标记被移出的条目', () => {
  const toolEvents = [
    { type: 'system/message', seq: 0, time: t('2026-10-27T12:00:00+08:00'), data: { message: textMessage('system', 'system prompt', 'sys') } },
    { type: 'turn/start', seq: 1, time: t('2026-10-27T12:00:00+08:00'), data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: t('2026-10-27T12:00:01+08:00'), data: textMessage('user', '帮我查一下天气', 'u1') },
    {
      type: 'assistant/message',
      seq: 3,
      time: t('2026-10-27T12:00:02+08:00'),
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'a1',
          role: 'assistant',
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-flash' },
          content: [
            { type: 'reasoning', text: '我需要调用搜索工具' },
            { type: 'text', text: '我查一下' },
            { type: 'tool-call', callId: 'c1', name: 'search', arguments: { q: '天气' } },
          ],
        },
        stream: [],
      },
    },
    {
      type: 'tool/result',
      seq: 4,
      time: t('2026-10-27T12:00:03+08:00'),
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'tr1',
          role: 'tool',
          source: { kind: 'tool', callId: 'c1' },
          toolCallId: 'c1',
          content: [{ type: 'text', text: '晴，25 度' }],
        },
      },
    },
    { type: 'turn/end', seq: 5, time: t('2026-10-27T12:00:09+08:00'), data: { turn: 1, reason: 'completed' } },
  ];
  const toolSession = makeSession(toolEvents, [0, 2, 3]);

  const detail = buildTurnDetail(toolSession, 1, {});
  assert.equal(detail.found, true);
  assert.equal(detail.turn, 1);
  assert.equal(detail.date, '2026-10-27');
  assert.equal(detail.active, false);
  assert.equal(detail.itemCount, 3);
  assert.deepEqual(detail.items.map((item) => item.kind), ['user', 'assistant', 'tool-result']);
  assert.deepEqual(detail.items.map((item) => item.removed), [false, false, true]);
  assert.equal(detail.items[0].text, '帮我查一下天气');
  assert.equal(detail.items[1].text, '我查一下');
  assert.equal(detail.items[1].reasoning, '我需要调用搜索工具');
  assert.equal(detail.items[1].toolCalls.length, 1);
  assert.equal(detail.items[1].toolCalls[0].name, 'search');
  assert.equal(detail.items[2].text, '晴，25 度');
  for (const item of detail.items) {
    assert.match(item.timeLabel, /^\d{2}:\d{2}:\d{2}$/u);
    assert.ok(item.approxTokens >= 0);
  }
  assert.ok(detail.approxTokens > 0);

  assert.equal(buildTurnDetail(toolSession, 99, {}).found, false);
  assert.equal(buildTurnDetail(toolSession, 1.5, {}).found, false);

  const activeDetail = buildTurnDetail(session, 4, {});
  assert.equal(activeDetail.found, true);
  assert.equal(activeDetail.active, true);
  assert.equal(activeDetail.items.length, 1);
});

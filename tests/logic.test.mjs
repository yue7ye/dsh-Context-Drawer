import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDateReport,
  buildDeletePlan,
  buildReplacementEvent,
  collectTurns,
  estimateTokens,
  localDate,
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

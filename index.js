/**
 * DSH 上下文编辑插件（Host 端）。
 *
 * 能力：把当前打开着的会话按 Asia/Shanghai 本地日期分组，列出每天可删除的
 * 模型可见内容；用户勾选后，向会话日志追加 surface replace 占位事件，
 * 让这些内容从模型上下文中消失。会话日志本身不删、聊天记录显示不变。
 *
 * 路由（由 DSH webServer 提供，同源）：
 *   GET  /context-date-pruner/sessions             列出当前 live 会话
 *   GET  /context-date-pruner/entries?sessionId=  按轮次列出可删除的上下文（带时间）
 *   GET  /context-date-pruner/dates?sessionId=    按日期分组（旧版兼容）
 *   POST /context-date-pruner/delete               { sessionId, turns | dates, dryRun? }
 */
import {
  buildDateReport,
  buildDeletePlan,
  buildDeletePlanByTurns,
  buildEntryReport,
  buildReplacementEvent,
  buildTurnDetail,
  DEFAULT_TIME_ZONE,
} from './logic.js';

export const inject = ['webServer', 'sessions'];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_TURNS = 5000;

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJsonBody(req, limit = 262144) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function resolveSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return { error: '缺少 sessionId' };
  }
  const session = ctx.sessions.get(sessionId);
  if (session === undefined) {
    return { error: '这个会话当前不在运行中；只有打开着的会话才能按日期编辑上下文' };
  }
  return { session };
}

export function apply(ctx, config) {
  const timeZone = typeof config?.timeZone === 'string' && config.timeZone.length > 0
    ? config.timeZone
    : DEFAULT_TIME_ZONE;
  const register = (path, handler) => {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `context-date-pruner: ${path}`);
  };

  register('/context-date-pruner/sessions', async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: '只支持 GET' });
      return;
    }
    const sessions = ctx.sessions.list().map((session) => {
      const report = buildDateReport(session, { timeZone });
      const deletableNodes = report.dates.reduce(
        (acc, item) => acc + (item.deletable ? item.nodeCount : 0),
        0,
      );
      return {
        sessionId: String(session.id),
        events: session.seq,
        activeTurn: report.activeTurn,
        dates: report.dates.length,
        deletableNodes,
      };
    });
    sendJson(res, 200, { ok: true, sessions });
  });

  register('/context-date-pruner/dates', async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: '只支持 GET' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const found = resolveSession(ctx, url.searchParams.get('sessionId'));
    if (found.error !== undefined) {
      sendJson(res, 404, { error: found.error });
      return;
    }
    try {
      sendJson(res, 200, { ok: true, ...buildDateReport(found.session, { timeZone }) });
    } catch (error) {
      sendJson(res, 500, { error: `读取会话失败：${errorText(error)}` });
    }
  });

  register('/context-date-pruner/entries', async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: '只支持 GET' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const found = resolveSession(ctx, url.searchParams.get('sessionId'));
    if (found.error !== undefined) {
      sendJson(res, 404, { error: found.error });
      return;
    }
    try {
      sendJson(res, 200, { ok: true, ...buildEntryReport(found.session, { timeZone }) });
    } catch (error) {
      sendJson(res, 500, { error: `读取会话失败：${errorText(error)}` });
    }
  });

  register('/context-date-pruner/detail', async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: '只支持 GET' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const found = resolveSession(ctx, url.searchParams.get('sessionId'));
    if (found.error !== undefined) {
      sendJson(res, 404, { error: found.error });
      return;
    }
    const turn = Number(url.searchParams.get('turn'));
    if (!Number.isInteger(turn) || turn <= 0 || turn > MAX_TURNS) {
      sendJson(res, 400, { error: 'turn 必须是正整数' });
      return;
    }
    try {
      sendJson(res, 200, { ok: true, ...buildTurnDetail(found.session, turn, { timeZone }) });
    } catch (error) {
      sendJson(res, 500, { error: `读取会话失败：${errorText(error)}` });
    }
  });

  register('/context-date-pruner/delete', async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: '只支持 POST' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: errorText(error) });
      return;
    }
    const found = resolveSession(ctx, body?.sessionId);
    if (found.error !== undefined) {
      sendJson(res, 404, { error: found.error });
      return;
    }
    const turns = Array.isArray(body?.turns)
      ? [...new Set(body.turns.filter((turn) => Number.isInteger(turn) && turn > 0 && turn <= MAX_TURNS))]
      : [];
    const dates = Array.isArray(body?.dates)
      ? body.dates.filter((date) => typeof date === 'string' && DATE_PATTERN.test(date))
      : [];
    if (turns.length === 0 && dates.length === 0) {
      sendJson(res, 400, { error: '请至少选择一条要删除的上下文' });
      return;
    }
    const session = found.session;
    let plan;
    try {
      plan = turns.length > 0
        ? buildDeletePlanByTurns(session, turns, { timeZone })
        : buildDeletePlan(session, dates, { timeZone });
    } catch (error) {
      sendJson(res, 500, { error: `分析会话失败：${errorText(error)}` });
      return;
    }
    if (plan.runs.length === 0) {
      sendJson(res, 200, {
        ok: true,
        dryRun: body?.dryRun === true,
        deletedTurns: 0,
        deletedNodes: 0,
        approxTokens: 0,
        skipped: plan.skipped,
      });
      return;
    }
    // 先用 validateNext 做一遍不落盘的预校验；任何一段不合法都不会写日志。
    try {
      for (const run of plan.runs) {
        session.surfaceManager.validateNext(buildReplacementEvent(session, run));
      }
    } catch (error) {
      sendJson(res, 400, { error: `安全检查未通过：${errorText(error)}` });
      return;
    }
    const summary = {
      deletedTurns: plan.totalTurns,
      deletedNodes: plan.totalNodes,
      approxTokens: plan.totalTokens,
      dates: [...new Set(plan.runs.map((run) => run.date))],
      skipped: plan.skipped,
    };
    if (body?.dryRun === true) {
      sendJson(res, 200, {
        ok: true,
        dryRun: true,
        ...summary,
        runs: plan.runs.map((run) => ({
          date: run.date,
          startSeq: run.startSeq,
          endSeq: run.endSeq,
          nodeCount: run.nodeCount,
        })),
      });
      return;
    }
    try {
      for (const run of plan.runs) {
        const candidate = buildReplacementEvent(session, run);
        session.append('developer/message', candidate.data, {
          surfaceOp: candidate.surfaceOp,
          sourceEventSeqs: candidate.sourceEventSeqs,
        });
      }
      await ctx.sessions.flush(session);
    } catch (error) {
      sendJson(res, 500, {
        error: `写入失败（可能已部分生效，可先用 dryRun 排查）：${errorText(error)}`,
      });
      return;
    }
    sendJson(res, 200, { ok: true, ...summary });
  });

}

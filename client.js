window.__ModuleLoader__.load({
  id: 'dsh-context-date-pruner',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'context-date-pruner';

    const zh = {
      button: '上下文编辑',
      buttonHint: '按时间段挑出要删除的对话轮次（聊天记录与日志保留）',
      title: '上下文编辑',
      subtitle: '按时间段筛选，勾选要删除的轮次（一天里的某一条对话）。只把这些内容移出模型上下文；聊天记录和磁盘日志保持不变。',
      close: '关闭',
      loading: '正在读取…',
      error: '读取失败',
      empty: '没有可删除的内容。',
      filterEmpty: '这个时间段里没有可删除的内容。',
      activeNote: '当前这一轮对话不会被删除',
      from: '从',
      to: '到',
      allTime: '全部时间',
      today: '今天',
      last3: '近 3 天',
      last7: '近 7 天',
      entries: '条',
      nodes: '节点',
      tokens: '约 {tokens} token',
      selectAllVisible: '全选当前列表',
      selectDay: '全选本日',
      clear: '清空',
      selectedCount: '已选 {count} 条',
      dryRun: '先预演',
      delete: '删除选中',
      confirmDelete: '再点一次确认删除',
      confirmAgain: '删除不可撤销：再点一次“再点一次确认删除”。',
      deleting: '处理中…',
      confirmNote: '删除会向会话日志追加替换记录，不可撤销；聊天记录仍显示原内容。',
      dryDone: '预演通过（未写入）：{turns} 条 / {nodes} 个节点，约 {tokens} token',
      done: '已从模型上下文删除：{turns} 条 / {nodes} 个节点，约 {tokens} token',
      skipped: '跳过',
      unsupported: '这个会话当前不能编辑（它没有在运行中）。',
      detailShow: '展开聊天记录',
      detailHide: '收起聊天记录',
      detailLoading: '正在读取聊天记录…',
      detailFailed: '读取聊天记录失败',
      detailEmpty: '这一轮没有可显示的聊天记录。',
      detailActive: '这一轮正在进行中',
      itemUser: '用户',
      itemAssistant: '助手',
      itemToolResult: '工具结果',
      itemSystem: '系统注入',
      itemDeveloper: '开发者注入',
      itemError: '错误',
      itemRemoved: '已移出上下文',
      reasoningLabel: '思考过程',
      toolCallsLabel: '工具调用',
      expandText: '展开全部',
      collapseText: '收起',
      chars: '字',
      detailCount: '共 {count} 条',
    };
    const en = {
      button: 'Context editor',
      buttonHint: 'Pick the turns to remove by time range (chat history and log stay intact)',
      title: 'Context editor',
      subtitle: 'Filter by time range, then pick the turns to remove. Only the model context changes; chat history and the on-disk log stay as they are.',
      close: 'Close',
      loading: 'Loading…',
      error: 'Failed to load',
      empty: 'No removable content found.',
      filterEmpty: 'No removable content in this time range.',
      activeNote: 'The turn in progress cannot be removed',
      from: 'From',
      to: 'To',
      allTime: 'All time',
      today: 'Today',
      last3: 'Last 3 days',
      last7: 'Last 7 days',
      entries: 'turns',
      nodes: 'nodes',
      tokens: '~{tokens} tokens',
      selectAllVisible: 'Select all visible',
      selectDay: 'Select this day',
      clear: 'Clear',
      selectedCount: '{count} selected',
      dryRun: 'Dry run',
      delete: 'Delete selected',
      confirmDelete: 'Click again to confirm',
      confirmAgain: 'Deletion cannot be undone: click “Click again to confirm”.',
      deleting: 'Working…',
      confirmNote: 'Deleting appends a replacement record to the session log and cannot be undone; chat history still shows the originals.',
      dryDone: 'Dry run passed (nothing written): {turns} turns / {nodes} nodes, ~{tokens} tokens',
      done: 'Removed from model context: {turns} turns / {nodes} nodes, ~{tokens} tokens',
      skipped: 'Skipped',
      unsupported: 'This session cannot be edited right now (it is not live).',
      detailShow: 'Show chat log',
      detailHide: 'Hide chat log',
      detailLoading: 'Loading chat log…',
      detailFailed: 'Failed to load chat log',
      detailEmpty: 'No chat messages in this turn.',
      detailActive: 'This turn is still in progress',
      itemUser: 'User',
      itemAssistant: 'Assistant',
      itemToolResult: 'Tool result',
      itemSystem: 'System injection',
      itemDeveloper: 'Developer injection',
      itemError: 'Error',
      itemRemoved: 'Removed from context',
      reasoningLabel: 'Reasoning',
      toolCallsLabel: 'Tool calls',
      expandText: 'Show all',
      collapseText: 'Collapse',
      chars: 'chars',
      detailCount: '{count} messages',
    };

    const fallback = (key) => (Object.prototype.hasOwnProperty.call(zh, key) ? zh[key] : key);
    const translator = (t) => (typeof t === 'function' ? t : fallback);
    const fill = (template, values) => String(template).replace(/\{(\w+)\}/gu, (match, key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
    ));

    const store = { open: false, sessionId: null, listeners: new Set() };
    const notify = () => {
      for (const listener of [...store.listeners]) {
        try {
          listener();
        } catch {
          // 订阅者自身报错不影响其他人
        }
      }
    };
    const update = (patch) => {
      Object.assign(store, patch);
      notify();
    };
    const subscribe = (listener) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    };
    function useStore() {
      const [, force] = React.useState(0);
      React.useEffect(() => subscribe(() => force((value) => value + 1)), []);
      return store;
    }

    const colors = {
      text: 'var(--dsw-alias-label-primary, #ececec)',
      secondary: 'var(--dsw-alias-label-secondary, #a6a6a6)',
      tertiary: 'var(--dsw-alias-label-tertiary, #7c7c7c)',
      border: 'var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))',
      borderSoft: 'var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08))',
      panel: 'var(--dsw-alias-bg-module-platform, var(--dsw-specific-menu, #202020))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06))',
      accent: 'var(--dsw-alias-state-business-primary, #4d8dff)',
      danger: 'var(--dsw-alias-state-error-primary, #e05c5c)',
      radiusLg: 'var(--dsw-radius-lg, 16px)',
      radiusMd: 'var(--dsw-radius-md, 10px)',
      shadow: 'var(--dsw-elevation-panel, 0 18px 48px rgba(0, 0, 0, 0.45))',
    };

    const metaStyle = { color: colors.tertiary, fontSize: 12, lineHeight: 1.5 };
    const dateStyle = { color: colors.text, fontSize: 14, fontWeight: 600, letterSpacing: 0.2 };
    const previewStyle = {
      color: colors.secondary,
      fontSize: 12,
      lineHeight: 1.5,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: 400,
    };

    function primaryButton(disabled) {
      return {
        border: 'none',
        borderRadius: colors.radiusMd,
        padding: '7px 14px',
        fontSize: 13,
        fontWeight: 600,
        color: '#fff',
        background: colors.accent,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        boxShadow: 'var(--dsw-focus-ring-width, 0) var(--dsw-focus-ring-color, transparent)',
      };
    }
    function secondaryButton(disabled) {
      return {
        border: `1px solid ${colors.border}`,
        borderRadius: colors.radiusMd,
        padding: '7px 14px',
        fontSize: 13,
        color: colors.text,
        background: 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      };
    }
    function chipButton(active) {
      return {
        border: `1px solid ${active ? colors.accent : colors.borderSoft}`,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 12,
        color: active ? colors.text : colors.secondary,
        background: active ? colors.hover : 'transparent',
        cursor: 'pointer',
      };
    }
    function timeInputStyle() {
      return {
        border: `1px solid ${colors.borderSoft}`,
        borderRadius: colors.radiusMd,
        background: 'transparent',
        color: colors.text,
        fontSize: 12,
        padding: '4px 8px',
        colorScheme: 'dark',
      };
    }

    const DETAIL_KIND_LABELS = {
      user: 'itemUser',
      assistant: 'itemAssistant',
      'tool-result': 'itemToolResult',
      system: 'itemSystem',
      developer: 'itemDeveloper',
    };
    const DETAIL_KIND_COLORS = {
      user: 'var(--dsw-alias-state-business-primary, #4d8dff)',
      assistant: 'var(--dsw-alias-state-success-primary, #3fb950)',
      'tool-result': 'var(--dsw-alias-state-warning-primary, #d29922)',
    };
    const preStyle = {
      marginTop: 4,
      padding: '8px 10px',
      borderRadius: colors.radiusMd,
      background: colors.hover,
      color: colors.secondary,
      fontSize: 12,
      lineHeight: 1.55,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: 280,
      overflow: 'auto',
    };

    function DetailItem({ item, translate }) {
      const [openText, setOpenText] = React.useState(false);
      const [openReasoning, setOpenReasoning] = React.useState(false);
      const [openTools, setOpenTools] = React.useState(false);
      const [openSystem, setOpenSystem] = React.useState(false);
      const isSystem = item.kind === 'system' || item.kind === 'developer';
      const text = typeof item.text === 'string' ? item.text : '';
      const longText = text.length > 600;
      const shownText = longText && !openText ? `${text.slice(0, 600)}…` : text;
      const toggleChip = (onClick, label) => h(
        'button',
        {
          type: 'button',
          onClick,
          style: { ...chipButton(false), alignSelf: 'flex-start', padding: '1px 8px', fontSize: 11, border: 'none', background: 'transparent', color: colors.secondary },
        },
        label,
      );
      return h(
        'div',
        {
          style: {
            borderLeft: `3px solid ${DETAIL_KIND_COLORS[item.kind] ?? colors.border}`,
            padding: '4px 0 4px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            opacity: item.removed ? 0.62 : 1,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { color: colors.text, fontSize: 12, fontWeight: 600 } }, translate(DETAIL_KIND_LABELS[item.kind] ?? item.kind)),
          item.timeLabel ? h('span', { style: { ...metaStyle, fontSize: 11 } }, item.timeLabel) : null,
          item.isError ? h('span', { style: { color: colors.danger, fontSize: 11 } }, translate('itemError')) : null,
          item.removed ? h('span', { style: { color: colors.tertiary, fontSize: 11 } }, translate('itemRemoved')) : null,
          isSystem
            ? toggleChip(() => setOpenSystem((value) => !value), openSystem ? translate('collapseText') : translate('expandText'))
            : null,
        ),
        text.length === 0
          ? null
          : isSystem && !openSystem
            ? h('div', { style: { ...metaStyle, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, text.slice(0, 160))
            : h('div', { style: { color: colors.text, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, shownText),
        !isSystem && longText
          ? toggleChip(() => setOpenText((value) => !value), openText ? translate('collapseText') : translate('expandText'))
          : null,
        item.reasoning
          ? toggleChip(
            () => setOpenReasoning((value) => !value),
            `${translate('reasoningLabel')}（${item.reasoning.length} ${translate('chars')}）${openReasoning ? ' ▾' : ' ▸'}`,
          )
          : null,
        item.reasoning && openReasoning ? h('pre', { style: preStyle }, item.reasoning) : null,
        Array.isArray(item.toolCalls) && item.toolCalls.length > 0
          ? toggleChip(
            () => setOpenTools((value) => !value),
            `${translate('toolCallsLabel')}（${item.toolCalls.length}）${openTools ? ' ▾' : ' ▸'}`,
          )
          : null,
        Array.isArray(item.toolCalls) && item.toolCalls.length > 0 && openTools
          ? h('pre', { style: preStyle }, JSON.stringify(item.toolCalls, null, 2))
          : null,
      );
    }

    function TurnDetail({ detail, translate }) {
      if (detail.status === 'loading') {
        return h('div', { style: { ...metaStyle, padding: '8px 12px' } }, translate('detailLoading'));
      }
      if (detail.status === 'error') {
        return h('div', { style: { ...metaStyle, padding: '8px 12px', color: colors.danger } }, `${translate('detailFailed')}：${detail.error}`);
      }
      const data = detail.data ?? {};
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) {
        return h('div', { style: { ...metaStyle, padding: '8px 12px' } }, translate('detailEmpty'));
      }
      return h(
        'div',
        { style: { padding: '2px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px dashed ${colors.borderSoft}` } },
        h('div', { style: { ...metaStyle, paddingTop: 8 } }, fill(translate('detailCount'), { count: items.length })),
        items.map((item, index) => h(DetailItem, { key: index, item, translate })),
      );
    }

    async function requestJson(path, init) {
      const response = await fetch(path, { credentials: 'same-origin', ...init });
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok || (data !== null && typeof data === 'object' && data.error !== undefined)) {
        const message = data !== null && typeof data === 'object' && typeof data.error === 'string'
          ? data.error
          : `HTTP ${response.status}`;
        throw new Error(message);
      }
      return data;
    }

    function pad2(value) {
      return String(value).padStart(2, '0');
    }
    function toInputValue(timestamp) {
      const date = new Date(timestamp);
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }
    function parseInputValue(value) {
      if (typeof value !== 'string' || value.length === 0) return null;
      const parsed = new Date(value);
      const time = parsed.getTime();
      return Number.isFinite(time) ? time : null;
    }
    function startOfToday() {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }
    function daysAgo(days) {
      const date = new Date();
      date.setMinutes(0, 0, 0);
      return date.getTime() - days * 24 * 60 * 60 * 1000;
    }

    function Trigger({ sessionId, t }) {
      const translate = translator(t);
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
      return h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', padding: '2px 2px 0' } },
        h(
          'button',
          {
            type: 'button',
            title: translate('buttonHint'),
            onClick: () => update({ open: true, sessionId }),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 10px',
              borderRadius: 999,
              border: `1px solid ${colors.borderSoft}`,
              background: 'transparent',
              color: colors.secondary,
              fontSize: 12,
              cursor: 'pointer',
            },
          },
          h('span', { 'aria-hidden': true }, '⌫'),
          h('span', null, translate('button')),
        ),
      );
    }

    function EditorPanel({ t }) {
      const state = useStore();
      const translate = translator(t);
      const [data, setData] = React.useState({ status: 'idle', report: null, error: null });
      const [from, setFrom] = React.useState('');
      const [to, setTo] = React.useState('');
      const [selected, setSelected] = React.useState([]);
      const [expandedTurns, setExpandedTurns] = React.useState({});
      const [busy, setBusy] = React.useState(false);
      const [confirming, setConfirming] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const [reload, setReload] = React.useState(0);
      const open = state.open;
      const sessionId = state.sessionId;

      React.useEffect(() => {
        if (!open) return undefined;
        setSelected([]);
        setExpandedTurns({});
        setConfirming(false);
        setNotice(null);
        setFrom('');
        setTo('');
        const onKey = (event) => {
          if (event.key === 'Escape') update({ open: false, sessionId: null });
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open, sessionId]);

      React.useEffect(() => {
        if (!open || !sessionId) return undefined;
        let cancelled = false;
        setData({ status: 'loading', report: null, error: null });
        requestJson(`/context-date-pruner/entries?sessionId=${encodeURIComponent(sessionId)}`)
          .then((report) => {
            if (!cancelled) setData({ status: 'ready', report, error: null });
          })
          .catch((error) => {
            if (!cancelled) setData({ status: 'error', report: null, error: error.message });
          });
        return () => {
          cancelled = true;
        };
      }, [open, sessionId, reload]);

      if (!open || !sessionId) return null;

      const report = data.report;
      const entries = report !== null && Array.isArray(report.entries) ? report.entries : [];
      const fromMs = parseInputValue(from);
      const toMs = parseInputValue(to);
      const visible = entries.filter((entry) => {
        const startedAt = Number(entry.startedAt) || 0;
        if (fromMs !== null && startedAt < fromMs) return false;
        if (toMs !== null && startedAt > toMs) return false;
        return true;
      });
      const visibleDeletable = visible.filter((entry) => entry.deletable === true);
      const selectedSet = new Set(selected);
      const selectedEntries = entries.filter((entry) => selectedSet.has(entry.turn));
      const selectedNodes = selectedEntries.reduce((acc, entry) => acc + (Number(entry.nodeCount) || 0), 0);
      const selectedTokens = selectedEntries.reduce((acc, entry) => acc + (Number(entry.approxTokens) || 0), 0);
      const allVisibleSelected = visibleDeletable.length > 0
        && visibleDeletable.every((entry) => selectedSet.has(entry.turn));
      const canAct = !busy && selected.length > 0;

      const groups = [];
      const groupMap = new Map();
      for (const entry of visible) {
        const date = typeof entry.date === 'string' && entry.date.length > 0 ? entry.date : '未知日期';
        let group = groupMap.get(date);
        if (group === undefined) {
          group = { date, entries: [] };
          groupMap.set(date, group);
          groups.push(group);
        }
        group.entries.push(entry);
      }
      groups.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0));

      const toggle = (turn) => {
        setConfirming(false);
        setNotice(null);
        setSelected((current) => (
          current.includes(turn) ? current.filter((item) => item !== turn) : [...current, turn]
        ));
      };

      const toggleDay = (entriesOfDay) => {
        const turns = entriesOfDay.filter((entry) => entry.deletable === true).map((entry) => entry.turn);
        const allOn = turns.length > 0 && turns.every((turn) => selectedSet.has(turn));
        setConfirming(false);
        setNotice(null);
        setSelected((current) => {
          if (allOn) return current.filter((item) => !turns.includes(item));
          const next = new Set(current);
          for (const turn of turns) next.add(turn);
          return [...next];
        });
      };

      const toggleAllVisible = () => {
        const turns = visibleDeletable.map((entry) => entry.turn);
        setConfirming(false);
        setNotice(null);
        setSelected((current) => {
          if (allVisibleSelected) return current.filter((item) => !turns.includes(item));
          const next = new Set(current);
          for (const turn of turns) next.add(turn);
          return [...next];
        });
      };

      const applyChip = (kind) => {
        setConfirming(false);
        setNotice(null);
        if (kind === 'all') {
          setFrom('');
          setTo('');
          return;
        }
        const now = toInputValue(Date.now());
        setTo(now);
        if (kind === 'today') setFrom(toInputValue(startOfToday()));
        else if (kind === '3d') setFrom(toInputValue(daysAgo(3)));
        else if (kind === '7d') setFrom(toInputValue(daysAgo(7)));
      };

      const act = async (dryRun) => {
        if (!canAct) return;
        if (!dryRun && !confirming) {
          setConfirming(true);
          setNotice({ text: translate('confirmAgain'), error: false });
          return;
        }
        setBusy(true);
        setConfirming(false);
        setNotice(null);
        try {
          const result = await requestJson('/context-date-pruner/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, turns: selected, dryRun }),
          });
          const counts = {
            turns: Number(result !== null && result.deletedTurns) || 0,
            nodes: Number(result !== null && result.deletedNodes) || 0,
            tokens: Number(result !== null && result.approxTokens) || 0,
          };
          let text = fill(translate(dryRun ? 'dryDone' : 'done'), counts);
          const skipped = result !== null && Array.isArray(result.skipped) ? result.skipped : [];
          if (skipped.length > 0) {
            text += ` ${translate('skipped')}：${skipped.map((entry) => {
              const where = entry.turn !== undefined ? `第 ${entry.turn} 轮` : String(entry.date);
              return `${where}（${entry.reason}）`;
            }).join('；')}`;
          }
          setBusy(false);
          setNotice({ text, error: false });
          if (!dryRun) {
            setSelected([]);
            setReload((value) => value + 1);
          }
        } catch (error) {
          setBusy(false);
          setNotice({ text: `${translate('error')}：${error.message}`, error: true });
        }
      };

      const toggleDetail = async (turn) => {
        const existing = expandedTurns[turn];
        if (existing !== undefined && existing.status === 'ready') {
          setExpandedTurns((current) => {
            const next = { ...current };
            delete next[turn];
            return next;
          });
          return;
        }
        if (existing !== undefined && existing.status === 'loading') return;
        setExpandedTurns((current) => ({ ...current, [turn]: { status: 'loading' } }));
        try {
          const detail = await requestJson(`/context-date-pruner/detail?sessionId=${encodeURIComponent(sessionId)}&turn=${turn}`);
          setExpandedTurns((current) => ({ ...current, [turn]: { status: 'ready', data: detail } }));
        } catch (error) {
          setExpandedTurns((current) => ({ ...current, [turn]: { status: 'error', error: error.message } }));
        }
      };

      const blockFor = (entry) => {
        const checked = selectedSet.has(entry.turn);
        const disabled = entry.deletable !== true || busy;
        const detail = expandedTurns[entry.turn];
        const expanded = detail !== undefined;
        return h(
          'div',
          {
            key: `turn-${entry.turn}`,
            style: {
              borderRadius: colors.radiusMd,
              border: `1px solid ${checked ? colors.accent : colors.borderSoft}`,
              background: checked ? colors.hover : 'transparent',
              overflow: 'hidden',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px 8px 12px' } },
            h(
              'label',
              {
                style: {
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  minWidth: 0,
                  flex: 1,
                  cursor: disabled ? 'default' : 'pointer',
                  opacity: entry.deletable === true ? 1 : 0.55,
                },
              },
              h('input', {
                type: 'checkbox',
                checked,
                disabled,
                onChange: () => toggle(entry.turn),
                style: { marginTop: 3, width: 15, height: 15, accentColor: colors.accent, cursor: disabled ? 'default' : 'pointer' },
              }),
              h(
                'div',
                { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
                  h('span', { style: { color: colors.text, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' } }, entry.time || ''),
                  h('span', { style: metaStyle }, `${entry.endTime || ''}`),
                  h(
                    'span',
                    { style: metaStyle },
                    `· ${translate('nodes')} ${Number(entry.nodeCount) || 0} · ${fill(translate('tokens'), { tokens: Number(entry.approxTokens) || 0 })}`,
                  ),
                ),
                Array.isArray(entry.previews) && entry.previews.length > 0
                  ? h('div', { style: previewStyle }, entry.previews.map((item) => item.text).join(' / '))
                  : null,
                entry.deletable !== true && entry.reason !== undefined
                  ? h('div', { style: metaStyle }, String(entry.reason))
                  : null,
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: () => toggleDetail(entry.turn),
                style: {
                  ...secondaryButton(false),
                  padding: '3px 8px',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                },
              },
              expanded && detail.status === 'ready' ? translate('detailHide') : translate('detailShow'),
            ),
          ),
          expanded ? h(TurnDetail, { detail, translate }) : null,
        );
      };

      let body;
      if (data.status === 'loading') {
        body = h('div', { style: { padding: '20px 20px', ...metaStyle } }, translate('loading'));
      } else if (data.status === 'error') {
        body = h('div', { style: { padding: '20px 20px', ...metaStyle, color: colors.danger } }, `${translate('error')}：${data.error}`);
      } else if (entries.length === 0) {
        body = h('div', { style: { padding: '20px 20px', ...metaStyle } }, translate('empty'));
      } else if (visible.length === 0) {
        body = h('div', { style: { padding: '20px 20px', ...metaStyle } }, translate('filterEmpty'));
      } else {
        body = h(
          'div',
          { style: { padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: '50vh' } },
          groups.map((group) => h(
            'div',
            { key: group.date, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h('span', { style: dateStyle }, group.date),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || group.entries.every((entry) => entry.deletable !== true),
                  onClick: () => toggleDay(group.entries),
                  style: { ...chipButton(false), border: 'none', background: 'transparent', padding: '2px 6px' },
                },
                translate('selectDay'),
              ),
            ),
            group.entries.map(blockFor),
          )),
        );
      }

      const filterBar = h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '0 20px 10px',
            borderBottom: `1px solid ${colors.borderSoft}`,
            marginBottom: 10,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: metaStyle }, translate('from')),
          h('input', { type: 'datetime-local', value: from, onChange: (event) => setFrom(event.target.value), style: timeInputStyle() }),
          h('span', { style: metaStyle }, translate('to')),
          h('input', { type: 'datetime-local', value: to, onChange: (event) => setTo(event.target.value), style: timeInputStyle() }),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: () => applyChip('all'), style: chipButton(from === '' && to === '') }, translate('allTime')),
          h('button', { type: 'button', onClick: () => applyChip('today'), style: chipButton(false) }, translate('today')),
          h('button', { type: 'button', onClick: () => applyChip('3d'), style: chipButton(false) }, translate('last3')),
          h('button', { type: 'button', onClick: () => applyChip('7d'), style: chipButton(false) }, translate('last7')),
        ),
        h('div', { style: { flex: 1 } }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: metaStyle }, fill(translate('selectedCount'), { count: selected.length })),
          h(
            'button',
            {
              type: 'button',
              disabled: busy || visibleDeletable.length === 0,
              onClick: toggleAllVisible,
              style: { ...secondaryButton(busy || visibleDeletable.length === 0), padding: '4px 10px', fontSize: 12 },
            },
            allVisibleSelected ? translate('clear') : translate('selectAllVisible'),
          ),
        ),
      );

      const footer = h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 20px',
            borderTop: `1px solid ${colors.borderSoft}`,
            flexWrap: 'wrap',
          },
        },
        h(
          'div',
          { style: { ...metaStyle, maxWidth: 360 } },
          notice !== null
            ? h('span', { style: notice.error ? { color: colors.danger } : { color: colors.secondary } }, notice.text)
            : translate('confirmNote'),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          selected.length > 0
            ? h('span', { style: metaStyle }, `${selectedEntries.length ? selectedNodes : 0} ${translate('nodes')} · ${fill(translate('tokens'), { tokens: selectedTokens })}`)
            : null,
          h(
            'button',
            { type: 'button', disabled: !canAct, onClick: () => act(true), style: secondaryButton(!canAct) },
            translate('dryRun'),
          ),
          h(
            'button',
            { type: 'button', disabled: !canAct, onClick: () => act(false), style: primaryButton(!canAct) },
            busy ? translate('deleting') : confirming ? translate('confirmDelete') : translate('delete'),
          ),
        ),
      );

      return h(
        'div',
        {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': translate('title'),
          onClick: () => update({ open: false, sessionId: null }),
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 9000,
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'rgba(0, 0, 0, 0.42)',
            backdropFilter: 'var(--dsw-menu-backdrop-filter, blur(6px))',
          },
        },
        h(
          'div',
          {
            onClick: (event) => event.stopPropagation(),
            style: {
              width: 'min(680px, 100%)',
              maxHeight: '86vh',
              display: 'flex',
              flexDirection: 'column',
              background: colors.panel,
              color: colors.text,
              borderRadius: colors.radiusLg,
              border: `1px solid ${colors.border}`,
              boxShadow: colors.shadow,
              overflow: 'hidden',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 20px 10px' } },
            h(
              'div',
              null,
              h('div', { style: { fontSize: 16, fontWeight: 700, color: colors.text } }, translate('title')),
              h('div', { style: { ...metaStyle, marginTop: 4, maxWidth: 540 } }, translate('subtitle')),
              report !== null && report.activeTurn === true
                ? h('div', { style: { ...metaStyle, marginTop: 4 } }, translate('activeNote'))
                : null,
            ),
            h(
              'button',
              {
                type: 'button',
                'aria-label': translate('close'),
                onClick: () => update({ open: false, sessionId: null }),
                style: {
                  border: 'none',
                  background: 'transparent',
                  color: colors.tertiary,
                  fontSize: 16,
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: 8,
                },
              },
              '✕',
            ),
          ),
          filterBar,
          body,
          footer,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-date-pruner: locale');
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'context-date-pruner.trigger',
          order: 40,
          locale: NS,
        }, Trigger));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'context-date-pruner.panel',
          order: 60,
          locale: NS,
        }, EditorPanel));
      },
    };
  },
});

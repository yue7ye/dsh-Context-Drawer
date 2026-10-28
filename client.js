window.__ModuleLoader__.load({
  id: 'dsh-context-date-pruner',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'context-date-pruner';

    const zh = {
      button: '上下文编辑',
      buttonHint: '按日期把内容从模型上下文中删除（聊天记录与日志保留）',
      title: '上下文编辑',
      subtitle: '勾选要删除的日期。只把这些内容移出模型上下文；聊天记录和磁盘日志保持不变。',
      close: '关闭',
      loading: '正在读取…',
      error: '读取失败',
      empty: '没有可删除的日期内容。',
      turns: '轮',
      nodes: '节点',
      approx: '约 {tokens} token',
      selectAll: '全选可删除',
      clear: '清空选择',
      dryRun: '先预演',
      delete: '删除选中日期',
      confirmDelete: '再点一次确认删除',
      confirmAgain: '删除不可撤销：再点一次“再点一次确认删除”。',
      deleting: '处理中…',
      confirmNote: '删除会向会话日志追加替换记录，不可撤销；聊天记录仍显示原内容。',
      dryDone: '预演通过（未写入）：{turns} 轮 / {nodes} 个节点，约 {tokens} token',
      done: '已从模型上下文删除：{turns} 轮 / {nodes} 个节点，约 {tokens} token',
      skipped: '跳过',
      none: '没有需要删除的内容',
      unsupported: '这个会话当前不能编辑（它没有在运行中）。',
    };
    const en = {
      button: 'Context editor',
      buttonHint: 'Remove content from the model context by date (chat history and log stay intact)',
      title: 'Context editor',
      subtitle: 'Pick the dates to remove. Only the model context changes; chat history and the on-disk log stay as they are.',
      close: 'Close',
      loading: 'Loading…',
      error: 'Failed to load',
      empty: 'No removable content found.',
      turns: 'turns',
      nodes: 'nodes',
      approx: '~{tokens} tokens',
      selectAll: 'Select all removable',
      clear: 'Clear selection',
      dryRun: 'Dry run',
      delete: 'Delete selected dates',
      confirmDelete: 'Click again to confirm',
      confirmAgain: 'Deletion cannot be undone: click “Click again to confirm”.',
      deleting: 'Working…',
      confirmNote: 'Deleting appends a replacement record to the session log and cannot be undone; chat history still shows the originals.',
      dryDone: 'Dry run passed (nothing written): {turns} turns / {nodes} nodes, ~{tokens} tokens',
      done: 'Removed from model context: {turns} turns / {nodes} nodes, ~{tokens} tokens',
      skipped: 'Skipped',
      none: 'Nothing to delete',
      unsupported: 'This session cannot be edited right now (it is not live).',
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
      maxWidth: 420,
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
      const [selected, setSelected] = React.useState([]);
      const [busy, setBusy] = React.useState(false);
      const [confirming, setConfirming] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const [reload, setReload] = React.useState(0);
      const open = state.open;
      const sessionId = state.sessionId;

      React.useEffect(() => {
        if (!open) return undefined;
        setSelected([]);
        setConfirming(false);
        setNotice(null);
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
        requestJson(`/context-date-pruner/dates?sessionId=${encodeURIComponent(sessionId)}`)
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
      const dates = report !== null && Array.isArray(report.dates) ? report.dates : [];
      const selectedSet = new Set(selected);
      const removableDates = dates.filter((item) => item.deletable === true).map((item) => item.date);
      const allSelected = removableDates.length > 0 && removableDates.every((date) => selectedSet.has(date));
      const canAct = !busy && selected.length > 0;

      const toggle = (date) => {
        setConfirming(false);
        setNotice(null);
        setSelected((current) => (
          current.includes(date) ? current.filter((item) => item !== date) : [...current, date]
        ));
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
            body: JSON.stringify({ sessionId, dates: selected, dryRun }),
          });
          const counts = {
            turns: Number(result !== null && result.deletedTurns) || 0,
            nodes: Number(result !== null && result.deletedNodes) || 0,
            tokens: Number(result !== null && result.approxTokens) || 0,
          };
          let text = fill(translate(dryRun ? 'dryDone' : 'done'), counts);
          const skipped = result !== null && Array.isArray(result.skipped) ? result.skipped : [];
          if (skipped.length > 0) {
            text += ` ${translate('skipped')}：${skipped.map((item) => `${item.date}（${item.reason}）`).join('；')}`;
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

      const rowFor = (item) => {
        const checked = selectedSet.has(item.date);
        const disabled = item.deletable !== true || busy;
        return h(
          'label',
          {
            key: item.date,
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '9px 12px',
              borderRadius: colors.radiusMd,
              border: `1px solid ${checked ? colors.accent : colors.borderSoft}`,
              background: checked ? colors.hover : 'transparent',
              cursor: disabled ? 'default' : 'pointer',
              opacity: item.deletable === true ? 1 : 0.55,
            },
          },
          h('input', {
            type: 'checkbox',
            checked,
            disabled,
            onChange: () => toggle(item.date),
            style: { marginTop: 3, width: 15, height: 15, accentColor: colors.accent, cursor: disabled ? 'default' : 'pointer' },
          }),
          h(
            'div',
            { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
            h('div', { style: dateStyle }, item.date),
            h(
              'div',
              { style: metaStyle },
              `${translate('turns')} ${Number(item.turnCount) || 0} · ${translate('nodes')} ${Number(item.nodeCount) || 0} · ${fill(translate('approx'), { tokens: Number(item.approxTokens) || 0 })}`,
            ),
            Array.isArray(item.previews) && item.previews.length > 0
              ? h('div', { style: previewStyle }, item.previews.map((entry) => entry.text).join(' / '))
              : null,
            item.deletable !== true && item.reason !== undefined
              ? h('div', { style: metaStyle }, String(item.reason))
              : null,
          ),
        );
      };

      const controls = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 20px 8px', flexWrap: 'wrap' } },
        h('div', { style: metaStyle }, report !== null && report.activeTurn === true ? '当前这一轮对话不会被删除' : ''),
        h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(
            'button',
            {
              type: 'button',
              disabled: busy || removableDates.length === 0,
              onClick: () => setSelected(allSelected ? [] : removableDates),
              style: { ...secondaryButton(busy || removableDates.length === 0), padding: '4px 10px', fontSize: 12 },
            },
            allSelected ? translate('clear') : translate('selectAll'),
          ),
        ),
      );

      let body;
      if (data.status === 'loading') {
        body = h('div', { style: { padding: '20px 20px', ...metaStyle } }, translate('loading'));
      } else if (data.status === 'error') {
        body = h('div', { style: { padding: '20px 20px', ...metaStyle, color: colors.danger } }, `${translate('error')}：${data.error}`);
      } else if (dates.length === 0) {
        body = h('div', { style: { padding: '20px 20px', ...metaStyle } }, translate('empty'));
      } else {
        body = h(
          'div',
          { style: { padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: '54vh' } },
          dates.map(rowFor),
        );
      }

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
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
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
              width: 'min(560px, 100%)',
              maxHeight: '78vh',
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
              h('div', { style: { ...metaStyle, marginTop: 4, maxWidth: 430 } }, translate('subtitle')),
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
          controls,
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

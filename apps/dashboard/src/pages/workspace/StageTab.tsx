/**
 * Stage tab — review queued files, remove unwanted ones, see token cost
 * estimate. Reorder support is keyboard-only (↑/↓ buttons) for now.
 */

import { useMemo } from 'react';
import { estimateTokens, useWorkspace } from '../../intake/workspaceStore.js';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function StageTab() {
  const { state, removeFile, reorderFiles, clearFiles, setTab } = useWorkspace();

  const totals = useMemo(() => {
    let bytes = 0;
    let tokens = 0;
    for (const f of state.stagedFiles) {
      bytes += f.size;
      tokens += estimateTokens(f.size);
    }
    return { bytes, tokens };
  }, [state.stagedFiles]);

  if (state.stagedFiles.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          borderRadius: 10,
          border: '1px dashed var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--text-secondary)',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        No files staged. Open the{' '}
        <button
          onClick={() => setTab('inbox')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: 0,
            fontSize: 'inherit',
          }}
        >
          Inbox
        </button>{' '}
        to add some.
      </div>
    );
  }

  const move = (idx: number, delta: number) => {
    const next = [...state.stagedFiles];
    const target = idx + delta;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    reorderFiles(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          <strong>{state.stagedFiles.length}</strong> file(s),{' '}
          <strong>{fmtBytes(totals.bytes)}</strong> total, ~
          <strong>{totals.tokens.toLocaleString()}</strong> tokens estimated
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={clearFiles}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Clear all
          </button>
          <button
            onClick={() => setTab('run')}
            style={{
              padding: '6px 12px',
              border: 'none',
              borderRadius: 6,
              background: 'var(--accent)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Continue to Run →
          </button>
        </div>
      </div>

      <table
        data-testid="stage-list"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <thead>
          <tr style={{ background: 'var(--bg-input, #0b0d14)' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', width: 40 }}>#</th>
            <th style={{ textAlign: 'left', padding: '8px 12px' }}>File</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', width: 100 }}>Size</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', width: 100 }}>Tokens</th>
            <th style={{ width: 130 }} />
          </tr>
        </thead>
        <tbody>
          {state.stagedFiles.map((f, i) => (
            <tr key={f.path} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                {i + 1}
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  maxWidth: 360,
                }}
                title={f.path}
              >
                {f.name}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtBytes(f.size)}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                ~{estimateTokens(f.size).toLocaleString()}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  style={{
                    padding: '2px 8px',
                    marginRight: 4,
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text)',
                    cursor: i === 0 ? 'not-allowed' : 'pointer',
                    opacity: i === 0 ? 0.4 : 1,
                  }}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === state.stagedFiles.length - 1}
                  style={{
                    padding: '2px 8px',
                    marginRight: 4,
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text)',
                    cursor: i === state.stagedFiles.length - 1 ? 'not-allowed' : 'pointer',
                    opacity: i === state.stagedFiles.length - 1 ? 0.4 : 1,
                  }}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  onClick={() => removeFile(f.path)}
                  style={{
                    padding: '2px 8px',
                    background: 'transparent',
                    border: '1px solid var(--error, #ef4444)',
                    borderRadius: 4,
                    color: 'var(--error, #ef4444)',
                    cursor: 'pointer',
                  }}
                  aria-label="Remove"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

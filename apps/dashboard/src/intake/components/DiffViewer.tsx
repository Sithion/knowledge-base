/**
 * Minimal unified-diff viewer. We don't pull in a heavy diff lib — the
 * intake diffs are typically markdown so a token-light line-by-line
 * coloured view is sufficient. Lines starting with `+` go green, `-` red,
 * `@@` cyan, file headers bold.
 */

interface Props {
  diff: string;
  /** Optional cap on lines to render (defaults to 5000). */
  maxLines?: number;
}

export function DiffViewer({ diff, maxLines = 5000 }: Props) {
  const allLines = diff.split('\n');
  const truncated = allLines.length > maxLines;
  const lines = truncated ? allLines.slice(0, maxLines) : allLines;

  return (
    <div
      data-testid="diff-viewer"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-input, #0b0d14)',
        fontFamily: 'monospace',
        fontSize: 11,
        maxHeight: 480,
        overflow: 'auto',
        padding: 12,
      }}
    >
      {lines.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)' }}>
          (Diff is empty — the intake produced no file changes.)
        </div>
      ) : (
        <pre style={{ margin: 0, whiteSpace: 'pre' }}>
          {lines.map((line, i) => {
            let color: string | undefined;
            let weight: number | undefined;
            if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
              color = 'var(--accent)';
              weight = 600;
            } else if (line.startsWith('@@')) {
              color = '#06b6d4';
            } else if (line.startsWith('+')) {
              color = 'var(--success, #10b981)';
            } else if (line.startsWith('-')) {
              color = 'var(--error, #ef4444)';
            }
            return (
              <div key={i} style={{ color, fontWeight: weight }}>
                {line || ' '}
              </div>
            );
          })}
          {truncated && (
            <div style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
              … truncated {allLines.length - maxLines} more line(s).
            </div>
          )}
        </pre>
      )}
    </div>
  );
}

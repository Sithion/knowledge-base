/**
 * Drag-drop dropzone for staged inbox files. Uses the HTML5 drag-drop API
 * so it works both inside Tauri and in the plain web build (in the latter
 * case files are kept in-memory as `StagedFile` records — the actual
 * copy-to-managed-clone happens server-side once `run_intake` is invoked).
 *
 * Validates against the spec's allow-list of extensions.
 */

import { useCallback, useRef, useState } from 'react';
import type { StagedFile } from '../types.js';

const ALLOWED_EXTENSIONS = [
  '.docx', '.xlsx', '.pptx', '.pdf',
  '.png', '.jpg', '.jpeg', '.tiff',
  '.eml', '.msg',
  '.html', '.md', '.txt',
];

function hasAllowedExt(name: string): boolean {
  const lc = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lc.endsWith(ext));
}

interface Props {
  onAdd: (files: StagedFile[]) => void;
  disabled?: boolean;
}

export function InboxDropzone({ onAdd, disabled }: Props) {
  const [hover, setHover] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const accepted: StagedFile[] = [];
      const rejected: string[] = [];
      for (const f of Array.from(fileList)) {
        if (!hasAllowedExt(f.name)) {
          rejected.push(f.name);
          continue;
        }
        // In Tauri, the `path` property is populated; in web it's not, so
        // we fall back to the file name. The intake runner re-resolves
        // paths server-side from the staging dir.
        const path = (f as any).path || f.name;
        accepted.push({ path, name: f.name, size: f.size });
      }
      if (accepted.length > 0) onAdd(accepted);
      if (rejected.length > 0) {
        setWarn(
          `Skipped ${rejected.length} file(s) with unsupported extension: ${rejected
            .slice(0, 3)
            .join(', ')}${rejected.length > 3 ? '…' : ''}`,
        );
        setTimeout(() => setWarn(null), 5000);
      }
    },
    [onAdd],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        data-testid="inbox-dropzone"
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setHover(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        style={{
          padding: 32,
          borderRadius: 10,
          border: `2px dashed ${hover ? 'var(--accent)' : 'var(--border)'}`,
          background: hover ? 'rgba(99, 102, 241, 0.05)' : 'var(--bg-card)',
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>📥</div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
          Drop files to stage for intake
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Accepted: {ALLOWED_EXTENSIONS.join(', ')}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_EXTENSIONS.join(',')}
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {warn && (
        <div style={{ fontSize: 11, color: 'var(--warning, #f59e0b)' }}>{warn}</div>
      )}
    </div>
  );
}

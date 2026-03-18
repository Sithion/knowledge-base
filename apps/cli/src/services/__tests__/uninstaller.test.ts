import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}));

vi.mock('../../ui/index.js', () => ({
  showUninstallBanner: vi.fn(),
  step: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  confirmAction: vi.fn().mockResolvedValue(true),
}));

vi.mock('../config-manager.js', () => ({
  ConfigManager: class MockConfigManager {
    static CLAUDE_MD = '~/.claude/CLAUDE.md';
    static COPILOT_MD = '~/.github/copilot-instructions.md';
    static COPILOT_INSTRUCTIONS = '~/.copilot/copilot-instructions.md';
    static MCP_CONFIG = '~/.claude/mcp-config.json';
    static CLAUDE_JSON = '~/.claude.json';
    static COPILOT_MCP_CONFIG = '~/.copilot/mcp-config.json';
    removeConfig = vi.fn().mockResolvedValue({ removed: true, hadMarkers: true });
    removeMcpEntry = vi.fn().mockResolvedValue({ removed: true });
    removeOldKnowledgeMcp = vi.fn().mockResolvedValue({ cleaned: [] });
  },
}));

import { Uninstaller } from '../uninstaller.js';

describe('Uninstaller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets default installDir to ~/.ai-knowledge/', () => {
    const uninstaller = new Uninstaller({ force: true });
    expect((uninstaller as any).installDir).toContain('.ai-knowledge');
  });

  it('accepts custom installDir', () => {
    const uninstaller = new Uninstaller({ installDir: '/custom/path', force: true });
    expect((uninstaller as any).installDir).toBe('/custom/path');
  });

  it('handles undefined projectRoot (npx context)', () => {
    const uninstaller = new Uninstaller({ force: true });
    expect((uninstaller as any).projectRoot).toBeUndefined();
  });

  it('stores projectRoot when provided (repo context)', () => {
    const uninstaller = new Uninstaller({ projectRoot: '/repo/root', force: true });
    expect((uninstaller as any).projectRoot).toBe('/repo/root');
  });

  it('defaults keepData to false', () => {
    const uninstaller = new Uninstaller({ force: true });
    expect((uninstaller as any).keepData).toBe(false);
  });

  it('defaults force to false', () => {
    const uninstaller = new Uninstaller({});
    expect((uninstaller as any).force).toBe(false);
  });
});

describe('Uninstaller compose path resolution', () => {
  it('does not crash when projectRoot is undefined', () => {
    // Verifies the constructor accepts undefined projectRoot gracefully
    const uninstaller = new Uninstaller({
      installDir: '/nonexistent/dir',
      force: true,
    });
    expect((uninstaller as any).projectRoot).toBeUndefined();
  });
});

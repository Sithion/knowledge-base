import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSDK, mockDockerManager } = vi.hoisted(() => {
  const mockSDK = {
    healthCheck: vi.fn().mockResolvedValue({
      database: { connected: true },
      ollama: { connected: true, model: 'all-minilm' },
      docker: { running: true, containers: [{ name: 'kb-postgres', status: 'running' }] },
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockDockerManager = {
    ensureRunning: vi.fn().mockResolvedValue({
      containers: [{ name: 'kb-postgres', status: 'running' }],
    }),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  return { mockSDK, mockDockerManager };
});

vi.mock('../../utils/sdk.js', () => ({
  getSDK: vi.fn().mockResolvedValue(mockSDK),
  closeSDK: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@ai-knowledge/core', () => ({
  DockerManager: class MockDockerManager {
    ensureRunning = mockDockerManager.ensureRunning;
    stop = mockDockerManager.stop;
  },
}));

vi.mock('@ai-knowledge/sdk', () => ({
  KnowledgeSDK: class MockSDK {
    constructor() {}
    initialize = vi.fn();
    close = vi.fn();
    healthCheck = mockSDK.healthCheck;
  },
}));

import { healthCommand } from '../health.js';
import { dbStartCommand, dbStopCommand } from '../db.js';
import { getSDK } from '../../utils/sdk.js';

describe('health command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('is named "health"', () => {
    expect(healthCommand.name()).toBe('health');
  });

  it('calls sdk.healthCheck with autoStart: false', async () => {
    await healthCommand.parseAsync(['health'], { from: 'user' });

    expect(getSDK).toHaveBeenCalledWith({ autoStart: false });
    expect(mockSDK.healthCheck).toHaveBeenCalled();
  });

  it('sets exitCode=1 on error', async () => {
    mockSDK.healthCheck.mockRejectedValueOnce(new Error('connection failed'));

    await healthCommand.parseAsync(['health'], { from: 'user' });

    expect(process.exitCode).toBe(1);
  });
});

describe('db:start command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('is named "db:start"', () => {
    expect(dbStartCommand.name()).toBe('db:start');
  });

  it('calls DockerManager.ensureRunning', async () => {
    await dbStartCommand.parseAsync(['db:start'], { from: 'user' });
    expect(mockDockerManager.ensureRunning).toHaveBeenCalled();
  });

  it('sets exitCode=1 on error', async () => {
    mockDockerManager.ensureRunning.mockRejectedValueOnce(new Error('docker not found'));

    await dbStartCommand.parseAsync(['db:start'], { from: 'user' });

    expect(process.exitCode).toBe(1);
  });
});

describe('db:stop command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('is named "db:stop"', () => {
    expect(dbStopCommand.name()).toBe('db:stop');
  });

  it('calls DockerManager.stop', async () => {
    await dbStopCommand.parseAsync(['db:stop'], { from: 'user' });
    expect(mockDockerManager.stop).toHaveBeenCalled();
  });
});

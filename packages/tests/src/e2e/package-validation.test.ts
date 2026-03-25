import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../../../../apps/mcp-server/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

test.describe('mcp-server package.json validation', () => {
  test('bin paths must start with ./', () => {
    expect(pkg.bin).toBeTruthy();
    for (const [name, filepath] of Object.entries(pkg.bin as Record<string, string>)) {
      expect(filepath, `bin["${name}"] must start with ./`).toMatch(/^\.\//);
    }
  });

  test('repository.url has correct git+https format', () => {
    expect(pkg.repository?.url).toMatch(/^git\+https:\/\//);
    expect(pkg.repository?.url).toMatch(/\.git$/);
  });

  test('required fields exist and are valid', () => {
    expect(pkg.name).toBeTruthy();
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(pkg.main).toBeTruthy();
    expect(pkg.files).toBeInstanceOf(Array);
    expect(pkg.files.length).toBeGreaterThan(0);
    expect(pkg.private).toBe(false);
    expect(pkg.description).toBeTruthy();
    expect(pkg.license).toBeTruthy();
  });

  test('main field starts with ./', () => {
    expect(pkg.main).toMatch(/^\.\//);
  });

  test('name is a scoped @cognistore package', () => {
    expect(pkg.name).toMatch(/^@cognistore\//);
  });
});

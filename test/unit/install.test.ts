import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const INSTALL_SH = path.join(PROJECT_ROOT, 'install.sh');

describe('install.sh --dry-run', () => {
  it('reports planned steps without modifying the filesystem', () => {
    const output = execSync(`bash "${INSTALL_SH}" --dry-run`, {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
    });
    expect(output).toContain('[dry-run]');
    expect(output).toContain('npm run build');
    expect(output).toContain('plan-reviewer');
    expect(output).toContain('LaunchAgents');
    expect(output).toContain('settings.json');
  });

  it('does not create any install artifacts during dry-run', () => {
    execSync(`bash "${INSTALL_SH}" --dry-run`, {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
    });
    // The install target should not have been created.
    expect(existsSync('/usr/local/lib/plan-reviewer/dist/main.js')).toBe(false);
  });

  it('install.sh exists and is a valid shell script', () => {
    expect(existsSync(INSTALL_SH)).toBe(true);
    // bash -n is a syntax check only.
    execSync(`bash -n "${INSTALL_SH}"`, { encoding: 'utf8' });
  });
});

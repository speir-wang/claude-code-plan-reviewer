import { describe, it, expect } from 'vitest';
import type { Session } from '../../src/types.js';

// Step-1 smoke test: proves the TS + vitest toolchain compiles and runs.
// Real tests for each subsystem will live in their own files.
describe('scaffold', () => {
  it('Session type is wired up', () => {
    const s: Session = {
      id: 'abc',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      planVersions: [],
      conversation: [],
      status: 'active',
    };
    expect(s.status).toBe('active');
  });
});

import { describe, expect, it } from 'vitest';
import * as db from '../src/index.ts';

describe('cinefilo-db skeleton', () => {
  it('exports a module', () => {
    expect(typeof db).toBe('object');
  });
});

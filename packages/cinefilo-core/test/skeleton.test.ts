import { describe, expect, it } from 'vitest';
import * as core from '../src/index.ts';

describe('cinefilo-core skeleton', () => {
  it('exports a module', () => {
    expect(typeof core).toBe('object');
  });
});

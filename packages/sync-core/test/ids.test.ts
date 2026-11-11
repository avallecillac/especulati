import { describe, expect, it } from 'vitest';
import { err, ok, parseDeviceId, UUID_PATTERN } from '../src/index.ts';
import { uuid } from './fixtures.ts';

describe('parseDeviceId', () => {
  it('accepts a lowercase uuid', () => expect(parseDeviceId(uuid(1))).toEqual(ok(uuid(1))));
  it('rejects uppercase and junk', () => {
    const bad = { ok: false, error: { field: 'deviceId', reason: 'not a lowercase uuid' } };
    expect(parseDeviceId('5B0E6C0A-1D2E-4F3A-9B8C-7D6E5F4A3B2C')).toEqual(bad);
    expect(parseDeviceId('not-a-uuid')).toEqual(bad);
  });
  it('UUID_PATTERN matches exactly a lowercase uuid', () => {
    expect(new RegExp(`^${UUID_PATTERN}$`).test(uuid(7))).toBe(true);
  });
  it('err wraps an error', () => expect(err('x')).toEqual({ ok: false, error: 'x' }));
});

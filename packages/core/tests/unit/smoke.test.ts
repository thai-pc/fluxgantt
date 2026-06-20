import { describe, it, expect } from 'vitest';
import { VERSION } from '../../src/index.js';

describe('@fluxgantt/core', () => {
  it('expose VERSION', () => {
    expect(typeof VERSION).toBe('string');
  });
});

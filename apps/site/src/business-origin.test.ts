import { describe, expect, it } from 'vitest';
import { businessClientOrigin } from './business-origin';

const publicOrigin = 'https://public.example.test';

describe('public business login destination', () => {
  it('allows an explicitly configured separate HTTPS origin', () => {
    expect(businessClientOrigin('https://work.example.test/', publicOrigin)).toBe('https://work.example.test');
  });

  it('omits missing, invalid, credential-bearing and non-origin destinations', () => {
    for (const value of [
      undefined, '', '/login', 'http://work.example.test', 'javascript:alert(1)',
      'https://user:password@work.example.test', 'https://work.example.test/login',
      'https://work.example.test?token=example', 'https://work.example.test#login',
      publicOrigin,
    ]) {
      expect(businessClientOrigin(value, publicOrigin)).toBeNull();
    }
  });
});

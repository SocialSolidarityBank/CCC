import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateBindAddress } from '../src/bind-validation.ts';

// Login, MFA, directory state, expiry and encrypted storage are exercised by runtime-scenario.mjs.
// These cases defend parsing boundaries that could accidentally widen a listener's permitted subnet.
test('Office rejects public or malformed addresses and CIDRs extending outside RFC1918', () => {
  for (const [host, cidr] of [
    ['0.0.0.0', '10.0.0.0/8'],
    ['192.168.1.7junk', '192.168.1.0/24'],
    ['192.168.01.7', '192.168.1.0/24'],
    ['172.16.1.7', '172.0.0.0/8'],
    ['192.168.2.7', '192.168.1.0/24'],
    ['10.0.0.7', '10.0.0.1/24'],
  ]) assert.throws(() => validateBindAddress(host!, cidr!));
});

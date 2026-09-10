import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateBindAddress } from '../src/bind-validation.ts';
import { decodeOfficeTotpSecret } from '@ccc/core/gateway';

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

test('Office MFA enforces decoded strength and canonical base32 trailing bits', () => {
  for (const secret of ['JBSWY3DPEHPK3PXP', 'A'.repeat(25), 'A'.repeat(25) + 'B', 'A'.repeat(27)]) {
    assert.equal(decodeOfficeTotpSecret(secret), null);
  }
  const minimum = decodeOfficeTotpSecret('A'.repeat(26));
  const standard = decodeOfficeTotpSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
  try {
    assert.deepEqual(minimum, new Uint8Array(16));
    assert.ok(standard);
    assert.equal(Buffer.from(standard).toString('hex'), '48656c6c6f21deadbeef48656c6c6f21deadbeef');
  } finally { minimum?.fill(0); standard?.fill(0); }
});

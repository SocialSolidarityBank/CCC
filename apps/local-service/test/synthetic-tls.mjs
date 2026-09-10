import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';

// Synthetic fixture issuer only. Production never mints a CA at service startup.
const tag = (kind, ...parts) => {
  const body = Buffer.concat(parts);
  const length = body.length < 128 ? Buffer.from([body.length])
    : body.length < 256 ? Buffer.from([0x81, body.length]) : Buffer.from([0x82, body.length >> 8, body.length & 255]);
  return Buffer.concat([Buffer.from([kind]), length, body]);
};
const seq = (...parts) => tag(0x30, ...parts);
const oid = (hex) => tag(6, Buffer.from(hex, 'hex'));
const integer = (bytes) => tag(2, bytes[0] & 128 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const algorithm = seq(oid('2a864886f70d01010b'), tag(5));
const name = (text) => seq(tag(0x31, seq(oid('550403'), tag(0x0c, Buffer.from(text)))));
const extension = (id, value, critical = false) => seq(oid(id), ...(critical ? [tag(1, Buffer.from([255]))] : []), tag(4, value));
const pem = (bytes) => `-----BEGIN CERTIFICATE-----\n${bytes.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
const instant = (date) => tag(0x18, Buffer.from(date.toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, 'Z')));

export function syntheticOfficeTls(ip, options = {}) {
  const root = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const leaf = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rootName = name('CCC synthetic runtime CA');
  const validity = seq(instant(new Date(Date.now() - 60_000)), instant(new Date(Date.now() + 86_400_000)));
  function certificate(subject, issuer, publicKey, privateKey, extensions) {
    const serial = randomBytes(16); serial[0] &= 127; serial[0] |= 1;
    const body = seq(tag(0xa0, integer(Buffer.from([2]))), integer(serial), algorithm, issuer, validity, subject,
      publicKey.export({ type: 'spki', format: 'der' }), tag(0xa3, seq(...extensions)));
    return pem(seq(body, algorithm, tag(3, Buffer.from([0]), sign('sha256', body, privateKey))));
  }
  const address = Buffer.from(ip.split('.').map(Number));
  const permitted = options.constraintIp ? Buffer.from(options.constraintIp.split('.').map(Number)) : address;
  const rootExtensions = [
    extension('551d13', seq(tag(1, Buffer.from([255])), integer(Buffer.from([0]))), true),
    extension('551d0f', tag(3, Buffer.from([1, 6])), true),
  ];
  if (!options.unconstrained) rootExtensions.push(extension('551d1e', seq(tag(0xa0, seq(tag(0x87, permitted, Buffer.from([255, 255, 255, 255]))))), true));
  const ca = certificate(rootName, rootName, root.publicKey, root.privateKey, rootExtensions);
  const cert = certificate(name('CCC synthetic Office'), rootName, leaf.publicKey, root.privateKey, [
    extension('551d13', seq(), true),
    extension('551d0f', tag(3, Buffer.from([5, 0xa0])), true),
    extension('551d25', seq(oid('2b06010505070301'))),
    extension('551d11', seq(tag(0x87, address))),
  ]);
  return { ca, certificate: cert, privateKey: new Uint8Array(leaf.privateKey.export({ type: 'pkcs8', format: 'der' })) };
}

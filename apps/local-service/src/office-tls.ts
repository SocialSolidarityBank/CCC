import { X509Certificate, createPrivateKey } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { SignedInstallManifest } from '@ccc/contracts/runtime';
import { parseIPv4, validateBindAddress } from './bind-validation.ts';

interface Der { tag: number; bytes: Uint8Array; children(): Der[] }
function der(bytes: Uint8Array): Der[] {
  const nodes: Der[] = [];
  for (let position = 0; position < bytes.length;) {
    const tag = bytes[position++]!, first = bytes[position++];
    if (first === undefined || (tag & 31) === 31) throw new Error('tls_identity_invalid');
    let size = first;
    if (first & 128) {
      const count = first & 127;
      if (count < 1 || count > 4 || bytes[position] === 0) throw new Error('tls_identity_invalid');
      size = 0;
      for (let i = 0; i < count; i++) { const byte = bytes[position++]; if (byte === undefined) throw new Error('tls_identity_invalid'); size = size * 256 + byte; }
      if (size < 128) throw new Error('tls_identity_invalid');
    }
    if (position + size > bytes.length) throw new Error('tls_identity_invalid');
    const content = bytes.subarray(position, position + size);
    nodes.push({ tag, bytes: content, children: () => der(content) });
    position += size;
  }
  return nodes;
}
function extensions(cert: X509Certificate): Map<string, { critical: boolean; value: Der[] }> {
  const certificate = der(cert.raw);
  const tbs = certificate[0]?.children()[0];
  const container = tbs?.children().find((node) => node.tag === 0xa3);
  const result = new Map<string, { critical: boolean; value: Der[] }>();
  if (container === undefined) throw new Error('tls_identity_invalid');
  for (const extension of container.children()[0]!.children()) {
    const fields = extension.children();
    const oid = Buffer.from(fields[0]!.bytes).toString('hex');
    if (fields[0]?.tag !== 6 || result.has(oid)) throw new Error('tls_identity_invalid');
    const critical = fields[1]?.tag === 1;
    if (critical && (fields[1]!.bytes.length !== 1 || fields[1]!.bytes[0] !== 255)) throw new Error('tls_identity_invalid');
    const value = fields[critical ? 2 : 1];
    if (value?.tag !== 4 || fields.length !== (critical ? 3 : 2)) throw new Error('tls_identity_invalid');
    result.set(oid, { critical, value: der(value.bytes) });
  }
  return result;
}
function dnsName(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString('ascii');
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(text) || text.includes('..') || !Buffer.from(text).equals(bytes)) throw new Error('tls_identity_invalid');
  return text;
}
function ipv4(bytes: Uint8Array): string {
  if (bytes.length !== 4) throw new Error('tls_identity_invalid');
  return Array.from(bytes).join('.');
}

/** Conservative RFC5280 profile: exact DNS, private IPv4 subtrees, no unconstrained aliases. */
export async function verifyOfficeTlsIdentity(input: {
  manifest: SignedInstallManifest; bindHost: string; privateCidr: string;
  certificate: string; ca: string; privateKey: Uint8Array;
}): Promise<void> {
  try {
    const { manifest, bindHost, privateCidr } = input;
    validateBindAddress(bindHost, privateCidr);
    const expected = new URL(manifest.apiBase);
    if (manifest.mode !== 'local-office' || manifest.apiBase !== `https://${manifest.host}:8443`
      || expected.hostname !== manifest.host || manifest.clientOrigin !== manifest.apiBase
      || manifest.allowedOrigins.length !== 1 || manifest.allowedOrigins[0] !== manifest.clientOrigin) throw new Error();
    const hostIp = parseIPv4(manifest.host);
    if (hostIp !== null) { if (manifest.host !== bindHost) throw new Error(); }
    else {
      if (dnsName(Buffer.from(manifest.host)) !== manifest.host) throw new Error();
      const addresses = await lookup(manifest.host, { all: true });
      if (addresses.length === 0 || addresses.some((entry) => entry.family !== 4 || entry.address !== bindHost)) throw new Error();
    }
    const certs = input.certificate.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    const roots = input.ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certs?.length || !roots || roots.length !== 1) throw new Error();
    const chain = certs.map((pem) => new X509Certificate(pem));
    const root = new X509Certificate(roots[0]!);
    if (chain[chain.length - 1]!.fingerprint256 !== root.fingerprint256) chain.push(root);
    if (chain.length < 2 || chain[0]!.ca || !root.ca || !root.verify(root.publicKey)) throw new Error();
    const key = createPrivateKey({ key: Buffer.from(input.privateKey.buffer, input.privateKey.byteOffset, input.privateKey.byteLength), format: 'der', type: 'pkcs8' });
    if (!chain[0]!.checkPrivateKey(key)) throw new Error();
    for (let index = 0; index < chain.length; index++) {
      const cert = chain[index]!;
      const ext = extensions(cert);
      for (const [id, value] of ext) {
        if (value.critical && !['551d13', '551d0f', '551d25', '551d11', '551d1e'].includes(id)) throw new Error();
      }
      if (index > 0) {
        if (cert.keyUsage !== undefined && !cert.keyUsage.includes('1.3.6.1.5.5.7.3.1') && !cert.keyUsage.includes('2.5.29.37.0')) throw new Error();
        const basic = ext.get('551d13');
        const fields = basic?.value[0]?.children();
        if (!basic?.critical || basic.value[0]?.tag !== 0x30 || fields?.[0]?.tag !== 1 || fields[0].bytes[0] !== 255
          || fields.length > 2) throw new Error();
        if (fields[1] !== undefined) {
          if (fields[1].tag !== 2 || fields[1].bytes.length !== 1 || fields[1].bytes[0]! < index - 1) throw new Error();
        }
        const usage = ext.get('551d0f')?.value[0];
        if (usage?.tag !== 3 || usage.bytes.length < 2 || (usage.bytes[1]! & 4) === 0) throw new Error();
      }
      if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) throw new Error();
      if (index + 1 < chain.length && (!chain[index + 1]!.ca || !cert.checkIssued(chain[index + 1]!) || !cert.verify(chain[index + 1]!.publicKey))) throw new Error();
    }
    const leaf = chain[0]!;
    if (!leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1')) throw new Error();
    if (hostIp === null ? leaf.checkHost(manifest.host, { subject: 'never', wildcards: false }) !== manifest.host : leaf.checkIP(manifest.host) !== manifest.host) throw new Error();
    const san = extensions(leaf).get('551d11');
    if (san?.value.length !== 1 || san.value[0]?.tag !== 0x30) throw new Error();
    const names = san.value[0].children();
    if (names.length === 0) throw new Error();
    for (const name of names) {
      if (name.tag === 0x82) { if (hostIp !== null || dnsName(name.bytes) !== manifest.host) throw new Error(); }
      else if (name.tag === 0x87) { if (ipv4(name.bytes) !== bindHost) throw new Error(); }
      else throw new Error();
    }
    const [networkText, prefixText] = privateCidr.split('/');
    const network = parseIPv4(networkText!)!, prefix = Number(prefixText);
    const configuredMask = (0xffffffff << (32 - prefix)) >>> 0;
    let constrained = false;
    for (const ca of chain.slice(1)) {
      const constraints = extensions(ca).get('551d1e');
      if (constraints === undefined) continue;
      if (!constraints.critical || constraints.value.length !== 1 || constraints.value[0]?.tag !== 0x30) throw new Error();
      const subtrees = constraints.value[0].children();
      // Excluded/unknown subtrees are rejected, not silently ignored.
      if (subtrees.length !== 1 || subtrees[0]?.tag !== 0xa0) throw new Error();
      const permitted = subtrees[0].children().map((subtree) => {
        const fields = subtree.children();
        if (subtree.tag !== 0x30 || fields.length !== 1) throw new Error();
        return fields[0]!;
      });
      if (permitted.length === 0) throw new Error();
      for (const name of permitted) {
        if (name.tag === 0x82) { if (hostIp !== null || dnsName(name.bytes) !== manifest.host) throw new Error(); }
        else if (name.tag === 0x87) {
          if (name.bytes.length !== 8) throw new Error();
          const address = parseIPv4(ipv4(name.bytes.subarray(0, 4)))!;
          const mask = parseIPv4(ipv4(name.bytes.subarray(4)))!;
          const inverse = (~mask) >>> 0;
          if ((inverse & (inverse + 1)) !== 0 || ((address & mask) >>> 0) !== address
            || ((mask & configuredMask) >>> 0) !== configuredMask
            || ((address & configuredMask) >>> 0) !== network) throw new Error();
        } else throw new Error();
      }
      for (const name of names) {
        if (!permitted.some((base) => {
          if (base.tag !== name.tag) return false;
          if (name.tag === 0x82) return dnsName(base.bytes) === dnsName(name.bytes);
          const mask = parseIPv4(ipv4(base.bytes.subarray(4)))!;
          return ((parseIPv4(ipv4(name.bytes))! & mask) >>> 0) === parseIPv4(ipv4(base.bytes.subarray(0, 4)));
        })) throw new Error();
      }
      constrained = true;
    }
    if (!constrained) throw new Error();
  } catch { throw new Error('tls_identity_invalid'); }
}

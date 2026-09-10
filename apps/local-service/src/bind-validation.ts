/**
 * E8-1 bind address validation for Local Office.
 * RFC1918 validation and CIDR matching.
 * Separate file to avoid db-sqlite import chain in tests.
 */

// RFC1918 private address ranges
const RFC1918_RANGES = [
  { start: 0x0a000000, end: 0x0affffff }, // 10.0.0.0/8
  { start: 0xac100000, end: 0xac1fffff }, // 172.16.0.0/12
  { start: 0xc0a80000, end: 0xc0a8ffff }, // 192.168.0.0/16
];

export function parseIPv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0; // Ensure unsigned
}

/** Check if an IP address is RFC1918 private. */
export function isRfc1918(ip: string): boolean {
  const num = parseIPv4(ip);
  if (num === null) return false;
  return RFC1918_RANGES.some((r) => num >= r.start && num <= r.end);
}

/**
 * Validate that a bind address is RFC1918 and within the specified CIDR.
 * @throws Error with code: bind_address_not_private, invalid_private_cidr, invalid_cidr_prefix, invalid_address, host_outside_cidr
 */
export function validateBindAddress(host: string, privateCidr: string): void {
  // Must be RFC1918
  if (!isRfc1918(host)) {
    throw new Error('bind_address_not_private');
  }

  // Validate CIDR notation
  const cidrMatch = privateCidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!cidrMatch) {
    throw new Error('invalid_private_cidr');
  }

  const network = cidrMatch[1]!;
  const prefixStr = cidrMatch[2]!;
  const prefix = parseInt(prefixStr, 10);
  if (prefix < 8 || prefix > 30) {
    throw new Error('invalid_cidr_prefix');
  }

  // Verify host is within the CIDR
  const hostNum = parseIPv4(host);
  const networkNum = parseIPv4(network);
  if (hostNum === null || networkNum === null) {
    throw new Error('invalid_address');
  }

  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  if ((hostNum & mask) !== (networkNum & mask)) {
    throw new Error('host_outside_cidr');
  }
}

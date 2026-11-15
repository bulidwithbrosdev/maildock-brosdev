import { all, first, placeholders } from '../db/db';
import { domainOf, normalizeAddress } from '../mail/address';

/**
 * Generate candidate patterns to match against blocked_senders.pattern.
 * For an address like "john@sub.example.com", generates:
 * - "john@sub.example.com"
 * - "@sub.example.com"
 * - "sub.example.com"
 * - "@example.com"
 * - "example.com"
 */
export function candidatePatterns(address: string): string[] {
  const clean = normalizeAddress(address || '').toLowerCase().trim();
  if (!clean) return [];
  const patterns: string[] = [clean];
  const domain = domainOf(clean).toLowerCase().trim();
  if (!domain) return patterns;

  patterns.push(`@${domain}`, domain);

  // Check parent domains (e.g. for sub.example.com -> @example.com, example.com)
  const parts = domain.split('.');
  while (parts.length > 2) {
    parts.shift();
    const parent = parts.join('.');
    patterns.push(`@${parent}`, parent);
  }

  return [...new Set(patterns)];
}

/**
 * Checks whether an address or its domain is blocked.
 * If mailboxId is provided, checks global blocks (mailbox_id IS NULL) and mailbox-specific blocks.
 * Also checks if the mailbox members have `block_senders_enabled = 0` (bypassed).
 */
export async function isSenderBlocked(
  db: D1Database,
  mailboxId: number | null,
  address: string,
): Promise<{ blocked: boolean; pattern?: string }> {
  if (!address) return { blocked: false };

  // If mailboxId is specified, check if user has block_senders_enabled = 0
  if (mailboxId !== null) {
    const members = await all<{ block_senders_enabled: number | null }>(
      db,
      'SELECT u.block_senders_enabled FROM mailbox_members mm JOIN users u ON u.id = mm.user_id WHERE mm.mailbox_id = ?',
      mailboxId,
    ).catch(() => []);
    if (members.length > 0 && members.every((m) => m.block_senders_enabled === 0)) {
      return { blocked: false };
    }
  }

  const candidates = candidatePatterns(address);
  if (!candidates.length) return { blocked: false };

  const query = mailboxId !== null
    ? `SELECT pattern FROM blocked_senders WHERE (mailbox_id IS NULL OR mailbox_id = ?) AND LOWER(pattern) IN (${placeholders(candidates.length)}) LIMIT 1`
    : `SELECT pattern FROM blocked_senders WHERE LOWER(pattern) IN (${placeholders(candidates.length)}) LIMIT 1`;

  const params = mailboxId !== null ? [mailboxId, ...candidates] : candidates;
  const row = await first<{ pattern: string }>(db, query, ...params);
  if (row) {
    return { blocked: true, pattern: row.pattern };
  }
  return { blocked: false };
}

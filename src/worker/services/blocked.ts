import { all } from '../db/db';
import { domainOf, normalizeAddress } from '../mail/address';

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

  // If mailboxId is specified, check if user has block_senders_enabled = 0 (bypassed)
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

  const cleanAddr = normalizeAddress(address).toLowerCase().trim();
  const senderDomain = domainOf(cleanAddr).toLowerCase().trim();

  // Load all rules applying to this mailbox (or global)
  const rules = await all<{ pattern: string }>(
    db,
    mailboxId !== null
      ? 'SELECT pattern FROM blocked_senders WHERE mailbox_id IS NULL OR mailbox_id = ?'
      : 'SELECT pattern FROM blocked_senders WHERE mailbox_id IS NULL',
    ...(mailboxId !== null ? [mailboxId] : []),
  ).catch(() => []);

  for (const rule of rules) {
    const rawPattern = (rule.pattern || '').toLowerCase().trim();
    if (!rawPattern) continue;

    // 1. Direct exact address match: "spammer@domain.com"
    if (rawPattern === cleanAddr) {
      return { blocked: true, pattern: rule.pattern };
    }

    // 2. Domain / Subdomain match: e.g. "@zee5.com", "zee5.com", "*@zee5.com", "*.zee5.com"
    const cleanDomain = rawPattern.replace(/^(\*@|@|\*\.|\.)+/, '');
    if (cleanDomain && (senderDomain === cleanDomain || senderDomain.endsWith(`.${cleanDomain}`))) {
      return { blocked: true, pattern: rule.pattern };
    }

    // 3. Generic wildcard match if pattern contains *
    if (rawPattern.includes('*')) {
      const regexPattern = '^' + rawPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
      try {
        const re = new RegExp(regexPattern, 'i');
        if (re.test(cleanAddr) || re.test(`@${senderDomain}`) || re.test(senderDomain)) {
          return { blocked: true, pattern: rule.pattern };
        }
      } catch {}
    }
  }

  return { blocked: false };
}

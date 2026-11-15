import type { Env } from '../env';
import { all, run } from '../db/db';
import { loadSettings } from '../db/settings';
import { getUser } from './users';
import { renderSignatureTemplate } from '../../shared/signature';

export async function syncUserSignature(env: Env, userId: number, customTemplate?: string): Promise<number> {
  const user = await getUser(env.DB, userId);
  const settings = await loadSettings(env.DB);
  const template = customTemplate || settings.signatureTemplate;
  if (!template) return 0;

  const mailboxes = await all<{ id: number; address: string; display_name: string }>(
    env.DB,
    'SELECT m.id, m.address, m.display_name FROM mailboxes m JOIN mailbox_members mm ON mm.mailbox_id = m.id WHERE mm.user_id = ?',
    userId,
  );

  const company = settings.instanceName || 'Brosdev Solutions';

  for (const box of mailboxes) {
    const rendered = renderSignatureTemplate(template, {
      name: user.name || box.display_name,
      email: box.address,
      designation: user.designation,
      company,
    });
    await run(env.DB, 'UPDATE mailboxes SET signature = ?, state = state + 1 WHERE id = ?', rendered, box.id);
  }

  return mailboxes.length;
}

export async function syncAllSignatures(env: Env, customTemplate?: string): Promise<{ usersCount: number; mailboxesCount: number }> {
  const settings = await loadSettings(env.DB);
  const template = customTemplate || settings.signatureTemplate;
  if (!template) return { usersCount: 0, mailboxesCount: 0 };

  const users = await all<{ id: number; name: string; email: string; designation: string | null }>(
    env.DB,
    'SELECT id, name, email, designation FROM users WHERE status = "active"',
  );

  const company = settings.instanceName || 'Brosdev Solutions';
  let totalMailboxes = 0;

  for (const u of users) {
    const mailboxes = await all<{ id: number; address: string; display_name: string }>(
      env.DB,
      'SELECT m.id, m.address, m.display_name FROM mailboxes m JOIN mailbox_members mm ON mm.mailbox_id = m.id WHERE mm.user_id = ?',
      u.id,
    );

    for (const box of mailboxes) {
      const rendered = renderSignatureTemplate(template, {
        name: u.name || box.display_name,
        email: box.address,
        designation: u.designation,
        company,
      });
      await run(env.DB, 'UPDATE mailboxes SET signature = ?, state = state + 1 WHERE id = ?', rendered, box.id);
      totalMailboxes++;
    }
  }

  return { usersCount: users.length, mailboxesCount: totalMailboxes };
}

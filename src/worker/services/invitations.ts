// User account activation invitations and credential delivery
import type { Env } from '../env';
import { all, first, run } from '../db/db';
import { loadSettings } from '../db/settings';
import { badRequest, errorMessage, notFound, tooMany } from '../lib/errors';
import { randomToken, sha256Hex } from '../lib/crypto';
import { generatePassword, hashPassword, passwordProblem } from '../lib/password';
import { domainOf, isValidAddress, type Address } from '../mail/address';
import { buildMime } from '../mail/mime';
import { newMessageId } from '../mail/threading';
import { adapterFor, type ProviderRow } from '../providers';
import { audit, auditStmt } from './audit';
import { getUser } from './users';
import type { SessionUser } from '../types';
import type { OutgoingMessage } from '../providers/types';
import { PROVIDER_INFO } from '../../shared/constants';
import { log, logError } from '../lib/log';
import { isSenderBlocked } from './blocked';

export const INVITATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
export const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

export interface UserInvitationRow {
  id: number;
  user_id: number;
  token_hash: string;
  recipient_email: string;
  status: 'pending' | 'sent' | 'accepted' | 'expired' | 'failed';
  error: string | null;
  sent_at: number | null;
  expires_at: number;
  accepted_at: number | null;
  created_at: number;
}

export function renderInvitationEmail({
  userName,
  mailboxEmail,
  webmailUrl,
  password,
  instanceName,
  senderName,
  senderEmail,
}: {
  userName: string;
  mailboxEmail: string;
  webmailUrl: string;
  password?: string;
  instanceName?: string;
  senderName?: string;
  senderEmail?: string;
}): { subject: string; html: string; text: string } {
  const subject = 'Your business email account is ready';
  const domain = mailboxEmail.includes('@') ? mailboxEmail.split('@')[1] : 'yourdomain.com';
  const firstName = userName?.trim() ? userName.trim().split(/\s+/)[0] : mailboxEmail.split('@')[0];
  const loginUrl = `${webmailUrl.replace(/\/+$/, '')}/login`;
  const tempPassword = password || '';
  const testEmail = `hello@${domain}`;
  const adminContactName = senderName?.trim() || 'Administrator';
  const adminContactEmail = senderEmail?.trim() || `admin@${domain}`;
  const adminTitle = 'IT Administration';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;">
<!-- Hidden preview text shown in the inbox list -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f5f5f5;">Your Brosdev Solutions email address is set up. Here is how to sign in.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
<tr><td align="center" style="padding:24px 12px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#000000;">

  <!-- Header -->
  <tr><td style="background:#000000;padding:26px 32px;border-bottom:4px solid #A90706;">
    <div style="font-size:22px;font-weight:bold;letter-spacing:3px;color:#ffffff;">BROSDEV</div>
    <div style="font-size:11px;letter-spacing:2px;color:#8A8A8A;">SOLUTIONS</div>
  </td></tr>

  <!-- Title -->
  <tr><td style="padding:36px 32px 8px 32px;">
    <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:bold;color:#000000;">Your business email account is ready</h1>
  </td></tr>

  <!-- Intro -->
  <tr><td style="padding:12px 32px 8px 32px;font-size:15px;line-height:1.6;color:#333333;">
    Hi ${firstName},<br><br>
    Welcome to Brosdev Solutions. Your company email account has been created on Maildock, and you can sign in and start using it today.
  </td></tr>

  <!-- Account details -->
  <tr><td style="padding:16px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;border-left:4px solid #A90706;">
      <tr><td style="padding:18px 20px;font-size:14px;line-height:1.8;color:#000000;">
        <span style="color:#555555;">Email address</span><br>
        <strong style="font-size:16px;">${mailboxEmail}</strong><br>
        <span style="color:#555555;">Sign-in page (Maildock)</span><br>
        <a href="${loginUrl}" style="color:#A90706;text-decoration:underline;">${loginUrl}</a><br>
        <span style="color:#555555;">Temporary password</span><br>
        <strong style="font-family:'Courier New',Courier,monospace;font-size:16px;letter-spacing:1px;background:#ffffff;border:1px solid #d9d9d9;padding:4px 10px;display:inline-block;margin-top:2px;">${tempPassword}</strong><br>
        <span style="font-size:12px;color:#8A8A8A;">You will be asked to set a new password the first time you sign in.</span>
      </td></tr>
    </table>
  </td></tr>

  <!-- Button -->
  <tr><td align="left" style="padding:8px 32px 24px 32px;">
    <a href="${loginUrl}" style="display:inline-block;background:#A90706;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 28px;">Sign in to your email</a>
  </td></tr>

  <!-- First steps -->
  <tr><td style="padding:0 32px 8px 32px;">
    <h2 style="margin:0 0 10px 0;font-size:18px;color:#000000;">Your first steps</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.6;color:#333333;">
      <tr><td valign="top" style="padding:0 12px 10px 0;color:#A90706;font-weight:bold;">1.</td><td style="padding-bottom:10px;"><strong>Sign in</strong> with your email address and the temporary password.</td></tr>
      <tr><td valign="top" style="padding:0 12px 10px 0;color:#A90706;font-weight:bold;">2.</td><td style="padding-bottom:10px;"><strong>Change your password</strong> straight away, then delete this email. Use at least 12 characters, and do not reuse an old one.</td></tr>
      <tr><td valign="top" style="padding:0 12px 10px 0;color:#A90706;font-weight:bold;">3.</td><td style="padding-bottom:10px;"><strong>Add your signature</strong> using the signature template we shared with you.</td></tr>
      <tr><td valign="top" style="padding:0 12px 10px 0;color:#A90706;font-weight:bold;">4.</td><td style="padding-bottom:10px;"><strong>Send a test email</strong> to <a href="mailto:${testEmail}" style="color:#A90706;text-decoration:none;">${testEmail}</a> and check that it arrives.</td></tr>
    </table>
  </td></tr>

  <!-- Safety -->
  <tr><td style="padding:12px 32px 8px 32px;">
    <h2 style="margin:0 0 10px 0;font-size:18px;color:#000000;">Keep your account safe</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.6;color:#333333;">
      <tr><td valign="top" style="padding:0 10px 6px 0;color:#A90706;">&#9632;</td><td style="padding-bottom:6px;">Never share your password, even with colleagues or IT.</td></tr>
      <tr><td valign="top" style="padding:0 10px 6px 0;color:#A90706;">&#9632;</td><td style="padding-bottom:6px;">We will never ask for your password by email or message.</td></tr>
      <tr><td valign="top" style="padding:0 10px 6px 0;color:#A90706;">&#9632;</td><td style="padding-bottom:6px;">Be careful with unexpected links and attachments, and report anything suspicious.</td></tr>
      <tr><td valign="top" style="padding:0 10px 6px 0;color:#A90706;">&#9632;</td><td style="padding-bottom:6px;">Use this account for company work only.</td></tr>
    </table>
  </td></tr>

  <!-- Help -->
  <tr><td style="padding:20px 32px 28px 32px;font-size:14px;line-height:1.6;color:#333333;">
    Cannot sign in or need help? Reply to this email or contact ${adminContactName} at <a href="mailto:${adminContactEmail}" style="color:#A90706;">${adminContactEmail}</a>.<br><br>
    Welcome aboard,<br>
    <strong>${adminContactName}</strong><br>
    ${adminTitle}, Brosdev Solutions
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#000000;padding:20px 32px;font-size:11px;line-height:1.6;color:#8A8A8A;">
    <span style="color:#ffffff;font-weight:bold;">Secured by Maildock</span> &middot; Your own email, on your own domains.<br><br>
    Brosdev Solutions<br>
    This email is confidential and intended only for ${firstName}. If you received it by mistake, please tell us and delete it.
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = `Your business email account is ready

Hi ${firstName},

Welcome to Brosdev Solutions. Your company email account has been created on Maildock, and you can sign in and start using it today.

Account details:
- Email address: ${mailboxEmail}
- Sign-in page (Maildock): ${loginUrl}
- Temporary password: ${tempPassword}
(You will be asked to set a new password the first time you sign in.)

Sign in to your email: ${loginUrl}

Your first steps:
1. Sign in with your email address and the temporary password.
2. Change your password straight away, then delete this email. Use at least 12 characters, and do not reuse an old one.
3. Add your signature using the signature template we shared with you.
4. Send a test email to ${testEmail} and check that it arrives.

Keep your account safe:
- Never share your password, even with colleagues or IT.
- We will never ask for your password by email or message.
- Be careful with unexpected links and attachments, and report anything suspicious.
- Use this account for company work only.

Cannot sign in or need help? Reply to this email or contact ${adminContactName} at ${adminContactEmail}.

Welcome aboard,
${adminContactName}
${adminTitle}, Brosdev Solutions

--
Secured by Maildock · Your own email, on your own domains.
This email is confidential and intended only for ${firstName}. If you received it by mistake, please tell us and delete it.`;

  return { subject, html, text };
}

async function findOutboundProvider(db: D1Database, fromDomain: string): Promise<ProviderRow | null> {
  const domain = await first<{ id: number; provider_id: number | null }>(db, 'SELECT id, provider_id FROM domains WHERE name = ?', fromDomain);
  const rows = await all<ProviderRow & { pd_status: string | null }>(
    db,
    `SELECT p.*, pd.status AS pd_status FROM providers p LEFT JOIN provider_domains pd ON pd.provider_id = p.id AND pd.domain_id = ?
     ORDER BY (p.id = ?) DESC, p.is_default DESC, p.priority, p.created_at`,
    domain?.id ?? -1,
    domain?.provider_id ?? -1,
  );
  if (!rows.length) return null;
  const usable = rows.filter((p) => !PROVIDER_INFO[p.type].hasDomainApi || p.pd_status === 'verified');
  return usable[0] ?? null;
}

export async function createInvitationToken(
  db: D1Database,
  userId: number,
  recipientEmail: string,
): Promise<{ id: number; token: string; expiresAt: number }> {
  const now = Date.now();
  const expiresAt = now + INVITATION_EXPIRY_MS;
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);

  // Invalidate any existing pending/sent invitations for this user
  await run(db, "UPDATE user_invitations SET status = 'expired' WHERE user_id = ? AND status IN ('pending', 'sent')", userId);

  const res = await run(
    db,
    'INSERT INTO user_invitations (user_id, token_hash, recipient_email, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId,
    tokenHash,
    recipientEmail.toLowerCase().trim(),
    'pending',
    expiresAt,
    now,
  );

  return { id: res.meta.last_row_id as number, token, expiresAt };
}

export async function sendInvitation(
  env: Env,
  actor: SessionUser | null,
  userId: number,
  overrideAlternateEmail?: string | null,
  origin?: string,
  ip = '127.0.0.1',
  customPassword?: string,
): Promise<{ ok: boolean; status: 'sent' | 'failed'; error?: string; password?: string; sentAt: number }> {
  const user = await getUser(env.DB, userId);
  const settings = await loadSettings(env.DB);
  const now = Date.now();

  // Check rate limiting on resending invitations
  const latest = await first<UserInvitationRow>(
    env.DB,
    'SELECT * FROM user_invitations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    userId,
  );
  if (latest?.sent_at && now - latest.sent_at < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - latest.sent_at)) / 1000);
    throw tooMany(`Please wait ${waitSec} second${waitSec === 1 ? '' : 's'} before resending an invitation.`, waitSec);
  }

  const recipientEmail = (overrideAlternateEmail?.trim() || user.alternate_email || '').toLowerCase().trim();
  if (!recipientEmail || !isValidAddress(recipientEmail)) {
    throw badRequest('Please provide a valid alternate email address to receive the credentials.', 'no_recipient_email');
  }

  const blockCheck = await isSenderBlocked(env.DB, null, recipientEmail);
  if (blockCheck.blocked) {
    throw badRequest(
      `Cannot send login credentials to "${recipientEmail}": this address or domain is in the Blocked Senders list (${blockCheck.pattern}). Unblock it in Settings > Blocked senders if you need to deliver credentials.`,
      'recipient_blocked',
    );
  }

  // Update user's alternate_email if changed
  if (overrideAlternateEmail && overrideAlternateEmail.trim().toLowerCase() !== user.alternate_email?.toLowerCase()) {
    await run(env.DB, 'UPDATE users SET alternate_email = ? WHERE id = ?', recipientEmail, userId);
  }

  // Password handling: use provided password or generate a secure random one
  const password = customPassword?.trim() || generatePassword();
  const problem = passwordProblem(password);
  if (problem) throw badRequest(problem, 'weak_password');

  // Update the user's password in the database and ensure must_change_password = 1
  const passwordHash = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').bind(passwordHash, userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
  ]);

  const { id: invitationId } = await createInvitationToken(env.DB, userId, recipientEmail);

  const baseOrigin = settings.appUrl || origin || 'http://localhost:5173';
  const webmailUrl = baseOrigin.replace(/\/+$/, '');
  const fromDomain = domainOf(user.email);

  const emailContent = renderInvitationEmail({
    userName: user.name,
    mailboxEmail: user.email,
    webmailUrl,
    password,
    instanceName: settings.instanceName,
    senderName: actor?.name,
    senderEmail: actor?.email || `admin@${fromDomain}`,
  });
  const from: Address = {
    name: settings.instanceName || 'Maildock',
    address: `no-reply@${fromDomain}`,
  };
  const to: Address[] = [{ name: user.name || recipientEmail, address: recipientEmail }];
  const messageId = newMessageId(fromDomain);

  let deliveryStatus: 'sent' | 'failed' = 'sent';
  let deliveryError: string | undefined;

  try {
    const provider = await findOutboundProvider(env.DB, fromDomain);
    if (provider) {
      const adapter = await adapterFor(env, provider);
      const raw = buildMime({
        from,
        to,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        messageId,
        date: new Date(now),
      });
      const outgoing: OutgoingMessage = {
        from,
        to,
        cc: [],
        bcc: [],
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        messageId,
        references: [messageId],
        attachments: [],
        raw,
      };
      await adapter.send(outgoing);
      log('invitation.sent', { userId, recipient: recipientEmail, provider: provider.type });
    } else {
      // In local development or before an outbound provider is set up, simulate delivery
      log('invitation.simulated', { userId, recipient: recipientEmail, password });
    }
  } catch (err) {
    deliveryStatus = 'failed';
    deliveryError = errorMessage(err);
    logError('invitation.delivery_failed', err, { userId, recipient: recipientEmail });
  }

  await run(
    env.DB,
    'UPDATE user_invitations SET status = ?, error = ?, sent_at = ? WHERE id = ?',
    deliveryStatus,
    deliveryError ?? null,
    now,
    invitationId,
  );

  if (actor) {
    await audit(env.DB, {
      userId: actor.id,
      action: 'user.invitation_sent',
      target: user.email,
      details: { recipientEmail, status: deliveryStatus, error: deliveryError },
      ip,
    });
  }

  return {
    ok: deliveryStatus === 'sent',
    status: deliveryStatus,
    error: deliveryError,
    password,
    sentAt: now,
  };
}

export async function verifyInvitation(
  db: D1Database,
  token: string,
): Promise<{ ok: boolean; name: string; email: string; expiresAt: number }> {
  if (!token?.trim()) throw badRequest('Missing activation token.');
  const tokenHash = await sha256Hex(token.trim());

  const row = await first<UserInvitationRow & { name: string; email: string; user_status: string }>(
    db,
    `SELECT ui.*, u.name, u.email, u.status AS user_status 
     FROM user_invitations ui 
     JOIN users u ON u.id = ui.user_id 
     WHERE ui.token_hash = ?`,
    tokenHash,
  );

  if (!row) throw notFound('This invitation link is invalid or has expired.');
  if (row.status === 'accepted') throw badRequest('This invitation has already been accepted.', 'invitation_accepted');
  if (row.expires_at < Date.now()) {
    await run(db, "UPDATE user_invitations SET status = 'expired' WHERE id = ?", row.id);
    throw badRequest('This invitation link has expired. Please ask your administrator to send a new one.', 'invitation_expired');
  }

  return {
    ok: true,
    name: row.name,
    email: row.email,
    expiresAt: row.expires_at,
  };
}

export async function acceptInvitation(
  env: Env,
  token: string,
  password: string,
  ip: string,
): Promise<{ ok: boolean; email: string }> {
  const problem = passwordProblem(password);
  if (problem) throw badRequest(problem, 'weak_password');

  const tokenHash = await sha256Hex(token.trim());
  const now = Date.now();

  const row = await first<UserInvitationRow & { name: string; email: string; user_id: number }>(
    env.DB,
    `SELECT ui.*, u.name, u.email 
     FROM user_invitations ui 
     JOIN users u ON u.id = ui.user_id 
     WHERE ui.token_hash = ?`,
    tokenHash,
  );

  if (!row) throw notFound('This invitation link is invalid or has expired.');
  if (row.status === 'accepted') throw badRequest('This invitation has already been accepted.', 'invitation_accepted');
  if (row.expires_at < now) {
    await run(env.DB, "UPDATE user_invitations SET status = 'expired' WHERE id = ?", row.id);
    throw badRequest('This invitation link has expired. Please ask your administrator to send a new one.', 'invitation_expired');
  }

  const passwordHash = await hashPassword(password);

  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, status = ? WHERE id = ?').bind('active', row.user_id),
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, row.user_id),
    env.DB.prepare("UPDATE user_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?").bind(now, row.id),
    env.DB.prepare("UPDATE user_invitations SET status = 'expired' WHERE user_id = ? AND id != ? AND status IN ('pending', 'sent')").bind(row.user_id, row.id),
    auditStmt(env.DB, { userId: row.user_id, action: 'user.invitation_accepted', target: row.email, ip }),
  ]);

  return { ok: true, email: row.email };
}

export function renderPasswordResetEmail({
  userName,
  mailboxEmail,
  webmailUrl,
  password,
  senderName,
  senderEmail,
}: {
  userName: string;
  mailboxEmail: string;
  webmailUrl: string;
  password: string;
  senderName?: string;
  senderEmail?: string;
}): { subject: string; html: string; text: string } {
  const subject = 'Password Reset - Your Temporary Password';
  const domain = mailboxEmail.includes('@') ? mailboxEmail.split('@')[1] : 'yourdomain.com';
  const firstName = userName?.trim() ? userName.trim().split(/\s+/)[0] : mailboxEmail.split('@')[0];
  const loginUrl = `${webmailUrl.replace(/\/+$/, '')}/login`;
  const adminContactName = senderName?.trim() || 'Administrator';
  const adminContactEmail = senderEmail?.trim() || `admin@${domain}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;">
<!-- Hidden preview text shown in the inbox list -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f5f5f5;">Your temporary password for Brosdev Solutions email account.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
<tr><td align="center" style="padding:24px 12px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#000000;">

  <!-- Header -->
  <tr><td style="background:#000000;padding:26px 32px;border-bottom:4px solid #A90706;">
    <div style="font-size:22px;font-weight:bold;letter-spacing:3px;color:#ffffff;">BROSDEV</div>
    <div style="font-size:11px;letter-spacing:2px;color:#8A8A8A;">SOLUTIONS</div>
  </td></tr>

  <!-- Title -->
  <tr><td style="padding:36px 32px 8px 32px;">
    <div style="display:inline-block;background:#fef2f2;border:1px solid #fecaca;color:#A90706;font-size:12px;font-weight:bold;padding:3px 10px;border-radius:4px;margin-bottom:12px;letter-spacing:0.5px;">SECURITY ALERT</div>
    <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:bold;color:#000000;">Password Reset Request</h1>
  </td></tr>

  <!-- Intro -->
  <tr><td style="padding:12px 32px 8px 32px;font-size:15px;line-height:1.6;color:#333333;">
    Hi ${firstName},<br><br>
    Your account password for Brosdev Solutions on Maildock has been reset by an administrator. Please use the temporary credentials below to sign in and set up your new password.
  </td></tr>

  <!-- Account details -->
  <tr><td style="padding:16px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;border-left:4px solid #A90706;">
      <tr><td style="padding:18px 20px;font-size:14px;line-height:1.8;color:#000000;">
        <span style="color:#555555;">Email address</span><br>
        <strong style="font-size:16px;">${mailboxEmail}</strong><br>
        <span style="color:#555555;">Sign-in page (Maildock)</span><br>
        <a href="${loginUrl}" style="color:#A90706;text-decoration:underline;">${loginUrl}</a><br>
        <span style="color:#555555;">Temporary password</span><br>
        <strong style="font-family:'Courier New',Courier,monospace;font-size:16px;letter-spacing:1px;background:#ffffff;border:1px solid #d9d9d9;padding:4px 10px;display:inline-block;margin-top:2px;">${password}</strong><br>
        <span style="font-size:12px;color:#A90706;font-weight:600;">You will be required to choose a new password the moment you sign in.</span>
      </td></tr>
    </table>
  </td></tr>

  <!-- Button -->
  <tr><td align="left" style="padding:8px 32px 24px 32px;">
    <a href="${loginUrl}" style="display:inline-block;background:#A90706;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 28px;">Sign in &amp; Choose New Password</a>
  </td></tr>

  <!-- Security steps -->
  <tr><td style="padding:0 32px 8px 32px;">
    <h2 style="margin:0 0 10px 0;font-size:18px;color:#000000;">Important Security Instructions</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.6;color:#333333;">
      <tr><td valign="top" style="padding:0 12px 10px 0;color:#A90706;font-weight:bold;">1.</td><td style="padding-bottom:10px;"><strong>Sign in immediately</strong> using the temporary password above.</td></tr>
      <tr><td valign="top" style="padding:0 12px 10px 0;color:#A90706;font-weight:bold;">2.</td><td style="padding-bottom:10px;"><strong>Create a strong password</strong> with at least 10 characters that you do not use on other services.</td></tr>
      <tr><td valign="top" style="padding:0 12px 10px 0;color:#A90706;font-weight:bold;">3.</td><td style="padding-bottom:10px;"><strong>Delete this email</strong> once you have successfully signed in and set your new password.</td></tr>
      <tr><td valign="top" style="padding:0 12px 10px 0;color:#A90706;font-weight:bold;">4.</td><td style="padding-bottom:10px;">If you did not expect this reset, contact your administrator right away.</td></tr>
    </table>
  </td></tr>

  <!-- Help -->
  <tr><td style="padding:20px 32px 28px 32px;font-size:14px;line-height:1.6;color:#333333;">
    Questions or need help? Contact ${adminContactName} at <a href="mailto:${adminContactEmail}" style="color:#A90706;">${adminContactEmail}</a>.<br><br>
    Regards,<br>
    <strong>${adminContactName}</strong><br>
    IT Administration, Brosdev Solutions
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#000000;padding:20px 32px;font-size:11px;line-height:1.6;color:#8A8A8A;">
    <span style="color:#ffffff;font-weight:bold;">Secured by Maildock</span> &middot; Your own email, on your own domains.<br><br>
    Brosdev Solutions<br>
    This automated security message is intended only for ${firstName}. If you received it by mistake, please notify us immediately and delete it.
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = `Password Reset - Your Temporary Password

Hi ${firstName},

Your account password for Brosdev Solutions on Maildock has been reset by an administrator.

Account details:
- Email address: ${mailboxEmail}
- Sign-in page (Maildock): ${loginUrl}
- Temporary password: ${password}
(You will be required to choose a new password the moment you sign in.)

Sign in to your account: ${loginUrl}

Security instructions:
1. Sign in immediately using the temporary password.
2. Create a strong password with at least 10 characters.
3. Delete this email once you have successfully updated your password.
4. If you did not expect this reset, contact your administrator immediately.

Need help? Contact ${adminContactName} at ${adminContactEmail}.

Regards,
${adminContactName}
IT Administration, Brosdev Solutions

--
Secured by Maildock · Your own email, on your own domains.
This automated security message is intended only for ${firstName}.`;

  return { subject, html, text };
}

export async function sendPasswordReset(
  env: Env,
  actor: SessionUser | null,
  userId: number,
  overrideAlternateEmail?: string | null,
  origin?: string,
  ip = '127.0.0.1',
  customPassword?: string,
): Promise<{ ok: boolean; status: 'sent' | 'failed'; error?: string; password: string; sentAt: number; recipientEmail: string }> {
  const user = await getUser(env.DB, userId);
  const settings = await loadSettings(env.DB);
  const now = Date.now();

  const recipientEmail = (overrideAlternateEmail?.trim() || user.alternate_email || '').toLowerCase().trim();
  if (!recipientEmail || !isValidAddress(recipientEmail)) {
    throw badRequest('Please provide a valid alternate email address to receive the password reset.', 'no_recipient_email');
  }

  const blockCheck = await isSenderBlocked(env.DB, null, recipientEmail);
  if (blockCheck.blocked) {
    throw badRequest(
      `Cannot send password reset to "${recipientEmail}": this address or domain is in the Blocked Senders list (${blockCheck.pattern}). Unblock it in Settings > Blocked senders if you need to deliver credentials.`,
      'recipient_blocked',
    );
  }

  // Update user's alternate_email if changed
  if (overrideAlternateEmail && overrideAlternateEmail.trim().toLowerCase() !== user.alternate_email?.toLowerCase()) {
    await run(env.DB, 'UPDATE users SET alternate_email = ? WHERE id = ?', recipientEmail, userId);
  }

  // Password handling
  const password = customPassword?.trim() || generatePassword();
  const problem = passwordProblem(password);
  if (problem) throw badRequest(problem, 'weak_password');

  // Update the user's password in the database and ensure must_change_password = 1
  const passwordHash = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').bind(passwordHash, userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
  ]);

  const baseOrigin = settings.appUrl || origin || 'http://localhost:5173';
  const webmailUrl = baseOrigin.replace(/\/+$/, '');
  const fromDomain = domainOf(user.email);

  const emailContent = renderPasswordResetEmail({
    userName: user.name,
    mailboxEmail: user.email,
    webmailUrl,
    password,
    senderName: actor?.name,
    senderEmail: actor?.email || `admin@${fromDomain}`,
  });

  const from: Address = {
    name: settings.instanceName || 'Maildock',
    address: `no-reply@${fromDomain}`,
  };
  const to: Address[] = [{ name: user.name || recipientEmail, address: recipientEmail }];
  const messageId = newMessageId(fromDomain);

  let deliveryStatus: 'sent' | 'failed' = 'sent';
  let deliveryError: string | undefined;

  try {
    const provider = await findOutboundProvider(env.DB, fromDomain);
    if (provider) {
      const adapter = await adapterFor(env, provider);
      const raw = buildMime({
        from,
        to,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        messageId,
        date: new Date(now),
      });
      const outgoing: OutgoingMessage = {
        from,
        to,
        cc: [],
        bcc: [],
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        messageId,
        references: [messageId],
        attachments: [],
        raw,
      };
      await adapter.send(outgoing);
      log('password_reset.sent', { userId, recipient: recipientEmail, provider: provider.type });
    } else {
      log('password_reset.simulated', { userId, recipient: recipientEmail, password });
    }
  } catch (err) {
    deliveryStatus = 'failed';
    deliveryError = errorMessage(err);
    logError('password_reset.delivery_failed', err, { userId, recipient: recipientEmail });
  }

  if (actor) {
    await audit(env.DB, {
      userId: actor.id,
      action: 'user.password_reset',
      target: user.email,
      details: { recipientEmail, status: deliveryStatus, error: deliveryError },
      ip,
    });
  }

  return {
    ok: deliveryStatus === 'sent',
    status: deliveryStatus,
    error: deliveryError,
    password,
    sentAt: now,
    recipientEmail,
  };
}


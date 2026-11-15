-- User designation and signature customization policy
ALTER TABLE users ADD COLUMN designation TEXT;
ALTER TABLE users ADD COLUMN signature_changeable INTEGER NOT NULL DEFAULT 1;

-- Default signature template and policy in settings
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES 
  ('signature.template', '<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.4; color: #222222;"><tr><td style="border-left: 3px solid #A90706; padding-left: 12px;"><div style="font-size: 15px; font-weight: bold; color: #000000; letter-spacing: 0.5px;">{{.employee name}}</div><div style="font-size: 12px; font-weight: 600; color: #A90706; text-transform: uppercase; margin-top: 2px;">{{.designation}}</div><div style="font-size: 12px; color: #666666; margin-top: 6px;">{{.company}}</div><div style="margin-top: 4px; font-size: 12px;"><a href="mailto:{{.email}}" style="color: #A90706; text-decoration: none;">{{.email}}</a></div></td></tr></table>', 1700000000000),
  ('signature.enabled', '1', 1700000000000),
  ('signature.editable_default', '1', 1700000000000);

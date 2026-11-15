import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Eye, Lock, PenLine, RefreshCw, RotateCcw, Sparkles, Users, Variable } from 'lucide-react';
import { get, post, put } from '../../lib/api';
import { useAction, useInvalidate } from '../../lib/hooks';
import { cleanSignature } from '../../lib/sanitize';
import { renderSignatureTemplate } from '../../../shared/signature';
import type { UserSummary } from '../../lib/types';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Select, Switch, Textarea } from '../../components/ui/form';
import { Alert, Badge, Card, CardHeader, PageHeader, PageSpinner } from '../../components/ui/misc';
import { ConfirmDialog, useToast } from '../../components/ui/overlay';

interface SignatureConfig {
  template: string;
  enabled: boolean;
  editableDefault: boolean;
}

const PRESET_TEMPLATES = [
  {
    id: 'brosdev',
    name: 'Brosdev Signature (Red & Black)',
    description: 'Professional branded template with red accent border and clean hierarchy.',
    template: `<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.4; color: #222222;">
  <tr>
    <td style="border-left: 3px solid #A90706; padding-left: 12px;">
      <div style="font-size: 15px; font-weight: bold; color: #000000; letter-spacing: 0.5px;">{{.employee name}}</div>
      <div style="font-size: 12px; font-weight: 600; color: #A90706; text-transform: uppercase; margin-top: 2px;">{{.designation}}</div>
      <div style="font-size: 12px; color: #666666; margin-top: 6px;">{{.company}}</div>
      <div style="margin-top: 4px; font-size: 12px;">
        <a href="mailto:{{.email}}" style="color: #A90706; text-decoration: none;">{{.email}}</a>
      </div>
    </td>
  </tr>
</table>`,
  },
  {
    id: 'minimal',
    name: 'Minimal Clean',
    description: 'Simple and modern single-paragraph signature with inline dividers.',
    template: `<p style="font-family: Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #333333; margin: 0;">
  <strong style="color: #111111;">{{.employee name}}</strong><br>
  <span style="color: #666666;">{{.designation}} &middot; {{.company}}</span><br>
  <a href="mailto:{{.email}}" style="color: #A90706; text-decoration: none;">{{.email}}</a>
</p>`,
  },
  {
    id: 'corporate',
    name: 'Corporate Card',
    description: 'Formal corporate signature with top divider line and high-contrast typography.',
    template: `<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #222222; border-top: 1px solid #e0e0e0; padding-top: 10px; margin-top: 8px;">
  <tr>
    <td>
      <span style="font-size: 16px; font-weight: bold; color: #000000;">{{.employee name}}</span><br>
      <span style="color: #777777; font-size: 13px;">{{.designation}}</span><br>
      <span style="color: #333333; font-weight: 500;">{{.company}}</span> &middot; <a href="mailto:{{.email}}" style="color: #A90706; text-decoration: none;">{{.email}}</a>
    </td>
  </tr>
</table>`,
  },
];

const TEMPLATE_VARIABLES = [
  { tag: '{{.employee name}}', label: 'Employee Name', example: 'Jane Doe' },
  { tag: '{{.designation}}', label: 'Designation / Title', example: 'Software Engineer' },
  { tag: '{{.email}}', label: 'Mailbox Email', example: 'jane@yourdomain.com' },
  { tag: '{{.company}}', label: 'Company / Organization', example: 'Brosdev Solutions' },
  { tag: '{{.phone}}', label: 'Phone Number', example: '+1 (555) 019-2834' },
  { tag: '{{.website}}', label: 'Website / App URL', example: 'brosdev.com' },
];

export function SignaturesPage() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { run, busy } = useAction();
  const configQuery = useQuery({ queryKey: ['admin', 'signatures'], queryFn: () => get<SignatureConfig>('/admin/signatures') });
  const usersQuery = useQuery({ queryKey: ['admin', 'users'], queryFn: () => get<UserSummary[]>('/admin/users') });

  const [template, setTemplate] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [editableDefault, setEditableDefault] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<number | 'sample'>('sample');
  const [confirmSyncAll, setConfirmSyncAll] = useState(false);
  const [syncUpdatePermissions, setSyncUpdatePermissions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (configQuery.data) {
      setTemplate(configQuery.data.template);
      setEnabled(configQuery.data.enabled);
      setEditableDefault(configQuery.data.editableDefault);
    }
  }, [configQuery.data]);

  const users = usersQuery.data ?? [];
  const selectedUser = useMemo(() => {
    if (selectedUserId === 'sample') {
      return {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        designation: 'Senior Solutions Architect',
        company: 'Brosdev Solutions',
      };
    }
    const u = users.find((x) => x.id === selectedUserId);
    return {
      name: u?.name || 'Employee Name',
      email: u?.email || 'employee@example.com',
      designation: u?.designation || 'Team Member',
      company: 'Brosdev Solutions',
    };
  }, [selectedUserId, users]);

  const previewHtml = useMemo(() => {
    return cleanSignature(
      renderSignatureTemplate(template, {
        name: selectedUser.name,
        email: selectedUser.email,
        designation: selectedUser.designation,
        company: selectedUser.company,
      }),
    );
  }, [template, selectedUser]);

  const insertVariable = (tag: string) => {
    const el = textareaRef.current;
    if (!el) {
      setTemplate((prev) => prev + tag);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.substring(0, start) + tag + el.value.substring(end);
    setTemplate(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  const handleSave = () => {
    run(
      'save',
      () =>
        put('/admin/signatures', {
          template,
          enabled,
          editableDefault,
        }).then(() => {
          invalidate(['admin', 'signatures']);
          toast.success('Signature settings saved');
        }),
      'Signature settings saved',
    );
  };

  const handleApplyAll = async () => {
    setConfirmSyncAll(false);
    run(
      'apply-all',
      async () => {
        const res = await post<{ ok: boolean; usersCount: number; mailboxesCount: number }>('/admin/signatures/apply-all', {
          template,
          updateChangeable: syncUpdatePermissions ? editableDefault : undefined,
        });
        await invalidate(['admin', 'signatures'], ['admin', 'users'], ['mailboxes']);
        toast.success(`Signature applied to ${res.mailboxesCount} mailboxes across ${res.usersCount} users`);
      },
      'Signatures synchronized across mailboxes',
    );
  };

  if (configQuery.isLoading) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email Signatures"
        description="Design company-wide email signatures with employee variables and manage whether employees can edit their signatures."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              loading={busy === 'apply-all'}
              onClick={() => setConfirmSyncAll(true)}
            >
              Apply to all inboxes
            </Button>
            <Button
              variant="primary"
              loading={busy === 'save'}
              onClick={handleSave}
            >
              Save changes
            </Button>
          </div>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Editor and template options */}
        <div className="space-y-6">
          <Card>
            <CardHeader
              icon={<PenLine className="h-5 w-5" />}
              title="Signature template"
              description="Define the HTML signature template. Dynamic employee variables will be replaced automatically."
            />
            <div className="space-y-4 p-5">
              {/* Presets */}
              <div>
                <label className="text-xs font-medium text-muted block mb-1.5">Preset templates</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {PRESET_TEMPLATES.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setTemplate(preset.template)}
                      className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-surface-2"
                    >
                      <span className="text-xs font-semibold text-fg">{preset.name}</span>
                      <span className="text-[11px] text-muted line-clamp-2 leading-snug">{preset.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Variables Chips */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted flex items-center gap-1.5">
                    <Variable className="h-3.5 w-3.5" />
                    Insert dynamic tags
                  </label>
                  <span className="text-[11px] text-faint">Click tag to insert at cursor</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.tag}
                      type="button"
                      onClick={() => insertVariable(v.tag)}
                      title={`Insert ${v.label} (e.g. "${v.example}")`}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-mono font-medium text-fg transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary-text"
                    >
                      <span>{v.tag}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea Editor */}
              <Field label="Template HTML" hint="Supports standard HTML tables, formatting, inline styling, images and links. Scripts and unsafe tags are removed.">
                <Textarea
                  ref={textareaRef}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  rows={12}
                  className="font-mono text-xs leading-relaxed"
                  placeholder="<p><strong>{{.employee name}}</strong><br>{{.designation}}</p>"
                />
              </Field>
            </div>
          </Card>

          {/* Permissions & Policies */}
          <Card>
            <CardHeader
              icon={<Lock className="h-5 w-5" />}
              title="Employee signature policies"
              description="Control how signatures behave across all mailboxes and employees."
            />
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3.5">
                <div className="min-w-0 pr-4">
                  <div className="text-[13px] font-medium text-fg">Signature template active</div>
                  <div className="text-xs text-muted">Automatically populate new user mailboxes with the company signature.</div>
                </div>
                <Switch checked={enabled} onChange={setEnabled} label="Signature enabled" />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3.5">
                <div className="min-w-0 pr-4">
                  <div className="text-[13px] font-medium text-fg">
                    {editableDefault ? 'Signatures are changeable by default' : 'Signatures are locked (non-changeable)'}
                  </div>
                  <div className="text-xs text-muted">
                    {editableDefault
                      ? 'Employees can edit and customize their own signatures in Webmail settings.'
                      : 'Employees cannot edit their signatures. The company template is strictly enforced.'}
                  </div>
                </div>
                <Switch checked={editableDefault} onChange={setEditableDefault} label="Editable by default" />
              </div>

              <div className="text-xs text-faint flex items-center gap-1.5">
                <span>Tip: You can also override the signature lock for specific employees inside their individual user panels.</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Live Preview Column */}
        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader
              icon={<Eye className="h-5 w-5" />}
              title="Live interactive preview"
              description="See how the signature renders in outgoing email messages."
              action={
                <Badge tone="primary" pill>
                  Live Preview
                </Badge>
              }
            />
            <div className="space-y-4 p-5">
              <Field label="Preview with employee details">
                <Select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value === 'sample' ? 'sample' : Number(e.target.value))}
                >
                  <option value="sample">Sample Employee (Jane Doe · Solutions Architect)</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.email} {u.designation ? `(${u.designation})` : '(No designation)'}
                    </option>
                  ))}
                </Select>
              </Field>

              {/* Resolved variables banner */}
              <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs space-y-1">
                <div className="font-semibold text-fg mb-1">Active preview values:</div>
                <div className="grid grid-cols-[100px_1fr] gap-1 text-muted">
                  <span className="text-faint">Name:</span>
                  <span className="font-medium text-fg">{selectedUser.name}</span>
                  <span className="text-faint">Designation:</span>
                  <span className="font-medium text-fg">{selectedUser.designation || <span className="text-warning italic">None set</span>}</span>
                  <span className="text-faint">Email:</span>
                  <span className="font-medium text-fg">{selectedUser.email}</span>
                  <span className="text-faint">Company:</span>
                  <span className="font-medium text-fg">{selectedUser.company}</span>
                </div>
              </div>

              {/* Rendered signature display */}
              <div>
                <div className="text-xs font-medium text-muted mb-1.5">Email signature output</div>
                <div className="min-h-[140px] rounded-xl border border-border bg-surface p-4 shadow-sm">
                  {previewHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  ) : (
                    <span className="text-xs text-faint italic">No template content. Type or select a preset on the left to see preview.</span>
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <Button
                  variant="secondary"
                  className="w-full justify-center"
                  icon={<RefreshCw className="h-4 w-4" />}
                  loading={busy === 'apply-all'}
                  onClick={() => setConfirmSyncAll(true)}
                >
                  Apply & sync this template to all mailboxes
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {confirmSyncAll && (
        <ConfirmDialog
          open
          onClose={() => setConfirmSyncAll(false)}
          title="Apply signature template to all inboxes?"
          confirmLabel="Apply to all inboxes"
          loading={busy === 'apply-all'}
          onConfirm={handleApplyAll}
        >
          <div className="space-y-3 text-[13px]">
            <p>
              This will render and update the signature on all existing employee mailboxes using their respective names, designations, and email addresses.
            </p>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <Checkbox
                checked={syncUpdatePermissions}
                onChange={setSyncUpdatePermissions}
                label={`Also set all member accounts to ${editableDefault ? 'Changeable' : 'Locked'}`}
                hint={editableDefault ? 'Employees will be allowed to modify their signatures' : 'Employees will be prevented from editing their signatures in Webmail'}
              />
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Card, Dialog, Field, Input, PageHeader, QueryView, Select, SkeletonRows, cn, td, th } from "@/components/ui";
import { CopyField, Empty, StatusPill, usePermissions } from "@/components/platform/kit";
import { del, get, patch, post } from "@/lib/api";
import { ago, dateTime, initials } from "@/lib/format";
import { useAction, useMe } from "@/lib/hooks";
import type { InviteResult, Member, Role } from "@/lib/platform-ops-types";

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything, including deleting the workspace." },
  { value: "admin", label: "Admin", description: "Everything except deleting the workspace or changing the owner." },
  { value: "developer", label: "Developer", description: "Build agents and workflows, run them, manage integrations and data." },
  { value: "operator", label: "Operator", description: "Run agents, approve content and edit data." },
  { value: "analyst", label: "Analyst", description: "Read-only, plus usage and the audit log." },
  { value: "viewer", label: "Viewer", description: "Read-only access." },
];
const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? r;

export default function MembersPage() {
  const perms = usePermissions();
  const me = useMe();
  const reason = perms.reason("members.manage");
  const members = useQuery({ queryKey: ["members"], queryFn: () => get<{ items: Member[] }>("/members") });
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);

  const changeRole = useAction(({ m, role }: { m: Member; role: Role }) => patch<Member>(`/members/${m.id}`, { role }), {
    success: (r) => `${r.name || r.email} is now ${roleLabel(r.role).toLowerCase()}`,
    invalidate: [["members"], ["me"]],
  });
  const remove = useAction((m: Member) => del(`/members/${m.id}`), {
    success: (_r, m) => `${m.name || m.email} removed`,
    invalidate: [["members"]],
    onSuccess: () => setRemoving(null),
  });

  const myEmail = me.data?.user.email;

  return (
    <div className="mx-auto max-w-[1040px]">
      <PageHeader
        title="Members"
        subtitle="Who can open this workspace and what they can do."
        actions={
          <Button variant="primary" size="md" icon={<UserPlus className="size-4" />} disabledReason={reason} onClick={() => setInviting(true)}>
            Invite member
          </Button>
        }
      />

      <QueryView
        query={members}
        skeleton={
          <Card>
            <SkeletonRows rows={5} />
          </Card>
        }
        isEmpty={(d) => d.items.length === 0}
        empty={<Empty icon={<Users />} title="No members yet" body="Invite your team. Each person gets a role that decides what they can change." />}
      >
        {(d) => (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Member</th>
                  <th className={th}>Role</th>
                  <th className={th}>Status</th>
                  <th className={th}>Last login</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((m) => {
                  const isMe = m.email === myEmail;
                  return (
                    <tr key={m.id} className="border-b border-line last:border-0">
                      <td className={cn(td, "py-3")}>
                        <div className="flex items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11.5px] font-semibold text-accent" aria-hidden>
                            {initials(m.name || m.email)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {m.name || m.email.split("@")[0]}
                              {isMe ? <span className="ml-1.5 text-xs font-normal text-muted">(you)</span> : null}
                            </p>
                            <p className="truncate text-xs text-muted">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className={cn(td, "py-3")}>
                        <span title={reason ?? undefined}>
                          <Select
                            aria-label={`Role of ${m.email}`}
                            className="h-8 w-[140px]"
                            value={m.role}
                            disabled={Boolean(reason) || changeRole.isPending}
                            onChange={(e) => changeRole.mutate({ m, role: e.target.value as Role })}
                          >
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </Select>
                        </span>
                      </td>
                      <td className={cn(td, "py-3")}>
                        <StatusPill status={m.status} />
                      </td>
                      <td className={cn(td, "py-3 text-ink-2")} title={m.last_login_at ? dateTime(m.last_login_at) : undefined}>
                        {m.last_login_at ? ago(m.last_login_at) : "Never"}
                      </td>
                      <td className={cn(td, "py-3 text-right")}>
                        <Button variant="ghost" aria-label={`Remove ${m.email}`} title="Remove" icon={<Trash2 className="size-3.5" />} disabledReason={reason} onClick={() => setRemoving(m)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </QueryView>

      {inviting ? <InviteDialog onClose={() => setInviting(false)} /> : null}

      <Dialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        size="sm"
        title="Remove member?"
        description={removing ? `${removing.name || removing.email} loses access to this workspace.` : undefined}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing)}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">Their account stays, so you can invite them again later. Their past actions remain in the audit log.</p>
      </Dialog>
    </div>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const [result, setResult] = useState<InviteResult | null>(null);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const invite = useAction(() => post<InviteResult>("/members", { email: email.trim(), name: name.trim() || undefined, role }), {
    success: (r) => `${r.member.email} invited`,
    invalidate: [["members"]],
    onSuccess: (r) => setResult(r),
  });

  if (result) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Member added"
        description={`${result.member.email} · ${roleLabel(result.member.role)}`}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        {result.temp_password ? (
          <div className="space-y-4">
            <p className="text-[13px] text-ink-2">Share this one-time password with them privately. They sign in with their email and this password, then choose their own.</p>
            <CopyField label="Password" value={result.temp_password} />
            <Banner tone="warn" title="Shown only once">
              Copy it now. If it&apos;s lost, remove and invite them again.
            </Banner>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">They already have a LayerFlow account, so they can sign in with their existing password and switch to this workspace.</p>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite member"
      description="New people get a one-time password to sign in."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={invite.isPending} disabledReason={validEmail ? null : "Enter a valid email address"} onClick={() => invite.mutate(undefined)}>
            Invite
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (validEmail) invite.mutate(undefined);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" />
          </Field>
          <Field label="Name (optional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha Verma" autoComplete="off" />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-ink-2">Role</legend>
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {ROLES.map((r) => (
              <label key={r.value} className={cn("flex cursor-pointer items-start gap-3 px-3 py-2.5", role === r.value ? "bg-accent-soft" : "hover:bg-surface-2")}>
                <input type="radio" name="role" className="mt-0.5 size-3.5 accent-[var(--accent)]" checked={role === r.value} onChange={() => setRole(r.value)} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{r.label}</span>
                  <span className="block text-xs text-ink-2">{r.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

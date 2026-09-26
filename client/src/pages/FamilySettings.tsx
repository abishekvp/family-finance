import { useEffect, useState, type FormEvent } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, ClipboardCheck, Copy, Mail, Users } from "lucide-react";
import { api } from "../api/client";
import { getErrorMessage } from "../api/errors";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Select,
  Toggle,
  useToast,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import type { LayoutContext } from "../components/Layout";
import { useOutletContext } from "react-router-dom";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
  joinedAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  inviteLink: string;
  expiresAt: string;
}

const ROLE_TONE: Record<Member["role"], "brand" | "info" | "neutral"> = {
  ADMIN: "brand",
  MEMBER: "info",
  VIEWER: "neutral",
};

const ROLE_HINTS: Record<string, string> = {
  ADMIN: "Full control — manage members, categories, budgets and accounts.",
  MEMBER: "Can add and edit transactions, accounts and categories.",
  VIEWER: "Read-only access to family data.",
};

export function FamilySettings() {
  const { family } = useOutletContext<LayoutContext>();
  const toast = useToast();
  const { refreshUser } = useAuth();
  const isAdmin = family.role === "ADMIN";
  const [isSavingApproval, setIsSavingApproval] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"MEMBER" | "VIEWER" | "ADMIN">("MEMBER");
  const [lastInvite, setLastInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  async function loadMembers() {
    const [membersRes, invitesRes] = await Promise.all([
      api.get<Member[]>(`/families/${family.id}/members`),
      api.get<Invite[]>(`/families/${family.id}/invites`).catch(() => ({ data: [] as Invite[] })),
    ]);
    setMembers(membersRes.data);
    setPendingInvites(invitesRes.data);
  }

  useEffect(() => {
    loadMembers().catch((err) => setError(getErrorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsInviting(true);
    try {
      const res = await api.post<Invite>(`/families/${family.id}/invites`, {
        email: inviteEmail,
        role: inviteRole,
      });
      setLastInvite(res.data);
      setCopied(false);
      setInviteEmail("");
      await loadMembers();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to send invite"));
    } finally {
      setIsInviting(false);
    }
  }

  async function setRequireApproval(next: boolean) {
    setIsSavingApproval(true);
    try {
      await api.patch(`/families/${family.id}`, { requireApproval: next });
      await refreshUser();
      toast(next ? "Approvals turned on" : "Approvals turned off");
    } catch (err) {
      toast(getErrorMessage(err, "Unable to change approvals"), "error");
    } finally {
      setIsSavingApproval(false);
    }
  }

  async function copyLink() {
    if (!lastInvite) return;
    try {
      await navigator.clipboard.writeText(lastInvite.inviteLink);
      setCopied(true);
      toast("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Couldn't copy automatically — select and copy the link manually", "error");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <CardHeader title="Members" subtitle={`${members.length} in ${family.name}`} icon={<Users size={17} />} />
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 py-3">
              <Avatar name={m.name} size={38} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{m.name}</p>
                <p className="truncate text-xs text-ink-subtle">{m.email}</p>
              </div>
              <div className="shrink-0 text-right">
                <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>
                <p className="mt-1 text-2xs text-ink-subtle">
                  Joined {formatDistanceToNow(new Date(m.joinedAt), { addSuffix: true })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Transaction approval" icon={<ClipboardCheck size={17} />} />
        <Toggle
          checked={!!family.requireApproval}
          disabled={!isAdmin || isSavingApproval}
          onChange={setRequireApproval}
          label="Require approval for members' transactions"
          description={
            <>
              Transactions members add to shared accounts are saved right away but only count toward balances, budgets and
              totals once an admin approves them. Admins' own transactions and members' private accounts aren't affected.
              {!isAdmin && " Only an admin can change this."}
            </>
          }
        />
      </Card>

      <Card>
        <CardHeader title="Invite a family member" icon={<Mail size={17} />} />
        <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
          <Field label="Email" className="min-w-[200px] flex-1">
            {(props) => (
              <Input {...props} type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            )}
          </Field>
          <Field label="Role" className="w-36">
            {(props) => (
              <Select {...props} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}>
                <option value="ADMIN">Admin</option>
                <option value="MEMBER">Member</option>
                <option value="VIEWER">Viewer</option>
              </Select>
            )}
          </Field>
          <Button type="submit" loading={isInviting}>
            Send invite
          </Button>
        </form>
        <p className="mt-2 text-xs text-ink-subtle">{ROLE_HINTS[inviteRole]}</p>

        <ErrorText>{error}</ErrorText>

        {lastInvite && (
          <div className="mt-5 rounded-2xl border border-line bg-surface-sunken/60 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">Invite ready for {lastInvite.email}</p>
              <Badge tone="brand">{lastInvite.role}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-3 py-2 font-mono text-xs text-ink-muted">
                {lastInvite.inviteLink}
              </code>
              <Button size="sm" variant="secondary" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copyLink}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="mt-2 text-2xs text-ink-subtle">
              No email service is wired up yet — share this link with them directly.
            </p>
          </div>
        )}

        {pendingInvites.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Pending invites</p>
            <ul className="space-y-1.5">
              {pendingInvites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between rounded-lg bg-surface-sunken/50 px-3 py-2 text-sm">
                  <span className="truncate text-ink">{inv.email}</span>
                  <Badge tone="neutral">{inv.role}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {members.length <= 1 && pendingInvites.length === 0 && !lastInvite && (
          <EmptyState
            className="mt-5"
            title="Invite the rest of the family"
            description="Send an invite above to bring someone else into this workspace."
            icon={<Users size={18} />}
          />
        )}
      </Card>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import { getErrorMessage } from "../api/errors";
import { Button, Card, ErrorText, Input, Label } from "../components/ui";
import type { LayoutContext } from "../components/Layout";

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

export function FamilySettings() {
  const { family } = useOutletContext<LayoutContext>();
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"MEMBER" | "VIEWER" | "ADMIN">("MEMBER");
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
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
      setLastInviteLink(res.data.inviteLink);
      setInviteEmail("");
      await loadMembers();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to send invite"));
    } finally {
      setIsInviting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Members</h2>
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-slate-500">{m.email}</p>
              </div>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Invite a family member</h2>
        <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="ADMIN">Admin</option>
              <option value="MEMBER">Member</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>
          <Button type="submit" disabled={isInviting}>
            {isInviting ? "Sending..." : "Send invite"}
          </Button>
        </form>
        <ErrorText>{error}</ErrorText>
        {lastInviteLink && (
          <p className="mt-4 rounded-lg bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            No email service is wired up yet — share this link with them directly:
            <br />
            <span className="break-all font-mono">{lastInviteLink}</span>
          </p>
        )}

        {pendingInvites.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-slate-500">Pending invites</h3>
            <ul className="space-y-2">
              {pendingInvites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between text-sm">
                  <span>{inv.email}</span>
                  <span className="text-xs text-slate-400">{inv.role}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

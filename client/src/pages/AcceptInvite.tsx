import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MailX, PartyPopper } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { AuthShell } from "../components/AuthShell";
import { Badge, Button, EmptyState, ErrorText, Skeleton } from "../components/ui";

interface InviteDetails {
  email: string;
  role: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  family: { id: string; name: string };
}

const STATUS_MESSAGE: Record<string, string> = {
  ACCEPTED: "This invite has already been accepted.",
  EXPIRED: "This invite has expired — ask an admin to send a new one.",
  REVOKED: "This invite was revoked by an admin.",
};

export function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    api
      .get<InviteDetails>(`/invites/${token}`)
      .then((res) => setInvite(res.data))
      .catch((err) => setLoadError(getErrorMessage(err, "This invite link is invalid")));
  }, [token]);

  async function handleAccept() {
    setIsAccepting(true);
    setAcceptError(null);
    try {
      await api.post(`/invites/${token}/accept`);
      await refreshUser();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setAcceptError(getErrorMessage(err, "Unable to accept invite"));
    } finally {
      setIsAccepting(false);
    }
  }

  const isPending = invite?.status === "PENDING";

  return (
    <AuthShell title="Family invite" subtitle="You've been asked to join a household on Family Finance.">
      {loadError ? (
        <EmptyState
          title="This invite link isn't valid"
          description={loadError}
          icon={<MailX size={20} />}
          action={
            <Link to="/dashboard">
              <Button variant="secondary">Go to dashboard</Button>
            </Link>
          }
        />
      ) : !invite ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : (
        <div className="text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-500">
            <PartyPopper size={22} />
          </span>
          <h2 className="text-lg font-bold text-ink">Join {invite.family.name}</h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            You've been invited to join as{" "}
            <Badge tone="brand" className="normal-case">
              {invite.role.toLowerCase()}
            </Badge>
          </p>

          {isPending ? (
            <Button className="mt-6 w-full" size="lg" onClick={handleAccept} loading={isAccepting}>
              {isAccepting ? "Joining…" : "Accept invite"}
            </Button>
          ) : (
            <p className="mt-6 rounded-xl bg-expense-soft px-3.5 py-2.5 text-sm text-expense">
              {STATUS_MESSAGE[invite.status] ?? "This invite is no longer available."}
            </p>
          )}

          <div className="mt-4">
            <ErrorText>{acceptError}</ErrorText>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, ErrorText } from "../components/ui";

interface InviteDetails {
  email: string;
  role: string;
  status: string;
  family: { id: string; name: string };
}

export function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    api
      .get<InviteDetails>(`/invites/${token}`)
      .then((res) => setInvite(res.data))
      .catch((err) => setError(getErrorMessage(err, "This invite link is invalid")));
  }, [token]);

  async function handleAccept() {
    setIsAccepting(true);
    setError(null);
    try {
      await api.post(`/invites/${token}/accept`);
      await refreshUser();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Unable to accept invite"));
    } finally {
      setIsAccepting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm text-center">
        {invite ? (
          <>
            <h1 className="mb-1 text-xl font-semibold">Join {invite.family.name}</h1>
            <p className="mb-6 text-sm text-slate-500">
              You've been invited to join as a <span className="font-medium">{invite.role.toLowerCase()}</span>.
            </p>
            <Button className="w-full" onClick={handleAccept} disabled={isAccepting || invite.status !== "PENDING"}>
              {isAccepting ? "Joining..." : "Accept invite"}
            </Button>
          </>
        ) : (
          !error && <p className="text-sm text-slate-500">Loading invite...</p>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>
    </div>
  );
}

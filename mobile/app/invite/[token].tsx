import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MailX, PartyPopper } from "lucide-react-native";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Badge, Button, EmptyState, ErrorText, Screen, Skeleton } from "../../src/components/ui";

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

export default function AcceptInvite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, refreshUser } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
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
      router.replace("/");
    } catch (err) {
      setAcceptError(getErrorMessage(err, "Unable to accept invite"));
    } finally {
      setIsAccepting(false);
    }
  }

  if (!user) {
    return (
      <Screen>
        <EmptyState icon={<MailX size={20} color={colors.brand600} />} title="Sign in first" description="Sign in, then open this invite link again to accept it." />
      </Screen>
    );
  }

  const isPending = invite?.status === "PENDING";

  return (
    <Screen scroll>
      {loadError ? (
        <EmptyState icon={<MailX size={20} color={colors.brand600} />} title="This invite link isn't valid" description={loadError} />
      ) : !invite ? (
        <View style={{ gap: 10 }}>
          <Skeleton width="60%" height={20} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="100%" height={46} radius={12} />
        </View>
      ) : (
        <View style={{ alignItems: "center", gap: 12, paddingTop: 24 }}>
          <View style={{ width: 56, height: 56, borderRadius: 20, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <PartyPopper size={24} color={colors.brand600} />
          </View>
          <Text style={{ fontSize: 19, fontWeight: "900", color: colors.ink }}>Join {invite.family.name}</Text>
          <Badge tone="brand">{invite.role}</Badge>

          {isPending ? (
            <View style={{ width: "100%", marginTop: 12 }}>
              <Button title={isAccepting ? "Joining…" : "Accept invite"} size="lg" loading={isAccepting} onPress={handleAccept} />
            </View>
          ) : (
            <Text style={{ color: colors.expense, textAlign: "center", marginTop: 12 }}>
              {STATUS_MESSAGE[invite.status] ?? "This invite is no longer available."}
            </Text>
          )}

          <ErrorText>{acceptError}</ErrorText>
        </View>
      )}
    </Screen>
  );
}

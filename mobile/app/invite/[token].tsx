import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/context/AuthContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, ErrorText, colors } from "../../src/components/ui";

interface InviteDetails {
  email: string;
  role: string;
  status: string;
  family: { id: string; name: string };
}

export default function AcceptInvite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, refreshUser } = useAuth();
  const router = useRouter();
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
      router.replace("/");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to accept invite"));
    } finally {
      setIsAccepting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20, backgroundColor: "#F8FAFC" }}>
      <Card>
        {!user ? (
          <Text style={{ color: colors.slate500 }}>Sign in first, then open this invite link again to accept it.</Text>
        ) : invite ? (
          <View style={{ alignItems: "center", gap: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: "700" }}>Join {invite.family.name}</Text>
            <Text style={{ color: colors.slate500, textAlign: "center" }}>
              You've been invited to join as a {invite.role.toLowerCase()}.
            </Text>
            <Button
              title={isAccepting ? "Joining..." : "Accept invite"}
              onPress={handleAccept}
              disabled={isAccepting || invite.status !== "PENDING"}
            />
          </View>
        ) : (
          !error && <Text style={{ color: colors.slate500 }}>Loading invite...</Text>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>
    </ScrollView>
  );
}

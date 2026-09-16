import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/context/AuthContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, ErrorText, Input, Label, colors } from "../../src/components/ui";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
}

interface Invite {
  id: string;
  email: string;
  role: string;
  inviteLink: string;
}

const ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;

export default function FamilySettings() {
  const { user, logout } = useAuth();
  const family = user!.families[0];
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof ROLES)[number]>("MEMBER");
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  const loadMembers = useCallback(async () => {
    const [membersRes, invitesRes] = await Promise.all([
      api.get<Member[]>(`/families/${family.id}/members`),
      api.get<Invite[]>(`/families/${family.id}/invites`).catch(() => ({ data: [] as Invite[] })),
    ]);
    setMembers(membersRes.data);
    setPendingInvites(invitesRes.data);
  }, [family.id]);

  useFocusEffect(
    useCallback(() => {
      loadMembers().catch((err) => setError(getErrorMessage(err)));
    }, [loadMembers])
  );

  async function handleInvite() {
    setError(null);
    setIsInviting(true);
    setCopied(false);
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

  async function copyLink() {
    if (!lastInviteLink) return;
    await Clipboard.setStringAsync(lastInviteLink);
    setCopied(true);
  }

  return (
    <ScrollView style={{ backgroundColor: "#F8FAFC" }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 17, fontWeight: "700", marginBottom: 4 }}>Members</Text>
        {members.map((m) => (
          <View
            key={m.userId}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingVertical: 8,
              borderTopWidth: 1,
              borderTopColor: colors.slate200,
            }}
          >
            <View>
              <Text style={{ fontWeight: "600" }}>{m.name}</Text>
              <Text style={{ color: colors.slate500, fontSize: 12 }}>{m.email}</Text>
            </View>
            <View style={{ backgroundColor: colors.brand50, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: colors.brand700, fontSize: 11, fontWeight: "700" }}>{m.role}</Text>
            </View>
          </View>
        ))}
      </Card>

      <Card style={{ gap: 12 }}>
        <Text style={{ fontSize: 17, fontWeight: "700" }}>Invite a family member</Text>
        <View>
          <Label>Email</Label>
          <Input
            autoCapitalize="none"
            keyboardType="email-address"
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="partner@example.com"
          />
        </View>
        <View>
          <Label>Role</Label>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {ROLES.map((r) => (
              <Pressable
                key={r}
                onPress={() => setInviteRole(r)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: inviteRole === r ? colors.brand600 : colors.slate50,
                  borderWidth: 1,
                  borderColor: inviteRole === r ? colors.brand600 : colors.slate200,
                }}
              >
                <Text style={{ color: inviteRole === r ? colors.white : colors.slate700, fontSize: 12, fontWeight: "600" }}>
                  {r}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <ErrorText>{error}</ErrorText>
        <Button title={isInviting ? "Sending..." : "Send invite"} onPress={handleInvite} disabled={isInviting || !inviteEmail.trim()} />

        {lastInviteLink && (
          <View style={{ backgroundColor: colors.slate50, borderRadius: 10, padding: 12, gap: 8 }}>
            <Text style={{ fontSize: 12, color: colors.slate500 }}>
              No email service is wired up yet — share this link with them directly:
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "monospace" }} numberOfLines={2}>
              {lastInviteLink}
            </Text>
            <Button title={copied ? "Copied!" : "Copy link"} variant="secondary" onPress={copyLink} />
          </View>
        )}

        {pendingInvites.length > 0 && (
          <View style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.slate500, marginBottom: 6 }}>
              Pending invites
            </Text>
            {pendingInvites.map((inv) => (
              <View key={inv.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                <Text style={{ fontSize: 13 }}>{inv.email}</Text>
                <Text style={{ fontSize: 12, color: colors.slate400 }}>{inv.role}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Button title="Sign out" variant="secondary" onPress={() => logout()} />
    </ScrollView>
  );
}

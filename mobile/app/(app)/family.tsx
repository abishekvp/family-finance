import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { Check, Copy, LogOut, Mail, Users } from "lucide-react-native";
import { api } from "../../src/api/client";
import { fetchWithCache } from "../../src/lib/cache";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Avatar, Badge, Button, Card, CardHeader, Chip, ErrorText, Field, Input } from "../../src/components/ui";

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
const ROLE_TONE = { ADMIN: "brand", MEMBER: "info", VIEWER: "neutral" } as const;

export default function FamilySettings() {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
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
      fetchWithCache<Member[]>(`/families/${family.id}/members`, undefined, (cached) => setMembers(cached.data)),
      fetchWithCache<Invite[]>(`/families/${family.id}/invites`, undefined, (cached) => setPendingInvites(cached.data)).catch(() => ({ data: [] as Invite[] })),
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
      const res = await api.post<Invite>(`/families/${family.id}/invites`, { email: inviteEmail, role: inviteRole });
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
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card>
        <CardHeader title="Members" subtitle={`${members.length} in ${family.name}`} icon={<Users size={16} color={colors.brand600} />} />
        <View style={{ gap: 4 }}>
          {members.map((m, i) => (
            <View key={m.userId} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
              <Avatar name={m.name} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", color: colors.ink }}>{m.name}</Text>
                <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>{m.email}</Text>
              </View>
              <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>
            </View>
          ))}
        </View>
      </Card>

      <Card style={{ gap: 14 }}>
        <CardHeader title="Invite a family member" icon={<Mail size={16} color={colors.brand600} />} />
        <Field label="Email">
          <Input autoCapitalize="none" keyboardType="email-address" value={inviteEmail} onChangeText={setInviteEmail} placeholder="partner@example.com" />
        </Field>
        <Field label="Role">
          <View style={{ flexDirection: "row", gap: 8 }}>
            {ROLES.map((r) => (
              <Chip key={r} label={r} selected={inviteRole === r} onPress={() => setInviteRole(r)} />
            ))}
          </View>
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button title="Send invite" loading={isInviting} disabled={!inviteEmail.trim()} onPress={handleInvite} />

        {lastInviteLink && (
          <View style={{ backgroundColor: colors.surfaceSunken, borderRadius: 14, padding: 14, gap: 10 }}>
            <Text style={{ fontSize: 12, color: colors.inkSubtle }}>No email service is wired up yet — share this link with them directly:</Text>
            <Text style={{ fontSize: 12, fontFamily: "monospace", color: colors.ink }} numberOfLines={2}>
              {lastInviteLink}
            </Text>
            <Button title={copied ? "Copied" : "Copy link"} variant="secondary" icon={copied ? <Check size={14} color={colors.ink} /> : <Copy size={14} color={colors.ink} />} onPress={copyLink} />
          </View>
        )}

        {pendingInvites.length > 0 && (
          <View style={{ marginTop: 4, gap: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.inkSubtle, marginBottom: 4, textTransform: "uppercase" }}>Pending invites</Text>
            {pendingInvites.map((inv) => (
              <View key={inv.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                <Text style={{ fontSize: 13, color: colors.ink }}>{inv.email}</Text>
                <Badge>{inv.role}</Badge>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Button title="Sign out" variant="secondary" icon={<LogOut size={16} color={colors.ink} />} onPress={() => logout()} />
    </ScrollView>
  );
}

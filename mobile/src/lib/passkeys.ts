import { Passkey, type PasskeyCreateRequest, type PasskeyGetRequest } from "react-native-passkey";
import { api } from "../api/client";
import { ClientError } from "../api/errors";

// Passkeys through Android Credential Manager. They're bound to the web domain (the server's
// WebAuthn RP ID), which is why the server publishes /.well-known/assetlinks.json for this app.

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
}

export function passkeysSupported() {
  try {
    return Passkey.isSupported();
  } catch {
    return false;
  }
}

function friendlyError(err: unknown): never {
  const code = (err as { error?: string } | null)?.error;
  if (code === "UserCancelled") throw new ClientError("Passkey request was cancelled");
  if (code === "NoCredentials") throw new ClientError("No passkey for Family Finance was found on this device");
  if (code === "CredentialAlreadyExists") throw new ClientError("This device already has a passkey for your account");
  if (code === "BadConfiguration") {
    throw new ClientError("Passkeys aren't set up for this app build yet (the server's Android asset links don't match this APK).");
  }
  const message = (err as { message?: string } | null)?.message;
  throw new ClientError(message || "Passkey request failed");
}

export async function registerPasskey(): Promise<PasskeySummary> {
  const { data: options } = await api.post<PasskeyCreateRequest>("/auth/passkeys/register/options");
  let result;
  try {
    result = await Passkey.create(options);
  } catch (err) {
    friendlyError(err);
  }
  const { data } = await api.post<PasskeySummary>("/auth/passkeys/register/verify", {
    response: { ...result, rawId: result.rawId ?? result.id, type: result.type ?? "public-key", clientExtensionResults: {} },
    name: "Android phone",
  });
  return data;
}

export async function signInWithPasskey() {
  const { data: options } = await api.post<PasskeyGetRequest>("/auth/passkeys/login/options");
  let result;
  try {
    result = await Passkey.get(options);
  } catch (err) {
    friendlyError(err);
  }
  const { data } = await api.post<{ accessToken: string; refreshToken: string }>("/auth/passkeys/login/verify", {
    response: { ...result, rawId: result.rawId ?? result.id, type: result.type ?? "public-key", clientExtensionResults: {} },
  });
  return data;
}

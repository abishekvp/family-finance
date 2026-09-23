import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { api } from "../api/client";
import { ClientError } from "../api/errors";

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
}

export const passkeysSupported = () => browserSupportsWebAuthn();

function friendlyError(err: unknown): never {
  if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) {
    throw new ClientError("Passkey request was cancelled or timed out");
  }
  if (err instanceof Error && err.name === "InvalidStateError") {
    throw new ClientError("This device already has a passkey for your account");
  }
  throw err;
}

/** Strip raw ArrayBuffer extension outputs (e.g. PRF) before the response is sent as JSON. */
function withoutExtensionResults<T extends { clientExtensionResults: object }>(response: T): T {
  return { ...response, clientExtensionResults: {} };
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : "This device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

export async function registerPasskey(): Promise<PasskeySummary> {
  const { data: optionsJSON } = await api.post<PublicKeyCredentialCreationOptionsJSON>("/auth/passkeys/register/options");
  // Ask for PRF support up front so the passkey can later unlock the encrypted vault too.
  optionsJSON.extensions = { ...optionsJSON.extensions, prf: {} } as typeof optionsJSON.extensions;
  let response;
  try {
    response = await startRegistration({ optionsJSON });
  } catch (err) {
    friendlyError(err);
  }
  const { data } = await api.post<PasskeySummary>("/auth/passkeys/register/verify", {
    response: withoutExtensionResults(response),
    name: guessDeviceName(),
  });
  return data;
}

export async function signInWithPasskey() {
  const { data: optionsJSON } = await api.post<PublicKeyCredentialRequestOptionsJSON>("/auth/passkeys/login/options");
  let response;
  try {
    response = await startAuthentication({ optionsJSON });
  } catch (err) {
    friendlyError(err);
  }
  const { data } = await api.post<{ accessToken: string }>("/auth/passkeys/login/verify", {
    response: withoutExtensionResults(response),
  });
  return data;
}

/**
 * Re-verifies the signed-in user with one of their passkeys (the web "screen lock"). When `prfSalt`
 * is given, also evaluates the PRF extension and returns its 32-byte output — used to unwrap the
 * vault key without the master password. `credentialId` pins the ceremony to one passkey, since
 * PRF output is per-credential.
 */
export async function verifyWithPasskey(opts: { prfSalt?: Uint8Array; credentialId?: string } = {}) {
  const { data: optionsJSON } = await api.post<PublicKeyCredentialRequestOptionsJSON>("/auth/passkeys/unlock/options");
  if (opts.credentialId) {
    optionsJSON.allowCredentials = optionsJSON.allowCredentials?.filter((c) => c.id === opts.credentialId);
    if (!optionsJSON.allowCredentials?.length) throw new ClientError("That passkey was removed from your account");
  }
  if (opts.prfSalt) {
    optionsJSON.extensions = {
      ...optionsJSON.extensions,
      prf: { eval: { first: opts.prfSalt } },
    } as typeof optionsJSON.extensions;
  }
  let response;
  try {
    response = await startAuthentication({ optionsJSON });
  } catch (err) {
    friendlyError(err);
  }
  await api.post("/auth/passkeys/unlock/verify", { response: withoutExtensionResults(response) });

  const prf = (response.clientExtensionResults as { prf?: { results?: { first?: ArrayBuffer } } }).prf;
  const prfOutput = prf?.results?.first ? new Uint8Array(prf.results.first) : null;
  return { credentialId: response.id, prfOutput };
}

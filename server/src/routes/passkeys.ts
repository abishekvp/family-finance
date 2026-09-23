import { Router } from "express";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { ChallengePurpose } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";
import { WEBAUTHN_RP_NAME, webauthnOrigins, webauthnRpId } from "../lib/config";
import { issueSession, sanitizeUser } from "../lib/session";

// Passkeys (WebAuthn). The same endpoints serve the browser (navigator.credentials) and the
// Android app (Credential Manager) — only the reported origin differs, see webauthnOrigins().

export const passkeysRouter = Router();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function saveChallenge(challenge: string, purpose: ChallengePurpose, userId: string | null) {
  // Opportunistic cleanup keeps the table tiny without a cron job.
  await prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.authChallenge.create({
    data: { challenge, purpose, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
}

/** Pulls the challenge out of clientDataJSON and consumes the matching stored record. */
async function takeChallenge(clientDataJSON: string, purpose: ChallengePurpose, userId: string | null) {
  let challenge: string;
  try {
    challenge = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")).challenge;
  } catch {
    throw new AppError(400, "Malformed passkey response");
  }
  const record = await prisma.authChallenge.findUnique({ where: { challenge } });
  if (!record || record.purpose !== purpose || record.expiresAt < new Date() || (userId && record.userId !== userId)) {
    throw new AppError(400, "Passkey request expired. Please try again.");
  }
  await prisma.authChallenge.delete({ where: { id: record.id } });
  return challenge;
}

function serializePasskey(p: { id: string; name: string; createdAt: Date; lastUsedAt: Date | null; backedUp: boolean }) {
  return { id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, backedUp: p.backedUp };
}

passkeysRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const passkeys = await prisma.passkey.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "asc" } });
    res.json(passkeys.map(serializePasskey));
  })
);

passkeysRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { count } = await prisma.passkey.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    if (count === 0) throw new AppError(404, "Passkey not found");
    res.status(204).send();
  })
);

passkeysRouter.post(
  "/register/options",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, include: { passkeys: true } });
    if (!user) throw new AppError(404, "User not found");

    const options = await generateRegistrationOptions({
      rpName: WEBAUTHN_RP_NAME,
      rpID: webauthnRpId(),
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: user.passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransport[],
      })),
      // Discoverable credentials let "Sign in with a passkey" work without typing an email.
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    await saveChallenge(options.challenge, ChallengePurpose.PASSKEY_REGISTER, user.id);
    res.json(options);
  })
);

passkeysRouter.post(
  "/register/verify",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ response: z.any(), name: z.string().trim().max(60).optional() }).parse(req.body);
    const response = body.response as RegistrationResponseJSON;
    const expectedChallenge = await takeChallenge(
      response?.response?.clientDataJSON ?? "",
      ChallengePurpose.PASSKEY_REGISTER,
      req.user!.id
    );

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: webauthnOrigins(),
        expectedRPID: webauthnRpId(),
        requireUserVerification: false,
      });
    } catch (err) {
      throw new AppError(400, err instanceof Error ? err.message : "Passkey could not be verified");
    }
    if (!verification.verified) throw new AppError(400, "Passkey could not be verified");

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const passkey = await prisma.passkey.create({
      data: {
        userId: req.user!.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: body.name || (credentialBackedUp ? "Synced passkey" : "Device passkey"),
      },
    });
    res.status(201).json(serializePasskey(passkey));
  })
);

async function verifyAssertion(response: AuthenticationResponseJSON, purpose: ChallengePurpose, userId: string | null) {
  const expectedChallenge = await takeChallenge(response?.response?.clientDataJSON ?? "", purpose, userId);
  const passkey = await prisma.passkey.findUnique({ where: { credentialId: response.id } });
  if (!passkey || (userId && passkey.userId !== userId)) {
    throw new AppError(400, "This passkey isn't registered with Family Finance");
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: webauthnOrigins(),
      expectedRPID: webauthnRpId(),
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransport[],
      },
      requireUserVerification: true,
    });
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : "Passkey could not be verified");
  }
  if (!verification.verified) throw new AppError(400, "Passkey could not be verified");

  await prisma.passkey.update({
    where: { id: passkey.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });
  return passkey;
}

// Sign in: discoverable-credential flow, so no email is needed up front.
passkeysRouter.post(
  "/login/options",
  asyncHandler(async (_req, res) => {
    const options = await generateAuthenticationOptions({ rpID: webauthnRpId(), userVerification: "required" });
    await saveChallenge(options.challenge, ChallengePurpose.PASSKEY_AUTH, null);
    res.json(options);
  })
);

passkeysRouter.post(
  "/login/verify",
  asyncHandler(async (req, res) => {
    const response = z.object({ response: z.any() }).parse(req.body).response as AuthenticationResponseJSON;
    const passkey = await verifyAssertion(response, ChallengePurpose.PASSKEY_AUTH, null);
    const user = await prisma.user.findUnique({ where: { id: passkey.userId } });
    if (!user) throw new AppError(401, "Account not found");
    const { accessToken, refreshToken } = await issueSession(res, user.id);
    res.json({ accessToken, refreshToken, user: sanitizeUser(user) });
  })
);

// Unlock (web screen lock): the already-signed-in user proves presence with one of their passkeys.
passkeysRouter.post(
  "/unlock/options",
  requireAuth,
  asyncHandler(async (req, res) => {
    const passkeys = await prisma.passkey.findMany({ where: { userId: req.user!.id } });
    if (passkeys.length === 0) throw new AppError(400, "Add a passkey first");
    const options = await generateAuthenticationOptions({
      rpID: webauthnRpId(),
      userVerification: "required",
      allowCredentials: passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransport[],
      })),
    });
    await saveChallenge(options.challenge, ChallengePurpose.PASSKEY_AUTH, req.user!.id);
    res.json(options);
  })
);

passkeysRouter.post(
  "/unlock/verify",
  requireAuth,
  asyncHandler(async (req, res) => {
    const response = z.object({ response: z.any() }).parse(req.body).response as AuthenticationResponseJSON;
    await verifyAssertion(response, ChallengePurpose.PASSKEY_AUTH, req.user!.id);
    res.json({ ok: true });
  })
);

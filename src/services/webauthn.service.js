const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoUint8Array } = require('@simplewebauthn/server/helpers');
const prisma = require('../config/prisma');
const config = require('../config/env');

/**
 * Dynamically resolve RP Name, RP ID, and allowed origins based on request and config.
 */
function getRelyingPartyConfig(req) {
  const originHeader = req?.headers?.origin;
  const frontendUrl = config.frontendUrl || 'http://localhost:3000';
  const effectiveOrigin = originHeader || frontendUrl;

  let rpID = 'localhost';
  try {
    const parsed = new URL(effectiveOrigin);
    rpID = parsed.hostname;
  } catch {
    rpID = 'localhost';
  }

  const expectedOrigin = [
    effectiveOrigin,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    frontendUrl,
  ].filter(Boolean);

  return {
    rpName: 'HelpMeMan Admin Security',
    rpID,
    expectedOrigin: Array.from(new Set(expectedOrigin)),
  };
}

/**
 * Persist an ephemeral WebAuthn challenge with a 5-minute TTL.
 */
async function saveChallenge(userId, email, challenge, purpose) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  try {
    await prisma.webauthnChallenge.deleteMany({
      where: {
        OR: [
          ...(userId ? [{ userId, purpose }] : []),
          ...(email ? [{ email: email.toLowerCase(), purpose }] : []),
        ],
      },
    });
    await prisma.webauthnChallenge.create({
      data: {
        userId: userId || null,
        email: email ? email.toLowerCase() : null,
        challenge,
        purpose,
        expiresAt,
      },
    });
  } catch (err) {
    console.error('[WEBAUTHN] Failed to persist challenge:', err);
    throw new Error('Failed to initialize security key challenge');
  }
}

/**
 * Generate FIDO2 registration options for an admin.
 */
async function generateRegOptions(user, req) {
  const { rpName, rpID } = getRelyingPartyConfig(req);
  const existingCredentials = await prisma.passkeyCredential.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: isoUint8Array.fromUTF8String(user.id),
    userName: user.email,
    userDisplayName: user.name || user.email,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports || [],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  await saveChallenge(user.id, user.email, options.challenge, 'registration');
  return options;
}

/**
 * Verify FIDO2 registration response and store new PasskeyCredential.
 */
async function verifyRegResponse(user, response, nickname, req) {
  const { rpID, expectedOrigin } = getRelyingPartyConfig(req);
  const challengeRecord = await prisma.webauthnChallenge.findFirst({
    where: {
      userId: user.id,
      purpose: 'registration',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!challengeRecord) {
    throw new Error('Registration challenge expired or not found. Please try again.');
  }

  await prisma.webauthnChallenge.delete({ where: { id: challengeRecord.id } }).catch(() => {});

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challengeRecord.challenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('WebAuthn registration verification failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const passkey = await prisma.passkeyCredential.create({
    data: {
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter || 0),
      deviceType: credentialDeviceType || 'singleDevice',
      backedUp: Boolean(credentialBackedUp),
      transports: credential.transports || [],
      nickname: (nickname || 'Security Key').trim(),
      lastUsedAt: new Date(),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true },
  });

  return passkey;
}

/**
 * Generate FIDO2 authentication challenge for 2FA login.
 */
async function generateAuthOptions(user, req) {
  const { rpID } = getRelyingPartyConfig(req);
  const credentials = await prisma.passkeyCredential.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  if (!credentials.length) {
    throw new Error('No security keys or passkeys registered for this account.');
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports || [],
    })),
    userVerification: 'preferred',
  });

  await saveChallenge(user.id, user.email, options.challenge, 'authentication');
  return options;
}

/**
 * Verify FIDO2 authentication response and update credential counter.
 */
async function verifyAuthResponse(user, response, req) {
  const { rpID, expectedOrigin } = getRelyingPartyConfig(req);
  const challengeRecord = await prisma.webauthnChallenge.findFirst({
    where: {
      userId: user.id,
      purpose: 'authentication',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!challengeRecord) {
    throw new Error('Authentication challenge expired or not found. Please click retry.');
  }

  await prisma.webauthnChallenge.delete({ where: { id: challengeRecord.id } }).catch(() => {});

  const credentialId = response.id;
  const storedCredential = await prisma.passkeyCredential.findFirst({
    where: {
      userId: user.id,
      credentialId,
    },
  });

  if (!storedCredential) {
    throw new Error('Unrecognized security key for this account.');
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challengeRecord.challenge,
    expectedOrigin,
    expectedRPID: rpID,
    credential: {
      id: storedCredential.credentialId,
      publicKey: Buffer.from(storedCredential.publicKey),
      counter: Number(storedCredential.counter),
      transports: storedCredential.transports,
    },
    requireUserVerification: false,
  });

  if (!verification.verified) {
    throw new Error('WebAuthn security key verification failed.');
  }

  const newCounter = verification.authenticationInfo?.newCounter ?? storedCredential.counter;
  await prisma.passkeyCredential.update({
    where: { id: storedCredential.id },
    data: {
      counter: BigInt(newCounter),
      lastUsedAt: new Date(),
    },
  });

  return {
    verified: true,
    credential: storedCredential,
  };
}

module.exports = {
  getRelyingPartyConfig,
  generateRegOptions,
  verifyRegResponse,
  generateAuthOptions,
  verifyAuthResponse,
};

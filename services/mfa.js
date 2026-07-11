import { generateSecret, generateURI, verify } from "otplib";

export async function verifyTotpCode(secret, token) {
  if (!secret || !token) return false;
  const result = await verify({ token: String(token).trim(), secret });
  return Boolean(result.valid);
}

export function generateTotpSecret() {
  return generateSecret();
}

export function getTotpUri(email, secret) {
  const issuer = process.env.MFA_ISSUER || "SkillAra";
  return generateURI({ issuer, label: email, secret });
}

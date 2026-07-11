import crypto from "crypto";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

/** Generate a one-time temporary password for new tenant admins. */
export function generateTemporaryPassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i += 1) {
    password += CHARS[bytes[i] % CHARS.length];
  }
  return password;
}

import bcrypt from "bcryptjs";

export async function hashPassword(plain) {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 12);
  return bcrypt.hash(plain, saltRounds);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

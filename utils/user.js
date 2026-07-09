export function toPublicUser(user) {
  if (!user) return null;
  const doc = user.toObject ? user.toObject() : user;
  return {
    id: doc._id,
    name: doc.name,
    email: doc.email,
    role: doc.role,
    status: doc.status,
    tenantId: doc.tenantId,
    lastLoginAt: doc.lastLoginAt,
    created_on: doc.created_on,
    updated_on: doc.updated_on,
  };
}

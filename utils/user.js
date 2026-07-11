export function toPublicUser(user) {
  if (!user) return null;
  const doc = user.toObject ? user.toObject() : user;
  return {
    id: doc._id,
    name: doc.name,
    email: doc.email,
    phone: doc.phone || "",
    profilePhoto: doc.profilePhoto || "",
    role: doc.role,
    status: doc.status,
    invitationStatus: doc.invitationStatus || "ACCEPTED",
    tenantId: doc.tenantId,
    lastLoginAt: doc.lastLoginAt,
    created_on: doc.created_on,
    updated_on: doc.updated_on,
  };
}

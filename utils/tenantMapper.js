/** Map tenant documents to the shape expected by admin panel UI (legacy field names). */

export function isTenantActive(status) {
  if (status === false || status === "suspended" || status === "inactive") return false;
  return true;
}

export function booleanToTenantStatus(active) {
  return active ? "active" : "suspended";
}

export function normalizeTenantForApi(tenant, planDocOrName) {
  if (!tenant) return null;

  const doc = tenant.toObject ? tenant.toObject({ virtuals: true }) : { ...tenant };
  const name = doc.name || doc.tenant_name || "";
  const subdomain = doc.subdomain || doc.sub_domain || "";
  
  const isPlanObj = planDocOrName && typeof planDocOrName === 'object';
  const planNameStr = isPlanObj ? planDocOrName.name : planDocOrName;
  
  const plan =
    planNameStr ||
    (typeof doc.planId === "object" && doc.planId?.name) ||
    doc.plan ||
    "FREE";
    
  const planFeatures = isPlanObj ? (planDocOrName.features || {}) : {};

  return {
    ...doc,
    tenant_name: name,
    name,
    sub_domain: subdomain,
    subdomain,
    plan,
    planId: doc.planId?._id || doc.planId || null,
    orgTypeId: doc.orgTypeId || null,
    org_type: doc.orgType || doc.org_type || "",
    user_count: doc.user_count ?? 0,
    subscriptionStatus: doc.subscriptionStatus || (plan === "FREE" ? "TRIAL" : "ACTIVE"),
    status: isTenantActive(doc.status),
    statusRaw: doc.status === "suspended" ? "suspended" : "active",
    planFeatures,
  };
}

import User from "../models/User.js";
import { verifyAccessToken } from "../services/jwt.js";

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const cookieToken = req.cookies?.access_token || null;
    const token = bearer || cookieToken;

    if (!token) {
      return res
        .status(401)
        .send({ status: false, data: {}, message: { errorMessage: "Unauthorized", code: 401 } });
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.sub);
    if (!user || user.status !== "ACTIVE") {
      return res
        .status(401)
        .send({ status: false, data: {}, message: { errorMessage: "Unauthorized", code: 401 } });
    }

    req.user = user;
    return next();
  } catch (err) {
    return res
      .status(401)
      .send({ status: false, data: {}, message: { errorMessage: "Unauthorized", code: 401 } });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) {
      return res
        .status(403)
        .send({ status: false, data: {}, message: { errorMessage: "Forbidden", code: 403 } });
    }
    return next();
  };
}

export async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const cookieToken = req.cookies?.access_token || null;
    const token = bearer || cookieToken;

    if (token) {
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.sub);
      if (user && user.status === "ACTIVE") {
        req.user = user;
      }
    }
    return next();
  } catch {
    return next();
  }
}

export function requireTenant(req, res, next) {
  // SUPER_ADMIN bypasses tenant context
  if (req.user?.role === "SUPER_ADMIN") return next();

  const tenant = req.tenant;
  if (!tenant) {
    return res.status(400).send({
      status: false,
      data: {},
      message: { errorMessage: "Tenant context required", code: 400 },
    });
  }

  if (req.user && (!req.user.tenantId || String(req.user.tenantId) !== String(tenant._id))) {
    return res
      .status(403)
      .send({ status: false, data: {}, message: { errorMessage: "Forbidden", code: 403 } });
  }

  return next();
}

import { GraphQLError } from "graphql";
import { verifyAccessToken } from "../services/jwt.js";
import AuthError from "../errors/AuthError.js";
import ForbiddenError from "../errors/ForbiddenError.js";

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorizaton;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Authentication required");
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;

    next();
  } catch (err) {
    throw new ForbiddenError('invalid or expired token')
  }
};

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
     throw new AuthError("Authentication required");
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError('insufficient role permissions')
    }
    next();
  };
};

function requireRole(allowedRoles, resolver) {
  return async (parent, args, context, info) => {

    if (!context.user) {
      throw new GraphQLError("Authentication required", {
        extensions: { code: "UNAUTHENTICATED" },
      });
    }

    const userRole = context.user.role; // singular string

    const roleList = Array.isArray(allowedRoles)
      ? allowedRoles
      : [allowedRoles];

    if (!userRole || !roleList.includes(userRole)) {
      throw new GraphQLError("Insufficient permissions", {
        extensions: { code: "FORBIDDEN" },
      });
    }

    return await resolver(parent, args, context, info);
  };
}

export { authenticateJWT, authorizeRoles, requireRole };

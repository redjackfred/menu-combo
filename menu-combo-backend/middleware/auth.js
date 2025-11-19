import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { promisify } from "util";

const REGION = "us-east-1";
const USER_POOL_ID = "us-east-1_FEaytr2dj";

// JWKS client to fetch Cognito's public keys
const client = jwksClient({
  jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 3600000, // 1 hour
  timeout: 5000, // 5 second timeout for fetching keys
});

// Promisify the getSigningKey function
const getSigningKeyAsync = promisify(client.getSigningKey.bind(client));

/**
 * Middleware to verify Cognito JWT token
 * Extracts token from Authorization header and validates it
 * Attaches decoded user info to req.user
 */
export async function verifyToken(req, res, next) {
  try {
    // Extract token from Authorization header (format: "Bearer <token>")
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.split(" ")[1];

    // Decode token to get header (without verification)
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
      return res.status(401).json({ error: "Invalid token format" });
    }

    // Get signing key
    const key = await getSigningKeyAsync(decoded.header.kid);
    const signingKey = key.getPublicKey();

    // Verify JWT token with promisified version
    const verifyAsync = promisify(jwt.verify);
    const payload = await verifyAsync(token, signingKey, {
      algorithms: ["RS256"],
      issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
    });

    // Attach user info to request object
    req.user = {
      sub: payload.sub, // Cognito user ID
      email: payload.email,
      username: payload["cognito:username"],
    };

    next();
  } catch (err) {
    console.error("Auth middleware error:", err.message, err.stack);

    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }

    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token", details: err.message });
    }

    res.status(500).json({ error: "Authentication error", details: err.message });
  }
}

const bcrypt = require('bcryptjs');
const { signToken, verifyToken } = require('./jwt');

const SALT_ROUNDS = 10;

async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw Object.assign(new Error('Password is required and must be a string'), { statusCode: 400 });
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function comparePassword(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

function signAdminToken(admin, secret, expiresIn = '24h') {
  return signToken(
    {
      adminId: admin.adminId,
      email: admin.email,
      name: admin.name,
      role: 'ADMIN',
    },
    secret,
    { expiresIn }
  );
}

async function authenticateAdmin(event, secret) {
  const headers = event.headers || {};
  const authHeader = headers.Authorization || headers.authorization || headers.AUTHORIZATION;

  if (!authHeader) {
    throw Object.assign(new Error('Unauthorized: Missing Authorization header'), { statusCode: 401 });
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw Object.assign(new Error('Unauthorized: Invalid authorization format. Expected "Bearer <token>"'), { statusCode: 401 });
  }

  let decoded;
  try {
    decoded = verifyToken(token, secret);
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Unauthorized: Token expired' : 'Unauthorized: Invalid token';
    throw Object.assign(new Error(message), { statusCode: 401 });
  }

  if (decoded.role !== 'ADMIN' || !decoded.adminId) {
    throw Object.assign(new Error('Forbidden: Insufficient privileges'), { statusCode: 403 });
  }

  return {
    adminId: decoded.adminId,
    email: decoded.email,
    name: decoded.name,
    role: decoded.role,
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  signAdminToken,
  authenticateAdmin,
};

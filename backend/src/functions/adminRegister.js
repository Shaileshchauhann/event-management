const { randomUUID } = require('crypto');
const { ok, parseBody } = require('../lib/http');
const { hashPassword, authenticateAdmin } = require('../lib/auth');
const { putAdmin, getAdminByEmail, countAdmins } = require('../lib/db');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const body = parseBody(event);
    const { name, email, password, registrationSecret } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return ok(400, { message: 'name is required' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return ok(400, { message: 'Valid email is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return ok(400, { message: 'password is required and must be at least 6 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check authorization to register an admin:
    // 1. If an existing admin provides a valid Bearer token -> Allowed
    // 2. If ADMIN_REGISTRATION_SECRET is set and matches header/body -> Allowed
    // 3. If zero admins exist in the system (bootstrap mode) -> Allowed
    let authorized = false;
    const adminCount = await countAdmins();

    if (adminCount === 0) {
      // Initial bootstrap: allow the first admin account to be created
      authorized = true;
    } else {
      const expectedSecret = process.env.ADMIN_REGISTRATION_SECRET;
      const headers = event.headers || {};
      const passedSecret = registrationSecret || headers['x-admin-secret'] || headers['X-Admin-Secret'];

      if (expectedSecret && passedSecret === expectedSecret) {
        authorized = true;
      } else {
        // Try verifying if caller is an existing authenticated admin
        try {
          const jwtSecret = await getJwtSecret();
          const auth = await authenticateAdmin(event, jwtSecret);
          if (auth && auth.role === 'ADMIN') {
            authorized = true;
          }
        } catch (_) {
          // not authenticated as admin
        }
      }
    }

    if (!authorized) {
      return ok(403, {
        message: 'Admin registration is protected. Provide a valid admin token, registration secret, or bootstrap the initial admin.',
      });
    }

    const existingAdmin = await getAdminByEmail(normalizedEmail);
    if (existingAdmin) {
      return ok(409, { message: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const adminId = randomUUID();
    const createdAt = new Date().toISOString();

    const newAdmin = {
      adminId,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'ADMIN',
      createdAt,
    };

    await putAdmin(newAdmin);

    // Safe return without password hash
    return ok(201, {
      message: 'Admin registered successfully',
      admin: {
        adminId,
        name: newAdmin.name,
        email: newAdmin.email,
        role: newAdmin.role,
        createdAt,
      },
    });
  } catch (err) {
    console.error('adminRegister error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};

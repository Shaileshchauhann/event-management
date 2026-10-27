const { ok, parseBody } = require('../lib/http');
const { comparePassword, signAdminToken } = require('../lib/auth');
const { getAdminByEmail } = require('../lib/db');
const { getJwtSecret } = require('../lib/secrets');

exports.handler = async (event) => {
  try {
    const { email, password } = parseBody(event);

    if (!email || !password) {
      return ok(400, { message: 'email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const admin = await getAdminByEmail(normalizedEmail);

    if (!admin) {
      return ok(401, { message: 'Invalid email or password' });
    }

    const isMatch = await comparePassword(password, admin.passwordHash);
    if (!isMatch) {
      return ok(401, { message: 'Invalid email or password' });
    }

    const secret = await getJwtSecret();
    const token = signAdminToken(
      {
        adminId: admin.adminId,
        email: admin.email,
        name: admin.name,
      },
      secret
    );

    return ok(200, {
      message: 'Login successful',
      token,
      admin: {
        adminId: admin.adminId,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (err) {
    console.error('adminLogin error', err);
    return ok(err.statusCode || 500, { message: err.message || 'Internal error' });
  }
};

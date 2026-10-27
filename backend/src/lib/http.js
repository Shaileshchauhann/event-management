const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,x-admin-secret',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

const ok = (statusCode, body, customHeaders = {}) => ({
  statusCode,
  headers: {
    ...CORS_HEADERS,
    ...customHeaders,
  },
  body: JSON.stringify(body),
});

const parseBody = (event) => {
  if (!event || !event.body) return {};
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
};

module.exports = { ok, parseBody, CORS_HEADERS };


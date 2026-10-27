const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({});

// Cached across warm invocations of the same Lambda container so we don't
// call Secrets Manager on every request.
let cachedSecret;

async function getJwtSecret() {
  if (cachedSecret) return cachedSecret;
  const { SecretString } = await client.send(
    new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN })
  );
  cachedSecret = SecretString;
  return cachedSecret;
}

module.exports = { getJwtSecret };

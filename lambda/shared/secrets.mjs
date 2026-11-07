/**
 * Read a plaintext secret from AWS Secrets Manager through an injected SDK
 * client. Keeping this small adapter in the shared package lets handlers keep
 * provider credentials out of Lambda environment variables and out of logs.
 *
 * @param {{send: (command: unknown) => Promise<{SecretString?: string}>}} client
 * @param {new (input: {SecretId: string}) => unknown} GetSecretValueCommand
 * @param {string} secretId
 * @returns {Promise<string>}
 */
export async function readSecretString(client, GetSecretValueCommand, secretId) {
  if (!secretId) throw new Error("missing_secret_id");
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (typeof result.SecretString !== "string" || !result.SecretString) {
    throw new Error("secret_value_unavailable");
  }
  return result.SecretString;
}

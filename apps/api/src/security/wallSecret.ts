/**
 * The wall HMAC secret (order keys + pairing token encryption). From WALL_HMAC_SECRET, or read
 * once from Key Vault with the managed identity and cached for the life of the process.
 */
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import type { Config } from '../config.js';

export type WallSecretProvider = () => Promise<Buffer>;

const MIN_SECRET_BYTES = 32;

export function wallSecretProvider(source: Config['wallSecret']): WallSecretProvider {
  if (source.kind === 'env') {
    const value = Buffer.from(source.value, 'utf8');
    return async () => value;
  }
  let cached: Promise<Buffer> | null = null;
  return () => {
    cached ??= fetchFromKeyVault(source.vaultUri, source.secretName).catch((err: unknown) => {
      cached = null; // retry on the next request instead of caching a failure
      throw err;
    });
    return cached;
  };
}

async function fetchFromKeyVault(vaultUri: string, secretName: string): Promise<Buffer> {
  const client = new SecretClient(vaultUri, new DefaultAzureCredential());
  const secret = await client.getSecret(secretName);
  const value = secret.value ? Buffer.from(secret.value, 'utf8') : Buffer.alloc(0);
  if (value.length < MIN_SECRET_BYTES) throw new Error(`Key Vault secret "${secretName}" is missing or shorter than ${MIN_SECRET_BYTES} bytes.`);
  return value;
}

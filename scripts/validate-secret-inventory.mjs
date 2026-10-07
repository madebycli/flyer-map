import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** An unavailable inventory must never authorize creating replacement keys. */
export function validateSecretInventory(status, response) {
  if (status !== '200' || response?.success !== true || !Array.isArray(response.result)
    || response.result.some(secret => typeof secret?.name !== 'string' || !secret.name)) {
    throw new Error('secret_inventory_unavailable');
  }
  return response.result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateSecretInventory(process.argv[2], JSON.parse(readFileSync(process.argv[3], 'utf8')));
  } catch {
    console.error('Secret inventory could not be verified. Release stopped before preparing keys.');
    process.exitCode = 1;
  }
}

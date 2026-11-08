#!/usr/bin/env node
// Replaces the __TENANT_ID__ placeholder in the built staticwebapp.config.json with the Entra
// tenant ID, so the Static Web Apps sign-in accepts only this tenant's issuer.
// Usage: node stamp-tenant.mjs <path-to-built-staticwebapp.config.json>
// Reads AZURE_TENANT_ID (azd sets it from the provision outputs; the deploy workflow sets it).
// Only the build output is changed; the source file in apps/web/public keeps the placeholder.
import { readFileSync, writeFileSync } from 'node:fs';

const PLACEHOLDER = '__TENANT_ID__';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const file = process.argv[2];
const tenantId = process.env.AZURE_TENANT_ID?.trim() ?? '';

if (!file) {
  console.error('Usage: node stamp-tenant.mjs <path-to-staticwebapp.config.json>');
  process.exit(2);
}
if (!GUID.test(tenantId)) {
  console.error(`AZURE_TENANT_ID must be the Entra tenant GUID; got "${tenantId}".`);
  process.exit(1);
}

const text = readFileSync(file, 'utf8');
if (!text.includes(PLACEHOLDER)) {
  console.error(`${file} does not contain ${PLACEHOLDER}. Rebuild the web app from source before packaging.`);
  process.exit(1);
}
const stamped = text.replaceAll(PLACEHOLDER, tenantId);
JSON.parse(stamped); // fail the deployment on a malformed config instead of shipping it
writeFileSync(file, stamped);
console.log(`Stamped tenant ${tenantId} into ${file}.`);

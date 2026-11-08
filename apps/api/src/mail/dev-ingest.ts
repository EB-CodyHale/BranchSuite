/**
 * DEV ONLY: push sample messages through the full mail pipeline against the fictional dev seed.
 *
 *   npx tsx apps/api/src/mail/dev-ingest.ts                 # in-memory seed, prints the results
 *   DEV_DATA_FILE=apps/api/.data/dev.json npx tsx apps/api/src/mail/dev-ingest.ts
 *                                                           # writes into the dev data file
 *                                                           # (stop `npm run dev` first; restart it after)
 *
 * Uses AI_MODE=mock and memory data only. Refuses to run on Azure hosting. Every address is fictional.
 */
import { loadConfig, isRunningInAzure } from '../config.js';
import { MemoryRepo, MemoryStore } from '../data/memory.js';
import { seedDevData } from '../dev/seed.js';
import { consoleLogger } from '../log.js';
import { NoopPublisher } from '../realtime/publisher.js';
import { ingestTestMessage } from './service.js';

if (isRunningInAzure(process.env)) {
  console.error('dev-ingest refuses to run on Azure hosting.');
  process.exit(1);
}

const config = loadConfig({
  AUTH_MODE: 'dev',
  DATA_MODE: 'memory',
  AI_MODE: 'mock',
  WALL_HMAC_SECRET: 'local-dev-only-wall-secret-0123456789abcdef',
  TENANT_DOMAINS: 'branchsuite.example.com',
});
const now = () => new Date();
const repo = new MemoryRepo(new MemoryStore({ file: process.env.DEV_DATA_FILE?.trim() || null, now }));
if (repo.memory.isEmpty()) await seedDevData(repo, now());

const deps = { config, repo, publisher: new NoopPublisher(), log: consoleLogger(), now };
const stamp = Date.now().toString(36);
const samples = [
  {
    mailboxId: 'mbx_riverside',
    message: {
      id: `dev-${stamp}-order`,
      from: { address: 'dana.whitfield@northwind.example.com', name: 'Dana Whitfield' },
      subject: 'Need 4 forklift drivers for Dock A',
      body: 'Hi team,\n\nWe need 4 forklift drivers on 2nd shift starting Monday at $20/hr.\n\nThanks,\nDana\n\nGet Outlook for iOS',
    },
  },
  {
    mailboxId: 'mbx_lakeview',
    message: {
      id: `dev-${stamp}-calloff`,
      from: { address: 'ops@wingtip.example.com', name: 'Wingtip Ops' },
      subject: 'Call-off tonight',
      body: 'Two associates called off for tonight at the East Building. Can you send replacements?',
    },
  },
  {
    mailboxId: 'mbx_riverside',
    message: {
      id: `dev-${stamp}-ooo`,
      from: { address: 'robin.hale@fabrikam.example.com', name: 'Robin Hale' },
      subject: 'Automatic reply: Out of office',
      body: 'I am out of the office this week.',
    },
  },
];

for (const sample of samples) {
  const result = await ingestTestMessage(deps, sample);
  console.log(`${sample.mailboxId} ${sample.message.subject} -> ${result.outcome}${result.taskId ? ` task=${result.taskId}` : ''}${result.orderId ? ` order=${result.orderId}` : ''}`);
}

// Publishes ../firestore.rules to the Firebase project (run by .github/workflows/rules.yml).
//   FIREBASE_SERVICE_ACCOUNT — GitHub secret: JSON key of a service account with the
//   "Firebase Rules Admin" role only.
import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { FIREBASE_CONFIG } from '../config.js';

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('FIREBASE_SERVICE_ACCOUNT secret is not set — publish firestore.rules by hand (README).');
  process.exit(0);
}

const project = FIREBASE_CONFIG.projectId;
const API = `https://firebaserules.googleapis.com/v1/projects/${project}`;
const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/firebase'],
});
const client = await auth.getClient();

const source = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const { data: ruleset } = await client.request({
  url: `${API}/rulesets`,
  method: 'POST',
  data: { source: { files: [{ name: 'firestore.rules', content: source }] } },
});
console.log('created ruleset', ruleset.name);

await client.request({
  url: `${API}/releases/cloud.firestore`,
  method: 'PATCH',
  data: { release: { name: `projects/${project}/releases/cloud.firestore`, rulesetName: ruleset.name } },
});
console.log('firestore.rules published to', project);

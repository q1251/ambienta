import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

const email = process.env.ADMIN_EMAIL;
const passwordHash = process.env.ADMIN_PASSWORD_HASH;

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('ADMIN_EMAIL must be a valid email address.');
}
if (!passwordHash || passwordHash.length < 50 || !passwordHash.startsWith('$')) {
  throw new Error('ADMIN_PASSWORD_HASH is missing or invalid.');
}

const phpString = (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const directory = path.resolve('private-deploy');
const configPath = path.join(directory, 'admin-auth.php');

await mkdir(directory, { recursive: true });
await writeFile(
  configPath,
  `<?php\ndeclare(strict_types=1);\nreturn [\n    'admin_email' => ${phpString(email)},\n    'password_hash' => ${phpString(passwordHash)},\n];\n`,
  { mode: 0o600 },
);
await chmod(configPath, 0o600);

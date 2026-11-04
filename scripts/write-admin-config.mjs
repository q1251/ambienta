import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

const email = process.env.ADMIN_EMAIL;
const passwordHash = process.env.ADMIN_PASSWORD_HASH;
const databaseConfigEncoded = process.env.APP_CONFIG_JSON_B64;

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('ADMIN_EMAIL must be a valid email address.');
}
if (!passwordHash || passwordHash.length < 50 || !passwordHash.startsWith('$')) {
  throw new Error('ADMIN_PASSWORD_HASH is missing or invalid.');
}
const phpString = (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const directory = path.resolve('private-deploy');
await mkdir(directory, { recursive: true });

const authConfigPath = path.join(directory, 'admin-auth.php');
await writeFile(
  authConfigPath,
  `<?php\ndeclare(strict_types=1);\nreturn [\n    'admin_email' => ${phpString(email)},\n    'password_hash' => ${phpString(passwordHash)},\n];\n`,
  { mode: 0o600 },
);
await chmod(authConfigPath, 0o600);

if (databaseConfigEncoded) {
  let databaseConfig;
  try {
    databaseConfig = JSON.parse(Buffer.from(databaseConfigEncoded, 'base64').toString('utf8'));
  } catch {
    throw new Error('APP_CONFIG_JSON_B64 must contain a base64-encoded JSON database configuration.');
  }

  for (const key of ['db_host', 'db_name', 'db_user', 'db_password']) {
    if (typeof databaseConfig[key] !== 'string' || databaseConfig[key].length === 0) {
      throw new Error(`The database configuration is missing ${key}.`);
    }
  }

  const privateConfig = {
    db_host: databaseConfig.db_host,
    db_name: databaseConfig.db_name,
    db_user: databaseConfig.db_user,
    db_password: databaseConfig.db_password,
  };
  const databaseConfigPath = path.join(directory, 'app-config.php');
  const phpDatabaseEntries = Object.entries(privateConfig)
    .map(([key, value]) => `    '${key}' => ${phpString(value)},`)
    .join('\n');
  await writeFile(
    databaseConfigPath,
    `<?php\ndeclare(strict_types=1);\nreturn [\n${phpDatabaseEntries}\n];\n`,
    { mode: 0o600 },
  );
  await chmod(databaseConfigPath, 0o600);
}

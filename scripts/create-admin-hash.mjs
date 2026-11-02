import { spawnSync } from 'node:child_process';

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  console.error('Run this command in an interactive terminal so the password can be entered without echo.');
  process.exit(1);
}

const password = await new Promise((resolve, reject) => {
  const characters = [];
  process.stdout.write('Enter a new admin password (12+ characters): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const finish = (error) => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeListener('data', handleInput);
    process.stdout.write('\n');
    if (error) reject(error);
    else resolve(characters.join(''));
  };

  const handleInput = (buffer) => {
    for (const character of buffer.toString('utf8')) {
      if (character === '\u0003') {
        finish(new Error('Password generation cancelled.'));
        return;
      }
      if (character === '\r' || character === '\n') {
        finish();
        return;
      }
      if (character === '\u007f' || character === '\b') {
        characters.pop();
        continue;
      }
      if (character >= ' ') characters.push(character);
    }
  };

  process.stdin.on('data', handleInput);
});

if (password.length < 12) {
  console.error('Choose a password with at least 12 characters.');
  process.exit(1);
}

const result = spawnSync(
  'php',
  ['-r', 'echo password_hash(stream_get_contents(STDIN), PASSWORD_DEFAULT);'],
  { input: password, encoding: 'utf8', windowsHide: true },
);

if (result.error || result.status !== 0 || !result.stdout) {
  console.error(result.error?.message || result.stderr || 'PHP could not create the password hash.');
  process.exit(1);
}

process.stdout.write(`Password hash (copy this into the private server config):\n${result.stdout.trim()}\n`);

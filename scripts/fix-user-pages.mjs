#!/usr/bin/env node
/**
 * מחליף את אתר המשתמש השבור ב-shneurGreenberg.github.io (אפליקציית Flutter ישנה
 * שמציגה מסך ריק) בדף הפניה לעלון השבת.
 *
 * הרצה מקומית עם הרשאות כתיבה לריפו:
 *   node scripts/fix-user-pages.mjs
 *
 * דורש: git, וגישה ל-github.com/shneurGreenberg/shneurGreenberg.github.io
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'user-site');
const REPO = 'https://github.com/shneurGreenberg/shneurGreenberg.github.io.git';
const BULLETIN = 'https://shneurgreenberg.github.io/beit-menachem-bulletin/';

function run(cmd, opts = {}) {
  console.log('>', cmd);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beit-menachem-user-pages-'));
try {
  run(`git clone --depth 1 ${REPO} "${tmp}"`);

  // Remove old Flutter PWA files that register a broken service worker at "/"
  for (const name of [
    'main.dart.js',
    'main.dart.js.map',
    'flutter_service_worker.js',
    'manifest.json',
    'version.json',
    'favicon.png',
    'assets',
    'canvaskit',
    'icons',
  ]) {
    const p = path.join(tmp, name);
    fs.rmSync(p, { recursive: true, force: true });
  }

  fs.copyFileSync(path.join(SRC, 'index.html'), path.join(tmp, 'index.html'));
  fs.copyFileSync(path.join(SRC, '.nojekyll'), path.join(tmp, '.nojekyll'));

  run('git add -A', { cwd: tmp });
  const status = execSync('git status --porcelain', { cwd: tmp, encoding: 'utf8' }).trim();
  if (!status) {
    console.log('Nothing to change — user Pages already redirect to the bulletin.');
    console.log('Open:', BULLETIN);
    process.exit(0);
  }

  run(
    'git -c user.name="Beit Menachem" -c user.email="pages@beit-menachem.local" commit -m "Replace broken Flutter site with redirect to Shabbat bulletin"',
    { cwd: tmp },
  );
  try {
    run('git push origin HEAD', { cwd: tmp });
  } catch {
    console.error(`
Push failed — this environment cannot write to shneurGreenberg.github.io.

Fix manually (one of):
  1. On your machine (with write access):
       node scripts/fix-user-pages.mjs
  2. Or in GitHub: open shneurGreenberg/shneurGreenberg.github.io,
     replace index.html with the contents of user-site/index.html,
     add an empty .nojekyll file, and delete the old Flutter files
     (main.dart.js, flutter_service_worker.js, assets/, canvaskit/, …).

Working bulletin URL (already live):
  ${BULLETIN}
`);
    process.exit(1);
  }
  console.log('\nDone. Root https://shneurgreenberg.github.io/ now redirects to:');
  console.log(BULLETIN);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

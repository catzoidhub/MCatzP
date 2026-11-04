#!/usr/bin/env bun
// MCatzP's release files (MCatzP TODO #24, #25): one binary per computer, each alone at the root of its zip.
//   bun run release              build, sign, notarize, zip, sum into dist/release/ — nothing leaves except to Apple
//   bun run release --no-notarize  signed only, for a quick local test
//   bun run release --upload     also put them on the GitHub release v<version> (a draft if there is none yet)
// The asset names are a contract: the apps' Install MCatzP and the Catzoid API (catalog.go, Catzoid #86) depend on them.
// Windows: unsigned, the family rule since 2026-11-01 (the SignPath Foundation took no new projects; Catzoid #16).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'release');
const entry = join(root, 'packages/server/src/index.ts');
const entitlements = join(root, 'resources/mcatzp.entitlements.plist');
const identity = process.env.MCATZP_SIGN_IDENTITY ?? 'Developer ID Application: Mahryan Rakhmatullah (Q5Q5KKYWU7)';
const notaryProfile = process.env.MCATZP_NOTARY_PROFILE ?? 'mrcatz-notary';
const repo = 'catzoidhub/MCatzP';

const args = new Set(process.argv.slice(2));
const notarize = !args.has('--no-notarize');
const upload = args.has('--upload');

// x64 uses Bun's baseline build: it needs no AVX2, so it runs on older CPUs and under emulation (Windows on Arm, Rosetta).
const targets = [
  { id: 'mac-arm64', bun: 'bun-darwin-arm64', bin: 'mcatzp', mac: true, arch: 'arm64' },
  { id: 'mac-x64', bun: 'bun-darwin-x64-baseline', bin: 'mcatzp', mac: true, arch: 'x86_64' },
  { id: 'win-x64', bun: 'bun-windows-x64-baseline', bin: 'mcatzp.exe', mac: false },
];

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', cwd: opts.cwd ?? root });
  if (r.status !== 0 && !opts.allowFail) {
    if (opts.capture) process.stderr.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
    throw new Error(`${cmd} ${argv.join(' ')} failed`);
  }
  return r;
}

function version() {
  const pkg = JSON.parse(readFileSync(join(root, 'packages/server/package.json'), 'utf8')).version;
  const src = readFileSync(join(root, 'packages/server/src/version.ts'), 'utf8').match(/VERSION = '([^']+)'/)?.[1];
  if (pkg !== src) throw new Error(`package.json says ${pkg}, version.ts says ${src}: make them the same first.`);
  return pkg;
}

function notarizeZip(zip) {
  console.log(`  notarizing ${zip.split('/').pop()} …`);
  const r = run('xcrun', ['notarytool', 'submit', zip, '--keychain-profile', notaryProfile, '--wait', '--output-format', 'json'], { capture: true });
  const res = JSON.parse(r.stdout);
  if (res.status !== 'Accepted') {
    run('xcrun', ['notarytool', 'log', res.id, '--keychain-profile', notaryProfile], { allowFail: true });
    throw new Error(`Notarization of ${zip} ended as ${res.status}.`);
  }
}

// The check a user's computer makes: out of the zip, with the quarantine flag a browser sets, and it must start.
function checkLikeADownload(t, zip, v) {
  const dir = join(out, `check-${t.id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  run('unzip', ['-q', zip, '-d', dir]);
  const bin = join(dir, t.bin);
  run('xattr', ['-w', 'com.apple.quarantine', `0081;${Math.floor(Date.now() / 1000).toString(16)};Safari;`, bin]);
  const r = spawnSync('/usr/bin/arch', [`-${t.arch}`, bin, '--version'], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0 || r.stdout.trim() !== v) {
    if (t.arch === 'x86_64' && r.status !== 0 && /Bad CPU|cannot/i.test(`${r.stderr}`)) return console.log('  no Rosetta here: x64 not started');
    throw new Error(`${t.id} did not start like a download (status ${r.status}): ${r.stdout}${r.stderr}`);
  }
  console.log(`  ✓ starts with the quarantine flag: ${r.stdout.trim()}`);
}

const v = version();
if (upload && run('git', ['status', '--porcelain'], { capture: true }).stdout.trim()) {
  throw new Error('Uploading from a tree with uncommitted changes: commit first.');
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const sums = [];

for (const t of targets) {
  console.log(`\n${t.id}`);
  const dir = join(out, t.id);
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, t.bin);
  run('bun', ['build', entry, '--compile', `--target=${t.bun}`, '--outfile', bin], { capture: true });
  if (t.mac) {
    run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--identifier', 'com.mrcatz.mcatzp', '--entitlements', entitlements, '--sign', identity, bin], { capture: true });
    run('codesign', ['--verify', '--strict', bin]);
  }
  chmodSync(bin, 0o755);
  const name = `mcatzp-${v}-${t.id}.zip`;
  const zip = join(out, name);
  run('zip', ['-qXj', zip, bin]);
  if (t.mac && notarize) {
    notarizeZip(zip);
    checkLikeADownload(t, zip, v);
  }
  rmSync(dir, { recursive: true, force: true });
  const sum = createHash('sha256').update(readFileSync(zip)).digest('hex');
  sums.push(`${sum}  ${name}`);
  console.log(`  ${name}  ${sum}`);
}

const sumsFile = join(out, 'SHA256SUMS');
writeFileSync(sumsFile, `${sums.join('\n')}\n`);

if (upload) {
  const tag = `v${v}`;
  if (run('gh', ['release', 'view', tag, '-R', repo], { capture: true, allowFail: true }).status !== 0) {
    run('gh', ['release', 'create', tag, '-R', repo, '--draft', '--title', `MCatzP ${v}`, '--notes', `MCatzP ${v}`]);
  }
  run('gh', ['release', 'upload', tag, '-R', repo, '--clobber', sumsFile, ...targets.map((t) => join(out, `mcatzp-${v}-${t.id}.zip`))]);
  console.log(`\nOn the release ${tag} of ${repo}.`);
} else if (!existsSync(sumsFile)) {
  throw new Error('No sums written.');
}
console.log(`\nDone: ${out}${notarize ? '' : ' (not notarized)'}`);

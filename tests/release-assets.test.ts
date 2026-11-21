import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

interface ReleaseScript {
  parseLatest(text: string): { top: [string, string][]; files: [string, string][][] };
  mergeLatestMac(arm: string, x64: string): string;
  prepareRelease(options: { version: string; installersDir: string; stagingDir: string }): { assets: string[]; checksums: string };
  expectedInstallers(version: string): Record<string, string[]>;
}
const release = require(resolve('scripts/prepare-release.js')) as ReleaseScript;
const version = '0.2.0-dev.5';
const metadataName: Record<string, string> = { 'macos-arm64': 'latest-mac.yml', 'macos-x64': 'latest-mac.yml', 'linux-arm64': 'latest-linux-arm64.yml', 'linux-x64': 'latest-linux.yml', 'windows-x64': 'latest.yml' };
const sha512 = (data: Buffer) => createHash('sha512').update(data).digest('base64');
const latest = (entries: Array<{ url: string; data: Buffer }>) => [`version: ${version}`, 'files:', ...entries.flatMap(({ url, data }) => [`  - url: ${url}`, `    sha512: ${sha512(data)}`, `    size: ${data.length}`]),
  `path: ${entries[0].url}`, `sha512: ${sha512(entries[0].data)}`, "releaseDate: '2026-11-21T09:08:27.029Z'", ''].join('\n');

function fixture(root: string, tamper?: (dir: string, platform: string) => void): string {
  const installers = join(root, 'installers');
  for (const [platform, names] of Object.entries(release.expectedInstallers(version))) {
    const dir = join(installers, `mai-studio-${platform}`); mkdirSync(dir, { recursive: true });
    const entries = names.filter(name => !name.endsWith('.deb')).map(name => ({ url: name, data: Buffer.from(`${platform}:${name}`) }));
    for (const name of names) writeFileSync(join(dir, name), `${platform}:${name}`);
    writeFileSync(join(dir, `${names[0]}.blockmap`), 'blockmap');
    writeFileSync(join(dir, metadataName[platform]), latest(entries));
    tamper?.(dir, platform);
  }
  return installers;
}

test('release staging merges both macOS architectures and matches every metadata URL to an asset', () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-release-'));
  try {
    const { assets, checksums } = release.prepareRelease({ version, installersDir: fixture(root), stagingDir: join(root, 'staging') });
    for (const name of ['latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml', 'latest.yml', 'SHA256SUMS.txt', `MaiStudio-Setup-${version}.exe`, `MaiStudio-Setup-${version}.exe.blockmap`]) assert.ok(assets.includes(name), name);
    assert.ok(assets.every(name => !/\s/.test(name)));
    assert.equal(checksums.trim().split('\n').length, 9);
    const mac = readFileSync(join(root, 'staging/assets/latest-mac.yml'), 'utf8');
    const urls = release.parseLatest(mac).files.map(entry => entry[0][1]);
    assert.deepEqual(urls, [`MaiStudio-${version}-arm64.dmg`, `MaiStudio-${version}-arm64.zip`, `MaiStudio-${version}-x64.dmg`, `MaiStudio-${version}-x64.zip`]);
    assert.match(mac, new RegExp(`^version: ${version}\nfiles:\n`));
    assert.match(mac, new RegExp(`\npath: MaiStudio-${version}-arm64.dmg\n`));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('release staging refuses mismatched hashes, renamed installers and differing mac versions', () => {
  const cases: Array<[RegExp, (dir: string, platform: string) => void]> = [
    [/sha512/, (dir, platform) => { if (platform === 'windows-x64') writeFileSync(join(dir, `MaiStudio-Setup-${version}.exe`), 'tampered'); }],
    [/installer set/, (dir, platform) => { if (platform === 'windows-x64') { rmSync(join(dir, `MaiStudio-Setup-${version}.exe`)); writeFileSync(join(dir, `MaiStudio Setup ${version}.exe`), 'x'); } }],
    [/versions differ/, (dir, platform) => { if (platform === 'macos-x64') writeFileSync(join(dir, 'latest-mac.yml'), readFileSync(join(dir, 'latest-mac.yml'), 'utf8').replace(`version: ${version}`, 'version: 0.2.0-dev.4')); }],
    [/not a release asset/, (dir, platform) => { if (platform === 'linux-x64') writeFileSync(join(dir, 'latest-linux.yml'), readFileSync(join(dir, 'latest-linux.yml'), 'utf8').replace(`url: MaiStudio-${version}.AppImage`, 'url: ../MaiStudio.AppImage')); }],
  ];
  for (const [error, tamper] of cases) {
    const root = mkdtempSync(join(tmpdir(), 'maistudio-release-bad-'));
    try { assert.throws(() => release.prepareRelease({ version, installersDir: fixture(root, tamper), stagingDir: join(root, 'staging') }), error); }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
});

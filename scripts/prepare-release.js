/**
 * prepare-release.js - stage installers and electron-updater metadata for a GitHub release.
 *
 * Checks the installer set of each CI package job, merges the two macOS latest-mac.yml files
 * (arm64 and x64 are built on separate runners), checks that every URL in latest*.yml names a
 * staged asset with the same sha512/size, and writes SHA256SUMS.txt plus release notes.
 *
 * Usage: RELEASE_TAG=v<version> node scripts/prepare-release.js <installersDir> <stagingDir>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INSTALLER = /\.(dmg|zip|deb|AppImage|exe)$/;
const METADATA = { 'macos-arm64': 'latest-mac.yml', 'macos-x64': 'latest-mac.yml', 'linux-arm64': 'latest-linux-arm64.yml', 'linux-x64': 'latest-linux.yml', 'windows-x64': 'latest.yml' };

function expectedInstallers(version) {
  return {
    'macos-arm64': [`MaiStudio-${version}-arm64.dmg`, `MaiStudio-${version}-arm64.zip`],
    'macos-x64': [`MaiStudio-${version}-x64.dmg`, `MaiStudio-${version}-x64.zip`],
    'linux-arm64': [`MaiStudio-${version}-arm64.AppImage`, `mai-studio_${version}_arm64.deb`],
    'linux-x64': [`MaiStudio-${version}.AppImage`, `mai-studio_${version}_amd64.deb`],
    'windows-x64': [`MaiStudio-Setup-${version}.exe`],
  };
}

// electron-builder writes a fixed, flat YAML shape; anything else fails instead of being guessed.
function parseLatest(text) {
  const top = []; const files = []; let inFiles = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let match;
    if ((match = /^([A-Za-z]\w*):(?: (.*))?$/.exec(line))) {
      inFiles = match[1] === 'files' && match[2] === undefined;
      if (!inFiles) top.push([match[1], match[2] ?? '']);
    } else if (inFiles && (match = /^ {2}- (\w+): (.*)$/.exec(line))) files.push([[match[1], match[2]]]);
    else if (inFiles && files.length && (match = /^ {4}(\w+): (.*)$/.exec(line))) files[files.length - 1].push([match[1], match[2]]);
    else throw new Error(`Unsupported update metadata line: ${line}`);
  }
  return { top, files };
}
function scalar(raw) {
  if (/^'.*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(raw)) return JSON.parse(raw);
  return raw;
}
const field = (pairs, key) => { const pair = pairs.find(([name]) => name === key); return pair ? scalar(pair[1]) : undefined; };
function serializeLatest({ top, files }) {
  const lines = [];
  for (const [key, value] of top) {
    lines.push(`${key}: ${value}`);
    if (key === 'version') { lines.push('files:'); for (const entry of files) entry.forEach(([name, raw], index) => lines.push(`${index ? '    ' : '  - '}${name}: ${raw}`)); }
  }
  return lines.join('\n') + '\n';
}

function mergeLatestMac(armText, x64Text) {
  const arm = parseLatest(armText); const x64 = parseLatest(x64Text);
  if (field(arm.top, 'version') !== field(x64.top, 'version')) throw new Error('latest-mac.yml versions differ between arm64 and x64');
  const files = [...arm.files, ...x64.files];
  const urls = files.map(entry => field(entry, 'url'));
  if (new Set(urls).size !== urls.length) throw new Error('latest-mac.yml lists the same file twice');
  return serializeLatest({ top: arm.top, files });
}

function digest(file, algorithm, encoding) { return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding); }

function checkMetadata(text, version, dir) {
  const { top, files } = parseLatest(text);
  if (field(top, 'version') !== version) throw new Error(`metadata version ${field(top, 'version')} differs from ${version}`);
  if (!files.length) throw new Error('metadata has no files');
  for (const entry of files) {
    const url = field(entry, 'url');
    const file = path.join(dir, url);
    if (path.basename(url) !== url || !fs.existsSync(file)) throw new Error(`metadata URL ${url} is not a release asset`);
    if (digest(file, 'sha512', 'base64') !== field(entry, 'sha512')) throw new Error(`sha512 of ${url} differs from metadata`);
    if (Number(field(entry, 'size')) !== fs.statSync(file).size) throw new Error(`size of ${url} differs from metadata`);
  }
  const legacy = field(top, 'path');
  if (legacy !== undefined && !files.some(entry => field(entry, 'url') === legacy)) throw new Error(`metadata path ${legacy} is not listed in files`);
  return files.map(entry => field(entry, 'url'));
}

function prepareRelease({ version, installersDir, stagingDir }) {
  const assets = path.join(stagingDir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const stage = (source, name = path.basename(source)) => {
    if (/\s/.test(name)) throw new Error(`release asset name has whitespace: ${name}`);
    const target = path.join(assets, name);
    if (fs.existsSync(target)) throw new Error(`duplicate release asset: ${name}`);
    const info = fs.lstatSync(source);
    if (!info.isFile() || info.size === 0) throw new Error(`release asset is not a non-empty regular file: ${source}`);
    fs.copyFileSync(source, target); return target;
  };
  const installers = []; const metadata = {};
  for (const [platform, names] of Object.entries(expectedInstallers(version))) {
    const dir = path.join(installersDir, `mai-studio-${platform}`);
    const present = fs.readdirSync(dir);
    const actual = present.filter(name => INSTALLER.test(name)).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...names].sort())) throw new Error(`unexpected installer set for ${platform}: ${actual.join(', ')}`);
    const yml = present.filter(name => name.endsWith('.yml'));
    if (JSON.stringify(yml) !== JSON.stringify([METADATA[platform]])) throw new Error(`unexpected update metadata for ${platform}: ${yml.join(', ')}`);
    for (const name of names) installers.push(stage(path.join(dir, name)));
    for (const name of present.filter(item => item.endsWith('.blockmap'))) {
      if (!names.includes(name.slice(0, -'.blockmap'.length))) throw new Error(`blockmap without installer: ${name}`);
      stage(path.join(dir, name));
    }
    (metadata[METADATA[platform]] ??= []).push(fs.readFileSync(path.join(dir, METADATA[platform]), 'utf8'));
  }
  for (const [name, texts] of Object.entries(metadata)) {
    const text = name === 'latest-mac.yml' ? mergeLatestMac(texts[0], texts[1]) : texts[0];
    checkMetadata(text, version, assets);
    fs.writeFileSync(path.join(assets, name), text);
  }
  const checksums = installers.sort().map(file => `${digest(file, 'sha256', 'hex')}  ${path.basename(file)}`).join('\n') + '\n';
  fs.writeFileSync(path.join(assets, 'SHA256SUMS.txt'), checksums);
  return { assets: fs.readdirSync(assets).sort(), checksums };
}

function releaseNotes(version, checksums, env) {
  const kind = version.includes('-') ? 'bản phát triển thử nghiệm' : 'bản phát hành';
  return `MaiStudio ${version} — ${kind} cho macOS Apple Silicon/Intel, Linux ARM64/x64 và Windows x64.

- Nguồn build: ${env.GITHUB_SHA}. CI: https://github.com/${env.GH_REPO}/actions/runs/${env.GITHUB_RUN_ID}. Release chỉ được tạo sau verify và năm job đóng gói thành công.
- Cập nhật trong app (từ 0.2.0-dev.5): Windows và Linux AppImage tự tải và cài; macOS tải và mở dmg đúng kiến trúc sau khi kiểm sha512; Linux .deb mở trang release để tải tay.
- Linux ARM64/Kubuntu: tải tệp _arm64.deb hoặc ARM64 AppImage.

macOS ký ad-hoc, chưa notarized; Windows chưa ký chứng chỉ tin cậy. Chưa chứng nhận runtime mọi OS/provider.

SHA256 của các bộ cài:
\`\`\`text
${checksums}\`\`\`
`;
}

module.exports = { parseLatest, mergeLatestMac, checkMetadata, prepareRelease, expectedInstallers };

if (require.main === module) {
  const [installersDir, stagingDir] = process.argv.slice(2);
  if (!installersDir || !stagingDir) throw new Error('Usage: node scripts/prepare-release.js <installersDir> <stagingDir>');
  const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version) || process.env.RELEASE_TAG !== `v${version}`) throw new Error(`Release tag ${process.env.RELEASE_TAG} must equal v${version} from package.json`);
  const { assets, checksums } = prepareRelease({ version, installersDir, stagingDir });
  fs.writeFileSync(path.join(stagingDir, 'release-notes.md'), releaseNotes(version, checksums, process.env));
  console.log(`Staged ${assets.length} assets for ${version}:\n${assets.join('\n')}`);
}

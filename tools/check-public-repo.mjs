// Read-only publication check. Never reads ignored credential or evidence files.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const git = (...args) => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
const files = [
  ...new Set(
    git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
      .toString()
      .split('\0')
      .filter(Boolean),
  ),
];
const failures = [];
const privatePath =
  /^(?:archive\/|data\/|output\/|docs\/research\/|\.env(?:\.|$)(?!example$))|(?:\.sqlite(?:-wal|-shm)?|\.db|\.tar\.gz|\.zip)$|^[^/]+\.pdf$|^research\/paper-extracted\.txt$/i;
const maintainedMarkdown = new Set(['README.md', 'AGENTS.md', 'FINAL_EVALUATION.md']);
for (const name of files.filter((name) => name.endsWith('.md') && existsSync(name))) {
  if (!maintainedMarkdown.has(name)) failures.push(`${name}: redundant maintained Markdown`);
}
for (const name of maintainedMarkdown) {
  if (!files.includes(name) || !existsSync(name)) failures.push(`${name}: required guide absent`);
}
const patterns = [
  ['personal folder path', /\/(?:Users|home)\/[a-zA-Z0-9_.-]+\//],
  ['account resource ID', /(?:project|tenant|vpcsubnet|computefilesystem)-e00[a-z0-9]{8,}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['API token', /\bsk-[a-zA-Z0-9_-]{24,}\b/],
  [
    'non-example API key assignment',
    /(?:NEBIUS_API_KEY|OPENAI_API_KEY)\s*[:=]\s*["']?[a-zA-Z0-9_./+-]{32,}/,
  ],
];
function inspect(name, bytes, historical = false) {
  if (privatePath.test(name))
    failures.push(`${historical ? 'history: ' : ''}${name}: private artifact path`);
  if (bytes.length > 5 * 1024 * 1024)
    failures.push(`${name}: file exceeds 5 MiB; review before publishing`);
  if (bytes.includes(0)) return;
  const lines = bytes.toString('utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const [label, pattern] of patterns) {
      if (pattern.test(lines[i]))
        failures.push(`${historical ? 'history: ' : ''}${name}:${i + 1}: ${label}`);
    }
  }
  if (!historical && name.endsWith('.md')) {
    for (const match of bytes.toString().matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const link = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!link || /^(?:https?:|mailto:|#)/.test(link)) continue;
      const target = resolve(dirname(name), decodeURIComponent(link));
      const relative = target.slice(process.cwd().length + 1).replaceAll('\\', '/');
      if (
        !existsSync(target) ||
        !(
          files.includes(relative) ||
          files.some((file) => file.startsWith(relative.replace(/\/$/, '') + '/'))
        )
      )
        failures.push(`${name}: link target is absent from publication: ${link}`);
    }
  }
}
for (const name of files) {
  if (existsSync(name) && statSync(name).isFile()) inspect(name, readFileSync(name));
}
// Publishable commit history only. App-managed refs/codex trees are private
// checkpoints, not commits to push. Stale remote-tracking refs are not pushed.
const objects = git('rev-list', '--objects', 'HEAD', '--branches', '--tags')
  .toString()
  .trim()
  .split('\n');
let historicalBlobs = 0;
for (const object of objects) {
  const [sha, ...parts] = object.split(' ');
  const name = parts.join(' ');
  if (!name || git('cat-file', '-t', sha).toString().trim() !== 'blob') continue;
  historicalBlobs++;
  if (Number(git('cat-file', '-s', sha).toString()) > 5 * 1024 * 1024) {
    failures.push(`history: ${name}: file exceeds 5 MiB; review before publishing`);
    continue;
  }
  inspect(name, git('cat-file', 'blob', sha), true);
}
if (failures.length) {
  console.error([...new Set(failures)].join('\n'));
  console.error(
    'Publication check failed. Findings show locations and categories only, never matched values.',
  );
  process.exitCode = 1;
} else {
  console.log(
    `Publication check passed: ${files.length} candidate files and ${historicalBlobs} reachable historical blobs; Markdown links checked. Ignored local credentials/evidence were not read.`,
  );
}

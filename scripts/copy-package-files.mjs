import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const out = 'dist-lib/ngx-cloudflare';
const repo = 'https://github.com/erkamyaman/ngx-cloudflare/blob/main/';

const readme = readFileSync('README.md', 'utf8').replace(
  /(\]\(|href=")(?!https?:|#|mailto:)([^)"]+)/g,
  (_match, prefix, path) => `${prefix}${repo}${path}`,
);
writeFileSync(`${out}/README.md`, readme);
copyFileSync('LICENSE', `${out}/LICENSE`);
copyFileSync('CHANGELOG.md', `${out}/CHANGELOG.md`);

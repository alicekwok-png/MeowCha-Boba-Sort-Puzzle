#!/usr/bin/env node
// tools/asset-version.js — 資產版本號 = assets/v2 + levels + config.json 全部檔案內容嘅 hash（8 hex）。
//   寫入 src/config/asset-version.js，並同步 index.html / styles.css 靜態引用嘅 ?v=。
//   npm run gen / gen:practice / build-assets 之後自動跑（package.json）；tests/assets.test.js 會驗 hash 同檔案一致，漏跑就測試炸。
// 背景（2026-09-05）：iOS Safari 用舊 cache 嘅 vessels.json 配新樽 sprite → 液帶變六角形。boot.js 係 force-cache，URL 唔變就永遠唔更新。

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TRACKED = ['assets/v2', 'assets/icons', 'levels', 'config.json', 'i18n'];

function walk(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) { for (const n of readdirSync(p).sort()) walk(join(p, n), out); }
  else out.push(p);
}
export function computeAssetVersion(root = ROOT) {
  const files = [];
  for (const t of TRACKED) walk(join(root, t), files);
  const h = createHash('sha256');
  for (const f of files) { h.update(f.slice(root.length).replace(/\\/g, '/')); h.update(readFileSync(f)); }
  return h.digest('hex').slice(0, 8);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('asset-version.js')) {
  const v = computeAssetVersion();
  writeFileSync(join(ROOT, 'src/config/asset-version.js'),
    `// 由 tools/asset-version.js 生成（npm run version:assets），唔好手改。資產 / 關卡 / 設定檔任何改動都會變。\nexport const ASSET_VERSION = '${v}';\n`);
  for (const f of ['index.html', 'styles.css']) {
    const p = join(ROOT, f);
    const s = readFileSync(p, 'utf8');
    const next = s.replace(/\?v=[A-Za-z0-9]+/g, '?v=' + v);
    if (next !== s) writeFileSync(p, next);
  }
  console.log('ASSET_VERSION', v);
}

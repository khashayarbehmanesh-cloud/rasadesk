#!/usr/bin/env node
// فقط‌ویندوز کردن workflow ساخت RustDesk (1.5.0) و نام‌گذاری خروجی‌ها به rasadesk
//   node trim-windows.js <rustdesk-root> <out-dir>
// خروجی: <out-dir>/.github/workflows/flutter-build.yml  و  rasadesk-windows.yml
// (فایل‌های workflow را باید خودتان آپلود کنید؛ توکن پیش‌فرض Actions اجازه‌ی تغییر workflow را ندارد.)
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const out = path.resolve(process.argv[3] || './out');
const src = path.join(root, '.github', 'workflows', 'flutter-build.yml');
let s = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');

const idx = (needle) => { const i = s.indexOf(needle); if (i < 0) throw new Error('not found: ' + needle.trim()); return i; };
const head = s.slice(0, idx('\n  generate-sbom:') + 1);
const body = s.slice(idx('\n  generate-bridge:') + 1, idx('\n  # The fallback for the flutter version, we use Sciter'));
s = head + body;

function drop(re, label) {
  if (!re.test(s)) throw new Error('not found: ' + label);
  s = s.replace(re, '');
}
drop(/          - \{\n              target: windows-11-arm,[\s\S]*?\n            \}\n/, 'topmost arm64 matrix entry');
drop(/          - \{\n              target: aarch64-pc-windows-msvc,[\s\S]*?\n            \}\n/, 'windows arm64 matrix entry');

// نام خروجی‌ها: rustdesk-<ver>-x86_64.exe/.msi  ->  rasadesk-<ver>-x86_64.exe/.msi
const before = (s.match(/SignOutput\/rustdesk-/g) || []).length;
if (before < 3) throw new Error('unexpected SignOutput references: ' + before);
s = s.replace(/SignOutput\/rustdesk-/g, 'SignOutput/rasadesk-');

fs.mkdirSync(path.join(out, '.github', 'workflows'), { recursive: true });
fs.writeFileSync(path.join(out, '.github', 'workflows', 'flutter-build.yml'), s);
fs.writeFileSync(path.join(out, '.github', 'workflows', 'rasadesk-windows.yml'),
`name: RasaDesk - Windows build

on:
  workflow_dispatch:

jobs:
  build:
    uses: ./.github/workflows/flutter-build.yml
    secrets: inherit
    with:
      upload-artifact: true
      upload-tag: "rasadesk-latest"
`);
console.log('OK ->', out, `(${s.split('\n').length} lines)`);

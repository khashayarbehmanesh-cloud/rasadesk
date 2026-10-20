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

// برندینگ زیرماژول hbb_common (نام برنامه، سرور، کلید) در commit قابل ثبت نیست؛ هر بار هنگام ساخت اعمال می‌شود
{
  const re = /(      - name: Checkout source code\n        uses: [^\n]+\n        with:\n          submodules: recursive\n)/;
  if ((s.match(new RegExp(re.source, 'g')) || []).length !== 1) throw new Error('checkout step not found exactly once');
  s = s.replace(re, `$1
      - name: Apply RasaDesk branding (hbb_common submodule)
        shell: bash
        run: node rasadesk/client/apply-branding.js . rasadesk/client/brand.json
`);
}

// خروجی نصب‌کننده‌ها هم به‌صورت Artifact ذخیره شود (Release گاهی خطای سرور GitHub می‌دهد) و خطای Release کل ساخت را خراب نکند
{
  const marker = '      - name: Publish Release\n        uses: softprops/action-gh-release';
  if ((s.split(marker).length - 1) !== 1) throw new Error('Publish Release step not found exactly once');
  s = s.replace(marker,
`      - name: Upload installers (exe/msi)
        if: env.UPLOAD_ARTIFACT == 'true'
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: rasadesk-installers-windows
          path: ./SignOutput

      - name: Publish Release
        continue-on-error: true
        uses: softprops/action-gh-release`);
}

// MSI با نام و تصاویر رسا ساخته شود: روی یک نسخه‌ی کپی، rustdesk.exe -> RasaDesk.exe (مثل کلاینت سفارشی) و تصاویر ویزارد
{
  const from = '          pushd ./res/msi\n          python preprocess.py --arp -d ../../rustdesk\n';
  if ((s.split(from).length - 1) !== 1) throw new Error('msi preprocess step not found exactly once');
  s = s.replace(from, [
    '          Copy-Item -Recurse ./rustdesk ./rustdesk-ras',
    '          Rename-Item ./rustdesk-ras/rustdesk.exe RasaDesk.exe',
    '          New-Item -ItemType Directory -Force ./res/msi/Package/Resources | Out-Null',
    '          Copy-Item ./rasadesk/client/branding/msi/*.bmp ./res/msi/Package/Resources/ -ErrorAction SilentlyContinue',
    '          pushd ./res/msi',
    '          python preprocess.py --arp -d ../../rustdesk-ras --app-name RasaDesk --manufacturer "Rasa Systems"',
    '',
  ].join('\n'));
}

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

#!/usr/bin/env node
// برندینگ اندروید رسا دسک (بعد از apply-branding.js اجرا می‌شود؛ آن اسکریپت Dart/Rust مشترک را برند می‌کند)
//   node apply-branding-android.js <rustdesk-root> [brand.json]
// مجوز: AGPL-3.0 مثل RustDesk. اعلان حق نشر نویسندگان اصلی در صفحه‌ی «درباره» حفظ می‌شود.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const brand = JSON.parse(fs.readFileSync(process.argv[3] || path.join(__dirname, 'brand.json'), 'utf8').replace(/^﻿/, ''));
let problems = 0;

const p = (...a) => path.join(root, ...a);
const fail = (msg) => { console.error('✗ ' + msg); problems++; };
const ok = (msg) => console.log('✓ ' + msg);
const shown = brand.displayName || brand.appName;
const appId = brand.androidAppId || ((brand.org || 'ir.rasa99') + '.' + String(brand.appName || 'rasadesk').toLowerCase());
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function patch(file, fn, label) {
  if (!fs.existsSync(file)) return fail(`${label}: file not found (${path.relative(root, file)})`);
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  const before = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  const after = fn(before);
  if (after === null) return fail(`${label}: pattern not found`);
  if (after !== before) fs.writeFileSync(file, crlf ? after.replace(/\n/g, '\r\n') : after);
  ok(label);
}

const androidApp = p('flutter', 'android', 'app');
const main = path.join(androidApp, 'src', 'main');
const kt = path.join(main, 'kotlin', 'com', 'carriez', 'flutter_hbb');

// 1) شناسه‌ی بسته (applicationId) — namespace/کد Kotlin دست‌نخورده می‌ماند
patch(path.join(androidApp, 'build.gradle'), (s) => {
  const a = 'applicationId "com.carriez.flutter_hbb"';
  if (s.includes(a)) return s.replace(a, 'applicationId ' + JSON.stringify(appId));
  return s.includes('applicationId ' + JSON.stringify(appId)) ? s : null;
}, 'Android: applicationId = ' + appId);

// 2) نام برنامه و سرویس دسترسی‌پذیری در Manifest
patch(path.join(main, 'AndroidManifest.xml'), (s) => {
  let t = s;
  t = t.replace('android:label="RustDesk Input"', 'android:label="' + xml(shown) + ' Input"');
  t = t.replace('android:label="RustDesk"', 'android:label="@string/app_name"');
  return /android:label="RustDesk/.test(t) ? null : t;
}, 'Android: manifest labels');

// 3) متن‌های strings.xml
patch(path.join(main, 'res', 'values', 'strings.xml'), (s) => {
  const t = s.replace(/RustDesk/g, xml(shown));
  return /RustDesk/.test(t) ? null : t;
}, 'Android: strings.xml');

// 4) متن‌های قابل‌مشاهده در Kotlin (اعلان، Toast)
patch(path.join(kt, 'MainService.kt'), (s) => {
  let t = s;
  t = t.replace('const val DEFAULT_NOTIFY_TITLE = "RustDesk"', 'const val DEFAULT_NOTIFY_TITLE = ' + JSON.stringify(shown));
  t = t.replace('val channelName = "RustDesk Service"', 'val channelName = ' + JSON.stringify(shown + ' Service'));
  t = t.replace('description = "RustDesk Service Channel"', 'description = ' + JSON.stringify(shown + ' Service Channel'));
  return /"RustDesk( Service( Channel)?)?"/.test(t.replace('val channelId = "RustDesk"', '')) ? null : t;
}, 'Android: notification texts');
patch(path.join(kt, 'BootReceiver.kt'), (s) => {
  const a = '"RustDesk is Open"';
  if (s.includes(a)) return s.replace(a, JSON.stringify(shown + ' is Open'));
  return s.includes('RustDesk is Open') ? null : s;
}, 'Android: boot toast');

// 5) آیکن‌ها (از branding/android/mipmap-*)
{
  const srcRoot = path.join(__dirname, 'branding', 'android');
  let n = 0;
  if (!fs.existsSync(srcRoot)) {
    fail('icons: branding/android not found');
  } else {
    for (const d of fs.readdirSync(srcRoot)) {
      const from = path.join(srcRoot, d);
      if (!fs.statSync(from).isDirectory()) continue;
      const to = path.join(main, 'res', d);
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(from)) { fs.copyFileSync(path.join(from, f), path.join(to, f)); n++; }
    }
    ok('Android: icons copied (' + n + ' files)');
  }
}

if (problems) { console.error(`\n${problems} problem(s)`); process.exit(1); }
console.log('\nOK — Android branding applied (applicationId ' + appId + ')');

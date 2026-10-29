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

// 6) نسخه‌ی «فقط کنترل‌کننده» (RASA_ANDROID_VIEWER=1): از گوشی فقط می‌شود به رایانه وصل شد.
// حالت outgoing-only خود RustDesk صفحه‌ی اشتراک و چت را از برنامه حذف می‌کند؛ سرویس‌ها و مجوزهای حساس
// (دسترسی‌پذیری، نمایش روی برنامه‌ها، ضبط صفحه/صدا، راه‌اندازی خودکار) هم از Manifest برداشته می‌شوند.
if (process.env.RASA_ANDROID_VIEWER === '1') {
  patch(p('libs', 'hbb_common', 'src', 'config.rs'), (s) => {
    const a = 'pub static ref HARD_SETTINGS: RwLock<HashMap<String, String>> = Default::default();';
    const b = 'pub static ref HARD_SETTINGS: RwLock<HashMap<String, String>> = RwLock::new(HashMap::from([("conn-type".to_owned(), "outgoing".to_owned())]));';
    if (s.includes(a)) return s.replace(a, b);
    return s.includes('("conn-type".to_owned(), "outgoing".to_owned())') ? s : null;
  }, 'Android viewer: outgoing-only mode');

  patch(path.join(main, 'AndroidManifest.xml'), (s) => {
    let t = s;
    const cut = (re, label) => { if (!re.test(t)) { if (/INPUT_REMOVED/.test(t)) return; throw new Error('manifest block not found: ' + label); } t = t.replace(re, ''); };
    try {
      cut(/\s*<receiver\s+android:name="\.BootReceiver"[\s\S]*?<\/receiver>/, 'BootReceiver');
      cut(/\s*<service\s+android:name="\.InputService"[\s\S]*?<\/service>/, 'InputService');
      cut(/\s*<service\s+android:name="\.MainService"[\s\S]*?<\/service>/, 'MainService');
      cut(/\s*<service\s+android:name="\.FloatingWindowService"[^>]*\/>/, 'FloatingWindowService');
    } catch (e) { console.error('✗ ' + e.message); return null; }
    for (const perm of ['SYSTEM_ALERT_WINDOW', 'RECORD_AUDIO', 'RECEIVE_BOOT_COMPLETED', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      'FOREGROUND_SERVICE_MEDIA_PROJECTION', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_SPECIAL_USE', 'FOREGROUND_SERVICE']) {
      t = t.replace(new RegExp('\\s*<uses-permission android:name="android\\.permission\\.' + perm + '"\\s*/>'), '');
    }
    return /InputService|MainService|BootReceiver|FloatingWindowService|SYSTEM_ALERT_WINDOW|BIND_ACCESSIBILITY_SERVICE/.test(t) ? null : t;
  }, 'Android viewer: services and sensitive permissions removed from manifest');
}
if (problems) { console.error(`\n${problems} problem(s)`); process.exit(1); }
console.log('\nOK — Android branding applied (applicationId ' + appId + ')');

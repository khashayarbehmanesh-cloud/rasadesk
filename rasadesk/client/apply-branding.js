#!/usr/bin/env node
// اعمال برندینگ رسا دسک روی سورس RustDesk (اجرا در ریشه‌ی فورک، بعد از checkout با submodules)
//   node apply-branding.js <rustdesk-root> [brand.json]
// مجوز: AGPL-3.0 مثل RustDesk. این اسکریپت فقط سورس را تغییر می‌دهد؛ LICENCE اصلی را حفظ کنید.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const brand = JSON.parse(fs.readFileSync(process.argv[3] || path.join(__dirname, 'brand.json'), 'utf8').replace(/^﻿/, ''));
const strict = process.env.RASA_STRICT !== '0'; // خطا اگر الگویی پیدا نشد
let problems = 0;

const p = (...a) => path.join(root, ...a);
const read = (f) => fs.readFileSync(f, 'utf8');
const write = (f, s) => fs.writeFileSync(f, s);
const fail = (msg) => { console.error('✗ ' + msg); problems++; };
const ok = (msg) => console.log('✓ ' + msg);
const js = (s) => JSON.stringify(String(s)); // رشته‌ی امن برای Rust/Dart

function patch(file, fn, label) {
  if (!fs.existsSync(file)) return fail(`${label}: file not found (${path.relative(root, file)})`);
  const before = read(file);
  const after = fn(before);
  if (after === null) return fail(`${label}: pattern not found`);
  if (after !== before) write(file, after);
  ok(label);
}
const replaceOnce = (re, to) => (s) => (re.test(s) ? s.replace(re, to) : null);

// ---- 1) ثابت‌های Dart
const cfgDart = `// تولید شده توسط apply-branding.js - دستی ویرایش نکنید
const String kRasaAdsBaseUrl = ${js(brand.adsBaseUrl.replace(/\/$/, ''))};
const String kRasaRequestAdUrl = ${js(brand.requestAdUrl)};
`;
const widgetsDir = p('flutter', 'lib', 'common', 'widgets');
write(path.join(widgetsDir, 'rasa_config.dart'), cfgDart);
fs.copyFileSync(path.join(__dirname, 'rasa_ad_banner.dart'), path.join(widgetsDir, 'rasa_ad_banner.dart'));
ok('Dart: rasa_config.dart + rasa_ad_banner.dart');

// ---- 2) نوار تبلیغات در صفحه‌ی اصلی دسکتاپ (پایین پنل راست)
patch(p('flutter', 'lib', 'desktop', 'pages', 'desktop_home_page.dart'), (s) => {
  if (s.includes('RasaAdBanner')) return s; // قبلاً اعمال شده
  let t = s.replace("import '../widgets/button.dart';",
    "import '../widgets/button.dart';\nimport 'package:flutter_hbb/common/widgets/rasa_ad_banner.dart';");
  const re = /buildRightPane\(BuildContext context\) \{\s*return Container\(\s*color: Theme\.of\(context\)\.scaffoldBackgroundColor,\s*child: ConnectionPage\(\),\s*\);\s*\}/;
  if (!re.test(t) || !t.includes('rasa_ad_banner.dart')) return null;
  return t.replace(re, `buildRightPane(BuildContext context) {
    return Container(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: Column(
        children: [
          Expanded(child: ConnectionPage()),
          const RasaAdBanner(),
        ],
      ),
    );
  }`);
}, 'Dart: ad banner in desktop_home_page');

// ---- 2b) نوار تبلیغات در موبایل (اندروید/iOS): زیر صفحه‌ی فعال، بالای نوار پایین
patch(p('flutter', 'lib', 'mobile', 'pages', 'home_page.dart'), (s) => {
  if (s.includes('RasaAdBanner')) return s;
  const imp = "import 'connection_page.dart';";
  const body = 'body: _pages.elementAt(_selectedIndex),';
  if (!s.includes(imp) || !s.includes(body)) return null;
  return s.replace(imp, imp + "\nimport 'package:flutter_hbb/common/widgets/rasa_ad_banner.dart';")
    .replace(body, `body: Column(children: [
            Expanded(child: _pages.elementAt(_selectedIndex)),
            const RasaAdBanner(),
          ]),`);
}, 'Dart: ad banner in mobile home_page');

// ---- 3) نام محصول (Windows/Cargo)
patch(p('Cargo.toml'), (s) => {
  const t = s
    .replace('description = "RustDesk Remote Desktop"', `description = ${js(brand.description)}`)
    .replace('ProductName = "RustDesk"', `ProductName = ${js(brand.displayName)}`)
    .replace('FileDescription = "RustDesk Remote Desktop"', `FileDescription = ${js(brand.description)}`)
    .replace(/(\[package\.metadata\.bundle\][\s\S]*?\nname = )"RustDesk"/, `$1${js(brand.displayName)}`);
  return t;
}, 'Cargo.toml metadata');

patch(p('flutter', 'windows', 'runner', 'Runner.rc'), (s) =>
  s.replace('VALUE "FileDescription", "RustDesk Remote Desktop"', `VALUE "FileDescription", ${js(brand.description)}`)
   .replace('VALUE "ProductName", "RustDesk"', `VALUE "ProductName", ${js(brand.displayName)}`),
  'Runner.rc version info');

// ---- 4) hbb_common: نام برنامه، سرور و کلید (submodule باید checkout شده باشد)
const cfgRs = p('libs', 'hbb_common', 'src', 'config.rs');
if (!fs.existsSync(cfgRs)) {
  fail('libs/hbb_common is empty - checkout with submodules: recursive');
} else {
  patch(cfgRs, (s) => {
    let t = s;
    const steps = [
      [/(pub static ref APP_NAME: RwLock<String> = RwLock::new\()"[^"]*"/, `$1${js(brand.appName)}`],
      [/(pub static ref ORG: RwLock<String> = RwLock::new\()"[^"]*"/, `$1${js(brand.org)}`],
      [/(pub const RENDEZVOUS_SERVERS: &\[&str\] = &)\[[\s\S]*?\];/, `$1[${(brand.idServers || [brand.idServer]).map(js).join(", ")}];`],
      [/(pub const RS_PUB_KEY: &str = )"[^"]*"/, `$1${js(brand.serverKey)}`],
    ];
    for (const [re, to] of steps) { if (!re.test(t)) return null; t = t.replace(re, to); }
    return t;
  }, 'hbb_common config.rs (APP_NAME, ORG, server, key)');
}

// ---- 4b) حساب‌دار شدن ترافیک relay بر اساس «کسی که وصل می‌شود»: ID خودِ کلاینت در فیلد token درخواست اتصال
patch(p('src', 'client.rs'), (s) => {
  const from = 'token: token.to_owned(),';
  if (s.includes('"rasa:{}"')) return s;
  const n = s.split(from).length - 1;
  if (n !== 2) return null;
  return s.split(from).join('token: if token.is_empty() { format!("rasa:{}", Config::get_id()) } else { token.to_owned() },');
}, 'client.rs: send own ID as quota claim');

// ---- 5) آیکون‌ها (اختیاری): فایل‌ها را در client/branding/ بگذارید
const bdir = path.join(__dirname, 'branding');
const iconMap = [
  ['icon.ico', ['res', 'icon.ico']], ['icon.ico', ['flutter', 'windows', 'runner', 'resources', 'app_icon.ico']],
  ['icon.png', ['res', 'icon.png']], ['icon.png', ['res', 'mac-icon.png']],
  ['32x32.png', ['res', '32x32.png']], ['64x64.png', ['res', '64x64.png']],
  ['128x128.png', ['res', '128x128.png']], ['icon.png', ['res', '128x128@2x.png']],
  ['icon.svg', ['flutter', 'assets', 'icon.svg']],
];
let icons = 0;
for (const [src, dst] of iconMap) {
  const s = path.join(bdir, src);
  if (fs.existsSync(s)) { fs.mkdirSync(path.dirname(p(...dst)), { recursive: true }); fs.copyFileSync(s, p(...dst)); icons++; }
}
if (icons) ok(`icons replaced: ${icons}`);
else console.warn('! no icons in client/branding/ - RustDesk icons remain. Add the Rasa logo files (see client/branding/README.md).');

if (problems && strict) { console.error(`\n${problems} problem(s).`); process.exit(1); }
console.log('\nDone.');

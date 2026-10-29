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
  // در ویندوز (CI) فایل‌ها با CRLF checkout می‌شوند؛ الگوها با LF نوشته شده‌اند، پس موقتاً به LF تبدیل می‌کنیم
  const raw = read(file);
  const crlf = raw.includes('\r\n');
  const before = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  const after = fn(before);
  if (after === null) return fail(`${label}: pattern not found`);
  if (after !== before) write(file, crlf ? after.replace(/\n/g, '\r\n') : after);
  ok(label);
}
const replaceOnce = (re, to) => (s) => (re.test(s) ? s.replace(re, to) : null);

// ---- 1) ثابت‌های Dart
const cfgDart = `// تولید شده توسط apply-branding.js - دستی ویرایش نکنید
const String kRasaAdsBaseUrl = ${js(brand.adsBaseUrl.replace(/\/$/, ''))};
const String kRasaRequestAdUrl = ${js(brand.requestAdUrl)};
const int kRasaBuild = ${parseInt(process.env.GITHUB_RUN_NUMBER || brand.build || 0, 10) || 0};
const String kRasaDownloadUrl = ${js(brand.downloadUrl || brand.websiteUrl || '')};
`;
const widgetsDir = p('flutter', 'lib', 'common', 'widgets');
write(path.join(widgetsDir, 'rasa_config.dart'), cfgDart);
fs.copyFileSync(path.join(__dirname, 'rasa_ad_banner.dart'), path.join(widgetsDir, 'rasa_ad_banner.dart'));
ok('Dart: rasa_config.dart + rasa_ad_banner.dart');

// ---- 2) نوار تبلیغات در صفحه‌ی اصلی دسکتاپ (پایین پنل راست)
patch(p('flutter', 'lib', 'desktop', 'pages', 'desktop_home_page.dart'), (s) => {
  if (s.includes("RasaAdBanner(slot: 'side')")) return s; // آخرین نسخه قبلاً اعمال شده
  if (s.includes('RasaAdBanner')) { // نسخه‌ی قبلی (فقط پایین) -> افزودن ستون کنار
    const old = 'Expanded(child: ConnectionPage()),\n          const RasaAdBanner(),';
    if (!s.includes(old)) return null;
    return s.replace(old, "Expanded(\n            child: LayoutBuilder(\n              builder: (ctx, c) => Row(\n                crossAxisAlignment: CrossAxisAlignment.start,\n                children: [\n                  Expanded(child: ConnectionPage()),\n                  if (c.maxWidth >= 640) const RasaAdBanner(slot: 'side'),\n                ],\n              ),\n            ),\n          ),\n          const RasaAdBanner(),");
  }
  let t = s.replace("import '../widgets/button.dart';",
    "import '../widgets/button.dart';\nimport 'package:flutter_hbb/common/widgets/rasa_ad_banner.dart';");
  const re = /buildRightPane\(BuildContext context\) \{\s*return Container\(\s*color: Theme\.of\(context\)\.scaffoldBackgroundColor,\s*child: ConnectionPage\(\),\s*\);\s*\}/;
  if (!re.test(t) || !t.includes('rasa_ad_banner.dart')) return null;
  return t.replace(re, `buildRightPane(BuildContext context) {
    return Container(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: Column(
        children: [
          Expanded(
            child: LayoutBuilder(
              builder: (ctx, c) => Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: ConnectionPage()),
                  if (c.maxWidth >= 640) const RasaAdBanner(slot: 'side'),
                ],
              ),
            ),
          ),
          const RasaAdBanner(),
        ],
      ),
    );
  }`);
}, 'Dart: ad banner in desktop_home_page');

// ---- 2a) حذف «Powered by RustDesk» از ستون چپ صفحه اصلی دسکتاپ
patch(p('flutter', 'lib', 'desktop', 'pages', 'desktop_home_page.dart'), (s) => {
  const re = /      if \(bind\.isCustomClient\(\)\)\n        Align\(\n          alignment: Alignment\.center,\n          child: loadPowered\(context\),\n        \),\n/;
  if (!re.test(s)) return s.includes('loadPowered(context)') ? null : s; // قبلاً حذف شده
  return s.replace(re, '');
}, 'Dart: remove "Powered by RustDesk" from desktop home');
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

// ---- 2c) فونت Vazirmatn (مجوز OFL-1.1) برای ظاهر بهتر متن فارسی؛ فایل‌ها در branding/fonts/ (همراه OFL.txt)
{
  const fontSrc = path.join(__dirname, 'branding', 'fonts');
  if (fs.existsSync(path.join(fontSrc, 'Vazirmatn-Regular.ttf'))) {
    fs.mkdirSync(p('flutter', 'assets', 'fonts'), { recursive: true });
    for (const name of fs.readdirSync(fontSrc)) fs.copyFileSync(path.join(fontSrc, name), p('flutter', 'assets', 'fonts', name));
    patch(p('flutter', 'pubspec.yaml'), (s) => {
      if (s.includes('family: Vazirmatn')) return s;
      const re = /^  fonts:\n/m; // فقط خود کلید fonts (با ۲ فاصله)، نه خطوط تو‌رفته‌ی fonts:
      if (!re.test(s)) return null;
      return s.replace(re, (m) => m +
        '    - family: Vazirmatn\n      fonts:\n        - asset: assets/fonts/Vazirmatn-Regular.ttf\n' +
        '        - asset: assets/fonts/Vazirmatn-Medium.ttf\n          weight: 500\n' +
        '        - asset: assets/fonts/Vazirmatn-Bold.ttf\n          weight: 700\n');
    }, 'pubspec.yaml: Vazirmatn font');
    patch(p('flutter', 'lib', 'common.dart'), (s) => {
      if (s.includes("fontFamily: 'Vazirmatn'")) return s;
      const l = '  static ThemeData lightTheme = ThemeData(\n';
      const d = '  static ThemeData darkTheme = ThemeData(\n';
      if (!s.includes(l) || !s.includes(d)) return null;
      return s.replace(l, l + "    fontFamily: 'Vazirmatn',\n").replace(d, d + "    fontFamily: 'Vazirmatn',\n");
    }, 'Dart: app theme font = Vazirmatn');
  } else {
    console.warn('! client/branding/fonts/ not found - default font stays.');
  }
}

// ---- 2d) حذف نام و لینک RustDesk از رابط کاربری و آدرس‌های شبکه‌ای که ممکن است به سرورهای آن‌ها بروند
// آدرس‌ها از brand.json: websiteUrl, privacyUrl, sourceUrl
// توجه: متن مجوز AGPL، حق نشر نویسندگان اصلی و فایل LICENCE در سورس باید باقی بمانند (الزام قانونی).
{
  const site = brand.websiteUrl || '';
  const privacy = brand.privacyUrl || site;
  const source = brand.sourceUrl || site;
  const shown = brand.displayName || brand.appName;
  if (!site) {
    console.warn('! brand.websiteUrl is empty - RustDesk links are NOT rewritten');
  } else {
    const rewriteUrls = (s) => s
      .replace(/(['"])https?:\/\/(?:www\.)?rustdesk\.com\/download[^'"\s]*\1/g, (m, q) => q + (brand.downloadUrl || site) + q)
      .replace(/(['"])https?:\/\/(?:www\.)?rustdesk\.com\/privacy\.html\1/g, (m, q) => q + privacy + q)
      .replace(/(['"])https?:\/\/(?:www\.)?rustdesk\.com[^'"\s]*\1/g, (m, q) => q + site + q)
      .replace(/(['"])https?:\/\/github\.com\/rustdesk\/rustdesk[^'"\s]*\1/g, (m, q) => q + source + q);
    const files = [
      ['flutter', 'lib', 'common.dart'],
      ['flutter', 'lib', 'common', 'widgets', 'toolbar.dart'],
      ['flutter', 'lib', 'mobile', 'pages', 'settings_page.dart'],
      ['flutter', 'lib', 'mobile', 'pages', 'connection_page.dart'],
      ['flutter', 'lib', 'desktop', 'pages', 'install_page.dart'],
      ['flutter', 'lib', 'desktop', 'pages', 'connection_page.dart'],
      ['flutter', 'lib', 'desktop', 'pages', 'desktop_home_page.dart'],
      ['flutter', 'lib', 'desktop', 'pages', 'desktop_setting_page.dart'],
      ['src', 'client.rs'],
    ];
    for (const f of files) patch(p(...f), (s) => rewriteUrls(s), 'links rewritten: ' + f.slice(-1)[0]);

    // صفحه «درباره»: نشانی حق نشر و مجوز (بدون نام RustDesk؛ اعلان AGPL و نشانی سورس حفظ می‌شود)
    patch(p('flutter', 'lib', 'desktop', 'pages', 'desktop_setting_page.dart'), (s) => {
      const old = "'Copyright © ${DateTime.now().toString().substring(0, 4)} Purslane Tech Pte. Ltd.\\n$license'";
      const neu = "'© ${DateTime.now().toString().substring(0, 4)} " + shown + "\\nFree software under the GNU AGPL v3. Source code: " + source +
        "\\nContains software © Purslane Tech Pte. Ltd. (AGPL v3)\\n$license'";
      if (s.includes(old)) return s.replace(old, neu);
      return s.includes('Free software under the GNU AGPL v3') ? s : null;
    }, 'Dart: About page legal notice');

    // نوار عنوان پنجره
    patch(p('flutter', 'lib', 'desktop', 'widgets', 'tabbar_widget.dart'), (s) => {
      const re = /const Text\(\s*"RustDesk",/;
      if (!re.test(s)) return s.includes('"RustDesk"') ? null : s;
      return s.replace(re, 'const Text(\n                              ' + JSON.stringify(shown) + ',');
    }, 'Dart: window title text');
  }

  // آدرس پیش‌فرض سرور API (ثبت دستگاه/heartbeat) نباید به سرورهای RustDesk برود
  patch(p('src', 'common.rs'), (s) => {
    const a = '"https://admin.rustdesk.com".to_owned()';
    if (s.includes(a)) return s.replace(a, '"".to_owned()');
    return s.includes('admin.rustdesk.com".to_owned()') ? null : s;
  }, 'common.rs: no default API server');
}


// پیوندهای مستندات داخل کتابخانه‌ی مشترک (زیرماژول)
{
  const cfgRs2 = p('libs', 'hbb_common', 'src', 'config.rs');
  if (fs.existsSync(cfgRs2) && brand.websiteUrl) {
    patch(cfgRs2, (s) => s
      .replace(/(pub const LINK_DOCS_HOME: &str = )"[^"]*"/, '$1' + js(brand.websiteUrl))
      .replace(/(pub const LINK_DOCS_X11_REQUIRED: &str = )"[^"]*"/, '$1' + js(brand.websiteUrl)),
      'hbb_common: docs links');
  }
}
// ---- 2e) انتخاب زبان در صفحه اول (ستون چپ، زیر رمز) — پیش‌فرض = زبان ویندوز هر کاربر
{
  fs.copyFileSync(path.join(__dirname, 'rasa_lang_picker.dart'), path.join(p('flutter', 'lib', 'common', 'widgets'), 'rasa_lang_picker.dart'));
  patch(p('flutter', 'lib', 'desktop', 'pages', 'desktop_home_page.dart'), (s) => {
    if (s.includes('RasaLangPicker')) return s;
    const a = '      if (!isOutgoingOnly) buildPasswordBoard(context),\n';
    const imp = "import 'package:flutter_hbb/common/widgets/rasa_ad_banner.dart';";
    if (!s.includes(a) || !s.includes(imp)) return null;
    return s.replace(a, a + '      const RasaLangPicker(),\n')
            .replace(imp, imp + "\nimport 'package:flutter_hbb/common/widgets/rasa_lang_picker.dart';");
  }, 'Dart: language picker on home page');
}

// ---- 2f) شماره (ID) اختصاصی رسا دسک: شماره‌ی پیش‌فرض از آدرس MAC کارت شبکه ساخته می‌شود و در همه‌ی برنامه‌های مشابه روی یک سیستم یکی است.
// با XOR یک عدد ثابتِ مخصوص رسا دسک، شماره متفاوت می‌شود (یک‌به‌یک؛ برخورد جدیدی ایجاد نمی‌کند).
{
  const cfgId = p('libs', 'hbb_common', 'src', 'config.rs');
  if (fs.existsSync(cfgId)) {
    let h = 0x811c9dc5;
    for (const c of String(brand.idSaltSeed || brand.appName)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    const salt = (h & 0x1FFFFFFF) | 1;
    patch(cfgId, (s) => {
      if (s.includes('RASA_ID_SALT')) return s;
      const a = '                id &= 0x1FFFFFFF;\n';
      if ((s.split(a).length - 1) !== 1) return null;
      return s.replace(a, a + '                id ^= 0x' + salt.toString(16).toUpperCase() + '; // RASA_ID_SALT\n');
    }, 'hbb_common: app-specific device ID (salt 0x' + salt.toString(16).toUpperCase() + ')');
  }
}

// ---- 2g) پیام «ready, for faster connection, please set up your own server»: برنامه چون سرور داخلی (compile-time) را «سرور سفارشی» نمی‌داند، فکر می‌کند از سرور عمومی استفاده می‌کند
patch(p('src', 'common.rs'), (s) => {
  const re = /pub fn using_public_server\(\) -> bool \{\n    crate::get_custom_rendezvous_server\(get_option\("custom-rendezvous-server"\)\)\.is_empty\(\)\n\}/;
  if (re.test(s)) return s.replace(re, 'pub fn using_public_server() -> bool {\n    false // RasaDesk: always uses its own built-in server\n}');
  return s.includes('RasaDesk: always uses its own built-in server') ? s : null;
}, 'common.rs: never report "public server"');

// ---- 2h) اطلاعات فایل (Properties > Details و راهنمای نوار وظیفه): نام شرکت، محصول، توضیح و حق نشر در همه‌ی exe ها
// فقط ASCII در Runner.rc تا مشکل کدگذاری نداشته باشیم. اعلان حق نشر نویسندگان اصلی (AGPL) حفظ می‌شود.
{
  const company = brand.publisher || brand.company || brand.displayName;
  const prod = brand.displayName || brand.appName;
  const desc = brand.description || (prod + ' Remote Desktop');
  const copy = brand.copyright || ('Copyright (c) ' + company + '. Contains AGPL-3.0 software (c) Purslane Tech Pte. Ltd.');
  const exe = brand.appName + '.exe';
  const tomlFix = (s) => {
    let t = s
      .replace(/^description = ".*"$/m, 'description = ' + js(desc))
      .replace(/^ProductName = ".*"$/m, 'ProductName = ' + js(prod))
      .replace(/^FileDescription = ".*"$/m, 'FileDescription = ' + js(desc))
      .replace(/^OriginalFilename = ".*"$/m, 'OriginalFilename = ' + js(exe))
      .replace(/^LegalCopyright = ".*"$/m, 'LegalCopyright = ' + js(copy));
    if (!/^CompanyName = /m.test(t)) t = t.replace(/^(LegalCopyright = .*)$/m, '$1\nCompanyName = ' + js(company));
    else t = t.replace(/^CompanyName = ".*"$/m, 'CompanyName = ' + js(company));
    return t;
  };
  patch(p('libs', 'portable', 'Cargo.toml'), tomlFix, 'portable packer: file properties');
  patch(p('Cargo.toml'), (s) => {
    // فقط بخش [package.metadata.winres] را تغییر بده
    const i = s.indexOf('[package.metadata.winres]');
    if (i < 0) return null;
    return s.slice(0, i) + tomlFix(s.slice(i));
  }, 'Cargo.toml: winres file properties');
  patch(p('flutter', 'windows', 'runner', 'Runner.rc'), (s) => s
    .replace(/VALUE "CompanyName", ".*?" "\\0"/, 'VALUE "CompanyName", ' + js(company) + ' "\\0"')
    .replace(/VALUE "InternalName", ".*?" "\\0"/, 'VALUE "InternalName", ' + js(brand.appName) + ' "\\0"')
    .replace(/VALUE "LegalCopyright", ".*?" "\\0"/, 'VALUE "LegalCopyright", ' + js(copy) + ' "\\0"')
    .replace(/VALUE "OriginalFilename", ".*?" "\\0"/, 'VALUE "OriginalFilename", ' + js(exe) + ' "\\0"'),
    'Runner.rc: company, copyright, internal name');
}

// ---- 2i) نام برنامه کنار آیکون در نوار عنوان پنجره (به‌طور پیش‌فرض فقط آیکون نشان داده می‌شد)
patch(p('flutter', 'lib', 'desktop', 'widgets', 'tabbar_widget.dart'), (s) => {
  const a = 'this.showTitle = false,';
  if (s.includes(a)) return s.replace(a, 'this.showTitle = true,');
  return s.includes('this.showTitle = true,') ? s : null;
}, 'Dart: show app name next to the window icon');

// ---- 2j) اندازه‌ی پیش‌فرض پنجره‌ی اصلی: عریض‌تر تا ستون تبلیغات کنار جا شود (فقط برای نصب‌های تازه؛ اندازه‌ی ذخیره‌شده‌ی کاربر حفظ می‌شود)
patch(p('flutter', 'windows', 'runner', 'main.cpp'), (s) => {
  const a = 'Win32Window::Size size(800u, 600u);';
  if (s.includes(a)) return s.replace(a, 'Win32Window::Size size(1000u, 660u);');
  return s.includes('Win32Window::Size size(1000u,') ? s : null;
}, 'main.cpp: default window 1000x660');

// ---- 2k) ستون راست با دو جایگاه تبلیغ (بالا و پایین، برای دو مشتری مختلف). بدون آگهی هیچ فضایی نمی‌گیرد.
patch(p('flutter', 'lib', 'desktop', 'pages', 'desktop_home_page.dart'), (s) => {
  if (s.includes("RasaAdBanner(slot: 'side2')")) return s;
  const a = "if (c.maxWidth >= 640) const RasaAdBanner(slot: 'side'),";
  if (!s.includes(a)) return null;
  return s.replace(a, "if (c.maxWidth >= 640)\n                    SingleChildScrollView(\n                      child: Column(\n                        mainAxisSize: MainAxisSize.min,\n                        crossAxisAlignment: CrossAxisAlignment.start,\n                        children: const [\n                          RasaAdBanner(slot: 'side'),\n                          RasaAdBanner(slot: 'side2'),\n                        ],\n                      ),\n                    ),");
}, 'Dart: two ad slots in the right column');

// ---- 2l) اعلان و اجبار به‌روزرسانی (شماره‌ی ساخت = GITHUB_RUN_NUMBER؛ سرور آخرین/حداقل نسخه را اعلام می‌کند)
fs.copyFileSync(path.join(__dirname, 'rasa_update.dart'), path.join(p('flutter', 'lib', 'common', 'widgets'), 'rasa_update.dart'));
patch(p('flutter', 'lib', 'desktop', 'pages', 'desktop_home_page.dart'), (s) => {
  if (s.includes('RasaUpdateGate')) return s;
  const a = '    return _buildBlock(\n        child: Row(';
  const b = '        if (!isIncomingOnly) Expanded(child: buildRightPane(context)),\n      ],\n    ));\n  }';
  const imp = "import 'package:flutter_hbb/common/widgets/rasa_ad_banner.dart';";
  if (!s.includes(a) || !s.includes(b) || !s.includes(imp)) return null;
  return s.replace(a, '    return RasaUpdateGate(child: _buildBlock(\n        child: Row(')
          .replace(b, '        if (!isIncomingOnly) Expanded(child: buildRightPane(context)),\n      ],\n    )));\n  }')
          .replace(imp, imp + "\nimport 'package:flutter_hbb/common/widgets/rasa_update.dart';");
}, 'Dart: update notice / forced update gate');

// ---- 2m) شماره‌ی ساخت کنار نسخه در «درباره» (دسکتاپ و موبایل) برای پشتیبانی
{
  const imp = "import 'package:flutter/material.dart';";
  const rimp = "import 'package:flutter_hbb/common/widgets/rasa_config.dart';";
  const withImport = (t) => (t.includes(rimp) ? t : t.replace(imp, imp + '\n' + rimp));
  patch(p('flutter', 'lib', 'desktop', 'pages', 'desktop_setting_page.dart'), (s) => {
    if (s.includes('$version (build $kRasaBuild)')) return s;
    const a = "Text('${translate('Version')}: $version')";
    if (!s.includes(a)) return null;
    return withImport(s.replace(a, "Text('${translate('Version')}: $version (build $kRasaBuild)')"));
  }, 'Dart: build number in desktop About');
  patch(p('flutter', 'lib', 'mobile', 'pages', 'settings_page.dart'), (s) => {
    if (s.includes('$version (build $kRasaBuild)')) return s;
    const a = "Text('Version: $version')";
    if (!s.includes(a)) return null;
    let t = s.replace(a, "Text('Version: $version (build $kRasaBuild)')");
    if (brand.websiteUrl) {
      let host = brand.websiteUrl;
      try { host = new URL(brand.websiteUrl).host; } catch (e) { /* keep as is */ }
      t = t.split("Text('rustdesk.com',").join('Text(' + js(host) + ',');
    }
    return withImport(t);
  }, 'Dart: build number + site text in mobile About');
}
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

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/models/platform_model.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'rasa_config.dart';

/// متن‌های نوار تبلیغات به چند زبان (زبان از تنظیمات خود برنامه خوانده می‌شود).
/// برای افزودن زبان، یک ورودی به این نقشه اضافه کنید؛ زبان ناشناس = انگلیسی.
const Map<String, Map<String, String>> _kTr = {
  'en': {'ad': 'Advertisement', 'request': 'Advertise on Rasa Desk'},
  'fa': {'ad': 'تبلیغات', 'request': 'درخواست تبلیغ در رسا دسک'},
  'ar': {'ad': 'إعلان', 'request': 'أعلن في رسا ديسك'},
  'tr': {'ad': 'Reklam', 'request': 'Rasa Desk\'te reklam ver'},
  'ru': {'ad': 'Реклама', 'request': 'Разместить рекламу в Rasa Desk'},
  'zh': {'ad': '广告', 'request': '在 Rasa Desk 投放广告'},
  'de': {'ad': 'Werbung', 'request': 'Auf Rasa Desk werben'},
  'fr': {'ad': 'Publicité', 'request': 'Faire de la publicité sur Rasa Desk'},
  'es': {'ad': 'Publicidad', 'request': 'Anunciarse en Rasa Desk'},
};

/// نوار تبلیغات رسا دسک. دو جایگاه دارد:
///  - slot 'bottom': نوار افقی پایین صفحه
///  - slot 'side': ستون کنار (اگر آگهی نداشته باشد هیچ فضایی نمی‌گیرد)
/// هر آگهی می‌تواند تصویر (PNG/JPG/GIF و WebP متحرک)، عنوان، متن، لینک مقصد و رنگ اختصاصی
/// (پس‌زمینه، متن، لینک) داشته باشد؛ آگهی فقط‌متنی هم مجاز است. اگر آگهی رنگ نداشته باشد،
/// از «تم پیش‌فرض» که در پنل مدیریت تنظیم می‌شود استفاده می‌شود.
/// کلیک روی تصویر، متن یا دامنه، سایت تبلیغ‌دهنده را باز می‌کند (فقط اگر آگهی لینک داشته باشد).
class RasaAdBanner extends StatefulWidget {
  const RasaAdBanner({Key? key, this.slot = 'bottom'}) : super(key: key);

  final String slot;

  @override
  State<RasaAdBanner> createState() => _RasaAdBannerState();
}

class _RasaAdBannerState extends State<RasaAdBanner> {
  List<Map<String, dynamic>> _ads = [];
  Map<String, dynamic> _theme = {};
  String _requestUrl = kRasaRequestAdUrl;
  String _lang = 'en';
  int _index = 0;
  Timer? _rotate;
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    _rotate = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_ads.length > 1 && mounted) {
        setState(() => _index = (_index + 1) % _ads.length);
        _reportView();
      }
    });
    _refresh = Timer.periodic(const Duration(minutes: 30), (_) => _load());
  }

  // زبان خودِ برنامه: اگر کاربر در تنظیمات زبان انتخاب کرده همان، وگرنه زبان سیستم (مثل خود RustDesk)
  String _detectLang() {
    var l = '';
    try {
      l = bind.mainGetLocalOption(key: kCommConfKeyLang);
    } catch (_) {}
    if (l.isEmpty || l == 'default') l = localeName;
    return l.split(RegExp('[-_]')).first.toLowerCase();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final l = _detectLang();
    if (l != _lang || _ads.isEmpty) {
      _lang = l;
      _load();
    }
  }

  @override
  void dispose() {
    _rotate?.cancel();
    _refresh?.cancel();
    super.dispose();
  }

  String _t(String k) => (_kTr[_lang] ?? _kTr['en']!)[k] ?? _kTr['en']![k]!;

  // نمایش واقعی: هر آگهی حداکثر هر ۱۰ دقیقه یک بار (در سرور هم ۵ دقیقه برای هر کاربر)
  final Map<int, DateTime> _viewed = {};

  String get _listFile => 'ads-${widget.slot}-$_lang.json';

  String get _etagFile => 'ads-${widget.slot}-$_lang.etag';

  Future<void> _load() async {
    Map<String, dynamic>? j;
    var unchanged = false;
    try {
      // اگر فهرست قبلی ذخیره شده، شناسه‌ی آن را می‌فرستیم؛ سرور اگر چیزی عوض نشده باشد ۳۰۴ می‌دهد
      final cachedText = await _AdCache.readText(_listFile);
      final etag = await _AdCache.readText(_etagFile);
      final headers = <String, String>{};
      if (cachedText != null && etag != null && etag.isNotEmpty) {
        headers['If-None-Match'] = etag;
      }
      final r = await http
          .get(
              Uri.parse(
                  '$kRasaAdsBaseUrl/api/ads?lang=$_lang&slot=${widget.slot}&v=2'),
              headers: headers)
          .timeout(const Duration(seconds: 8));
      if (r.statusCode == 304 && cachedText != null) {
        j = jsonDecode(cachedText) as Map<String, dynamic>;
        unchanged = true;
        unawaited(_AdCache.saveText(_listFile, cachedText)); // تازه‌سازی زمان ذخیره
      } else if (r.statusCode == 200) {
        final text = utf8.decode(r.bodyBytes);
        j = jsonDecode(text) as Map<String, dynamic>;
        unawaited(_AdCache.saveText(_listFile, text));
        unawaited(_AdCache.saveText(_etagFile, r.headers['etag'] ?? ''));
      }
    } catch (_) {}
    // سرور در دسترس نبود: آخرین فهرست ذخیره‌شده (حداکثر ۳ روز قدمت) تا آگهی‌ها بدون اینترنت هم دیده شوند
    if (j == null) {
      try {
        final text =
            await _AdCache.readText(_listFile, maxAge: const Duration(days: 3));
        if (text != null) j = jsonDecode(text) as Map<String, dynamic>;
      } catch (_) {}
    }
    if (j == null || !mounted) return;
    // بدون تغییر و فهرست فعلی همان است: دوباره چیدن/به‌هم‌ریختن نمی‌کنیم
    if (unchanged && _ads.isNotEmpty) return;
    _apply(j);
  }

  void _apply(Map<String, dynamic> j) {
    final list = (j['ads'] as List? ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .where((a) =>
            (a['image'] ?? '').toString().isNotEmpty ||
            (a['text'] ?? '').toString().isNotEmpty ||
            (a['title'] ?? '').toString().isNotEmpty)
        .toList();
    // وزن بیشتر = تکرار بیشتر در چرخش
    final weighted = <Map<String, dynamic>>[];
    for (final a in list) {
      final w = ((a['weight'] ?? 1) as num).toInt().clamp(1, 10);
      for (var i = 0; i < w; i++) {
        weighted.add(a);
      }
    }
    weighted.shuffle();
    setState(() {
      _ads = weighted;
      _index = 0;
      _theme = (j['theme'] is Map)
          ? Map<String, dynamic>.from(j['theme'] as Map)
          : {};
      _requestUrl = (j['requestAdUrl'] ?? kRasaRequestAdUrl).toString();
    });
    _reportView();
  }

  void _reportView() {
    if (_ads.isEmpty) return;
    final ad = _ads[_index % _ads.length];
    final id = (ad['id'] as num?)?.toInt();
    if (id == null) return;
    final last = _viewed[id];
    if (last != null && DateTime.now().difference(last).inMinutes < 10) return;
    _viewed[id] = DateTime.now();
    unawaited(() async {
      try {
        await http
            .post(Uri.parse('$kRasaAdsBaseUrl/api/view'),
                headers: {'Content-Type': 'application/json'},
                body: jsonEncode({'id': id}))
            .timeout(const Duration(seconds: 8));
      } catch (_) {}
    }());
  }

  void _open(String url) {
    final u = Uri.tryParse(url);
    if (u != null && (u.scheme == 'http' || u.scheme == 'https')) {
      launchUrl(u, mode: LaunchMode.externalApplication);
    }
  }

  // رنگ آگهی (یا تم پیش‌فرض)؛ فقط قالب #RRGGBB پذیرفته می‌شود
  Color? _color(Map<String, dynamic> ad, String key) {
    final own = (ad[key] ?? '').toString();
    final v = own.isNotEmpty ? own : (_theme[key] ?? '').toString();
    if (!RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(v)) return null;
    return Color(int.parse('FF${v.substring(1)}', radix: 16));
  }

  Widget _media(String image, String click, bool hasLink, {double? height}) {
    final img = ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: _AdImage(url: '$kRasaAdsBaseUrl$image', height: height),
    );
    if (!hasLink) return img;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(onTap: () => _open(click), child: img),
    );
  }

  // عنوان + متن + دامنه؛ کل خط قابل کلیک است (اگر لینک داشته باشد)
  Widget _textLine(Map<String, dynamic> ad, String click, bool hasLink,
      Color? fg, Color? accent, double size) {
    final title = (ad['title'] ?? '').toString();
    final text = (ad['text'] ?? '').toString();
    final host = (ad['host'] ?? '').toString();
    final line = [title, text].where((s) => s.isNotEmpty).join(' — ');
    if (line.isEmpty && host.isEmpty) return const SizedBox.shrink();
    final linkColor = accent ?? Theme.of(context).colorScheme.primary;
    final w = Text.rich(
      TextSpan(children: [
        if (line.isNotEmpty) TextSpan(text: '$line  '),
        if (host.isNotEmpty)
          TextSpan(
            text: host,
            style: TextStyle(
                color: linkColor, decoration: TextDecoration.underline),
          ),
      ]),
      style: TextStyle(fontSize: size, color: fg),
      maxLines: 3,
      overflow: TextOverflow.ellipsis,
      textAlign: TextAlign.center,
    );
    if (!hasLink) return w;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(onTap: () => _open(click), child: w),
    );
  }

  // ستون کنار: بدون آگهی هیچ فضایی نمی‌گیرد؛ تصویر متحرک (GIF/WebP) خودکار پخش می‌شود
  Widget _buildSide(BuildContext context) {
    if (_ads.isEmpty) return const SizedBox.shrink();
    final ad = _ads[_index % _ads.length];
    final click = '$kRasaAdsBaseUrl${ad['link']}';
    final image = (ad['image'] ?? '').toString();
    final hasLink = (ad['host'] ?? '').toString().isNotEmpty;
    final bg = _color(ad, 'bg');
    final fg = _color(ad, 'fg');
    final accent = _color(ad, 'accent');
    final muted = fg?.withOpacity(0.6) ??
        Theme.of(context).textTheme.bodySmall?.color?.withOpacity(0.6);
    return Container(
      width: 200,
      margin: const EdgeInsets.all(8),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: bg,
        border: Border.all(color: Colors.grey.withOpacity(0.25)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_t('ad'), style: TextStyle(fontSize: 11, color: muted)),
          const SizedBox(height: 6),
          if (image.isNotEmpty) _media(image, click, hasLink),
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: _textLine(ad, click, hasLink, fg, accent, 12),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.slot == 'side' || widget.slot == 'side2') return _buildSide(context);
    final scheme = Theme.of(context).colorScheme;
    final Map<String, dynamic> ad =
        _ads.isNotEmpty ? _ads[_index % _ads.length] : <String, dynamic>{};
    final bg = _color(ad, 'bg');
    final fg = _color(ad, 'fg');
    final accent = _color(ad, 'accent');
    final muted = fg?.withOpacity(0.6) ??
        Theme.of(context).textTheme.bodySmall?.color?.withOpacity(0.6);
    final children = <Widget>[];
    if (_ads.isNotEmpty) {
      final click = '$kRasaAdsBaseUrl${ad['link']}';
      final image = (ad['image'] ?? '').toString();
      final hasLink = (ad['host'] ?? '').toString().isNotEmpty;
      if (image.isNotEmpty) {
        children.add(_media(image, click, hasLink, height: 90));
      }
      children.add(Padding(
        padding: const EdgeInsets.only(top: 4),
        child: _textLine(ad, click, hasLink, fg, accent, 13),
      ));
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      decoration: BoxDecoration(
        color: bg,
        border: Border(
            top: BorderSide(color: Colors.grey.withOpacity(0.25), width: 1)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ...children,
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(_t('ad'), style: TextStyle(fontSize: 11, color: muted)),
              MouseRegion(
                cursor: SystemMouseCursors.click,
                child: GestureDetector(
                  onTap: () => _open(_requestUrl),
                  child: Text(_t('request'),
                      style: TextStyle(
                          fontSize: 12,
                          color: accent ?? scheme.primary,
                          decoration: TextDecoration.underline)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// کش دیسک: هر تصویر یک نام یکتا (تصادفی) دارد؛ اگر مدیر تصویر را عوض کند نام فایل عوض می‌شود
/// و کش قدیمی خودبه‌خود کنار گذاشته می‌شود. فایل‌هایی که ۱۴ روز استفاده نشده باشند پاک می‌شوند.
class _AdCache {
  static Directory? _dir;

  static Future<Directory> dir() async {
    final cached = _dir;
    if (cached != null) return cached;
    final sep = Platform.pathSeparator;
    final base = Platform.isWindows
        ? (Platform.environment['LOCALAPPDATA'] ?? Directory.systemTemp.path)
        : (Platform.environment['XDG_CACHE_HOME'] ??
            '${Platform.environment['HOME'] ?? Directory.systemTemp.path}/.cache');
    final d = Directory('$base${sep}RasaDesk${sep}adcache');
    await d.create(recursive: true);
    _dir = d;
    unawaited(_cleanup(d));
    return d;
  }

  static Future<void> _cleanup(Directory d) async {
    try {
      final cutoff = DateTime.now().subtract(const Duration(days: 14));
      await for (final e in d.list()) {
        if (e is File && (await e.lastModified()).isBefore(cutoff)) {
          await e.delete();
        }
      }
    } catch (_) {}
  }

  static String _safe(String s) => s.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');

  static Future<void> saveText(String name, String text) async {
    try {
      final d = await dir();
      await File('${d.path}${Platform.pathSeparator}${_safe(name)}')
          .writeAsString(text);
    } catch (_) {}
  }

  static Future<String?> readText(String name, {Duration? maxAge}) async {
    try {
      final d = await dir();
      final f = File('${d.path}${Platform.pathSeparator}${_safe(name)}');
      if (!await f.exists()) return null;
      if (maxAge != null &&
          DateTime.now().difference(await f.lastModified()) > maxAge) {
        return null;
      }
      return await f.readAsString();
    } catch (_) {
      return null;
    }
  }

  /// فایل کش‌شده‌ی تصویر؛ اگر نبود دانلود و ذخیره می‌شود. null = ناموفق
  static Future<File?> get(String url) async {
    try {
      final d = await dir();
      final f = File('${d.path}${Platform.pathSeparator}${_safe(url)}');
      if (await f.exists() && await f.length() > 0) {
        await f.setLastModified(DateTime.now());
        return f;
      }
      final r =
          await http.get(Uri.parse(url)).timeout(const Duration(seconds: 25));
      if (r.statusCode != 200 || r.bodyBytes.isEmpty) return null;
      final tmp = File('${f.path}.part');
      await tmp.writeAsBytes(r.bodyBytes, flush: true);
      await tmp.rename(f.path);
      return f;
    } catch (_) {
      return null;
    }
  }
}

class _AdImage extends StatefulWidget {
  const _AdImage({Key? key, required this.url, this.height}) : super(key: key);

  final String url;
  final double? height;

  @override
  State<_AdImage> createState() => _AdImageState();
}

class _AdImageState extends State<_AdImage> {
  File? _file;
  bool _fallback = false;

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  @override
  void didUpdateWidget(covariant _AdImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url) {
      _file = null;
      _fallback = false;
      _resolve();
    }
  }

  Future<void> _resolve() async {
    final url = widget.url;
    final f = await _AdCache.get(url);
    if (!mounted || url != widget.url) return;
    setState(() {
      _file = f;
      _fallback = f == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final h = widget.height;
    final empty = SizedBox(height: h ?? 0);
    final file = _file;
    if (file != null) {
      return Image.file(file,
          height: h, fit: BoxFit.contain, errorBuilder: (_, __, ___) => empty);
    }
    if (_fallback) {
      // کش دیسک در دسترس نبود: مثل قبل مستقیم از اینترنت
      return Image.network(widget.url,
          height: h, fit: BoxFit.contain, errorBuilder: (_, __, ___) => empty);
    }
    return SizedBox(height: h ?? 60);
  }
}

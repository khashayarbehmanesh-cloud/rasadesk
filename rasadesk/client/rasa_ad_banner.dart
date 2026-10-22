import 'dart:async';
import 'dart:convert';

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

  Future<void> _load() async {
    try {
      final r = await http
          .get(Uri.parse(
              '$kRasaAdsBaseUrl/api/ads?lang=$_lang&slot=${widget.slot}'))
          .timeout(const Duration(seconds: 8));
      if (r.statusCode != 200) return;
      final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
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
      if (!mounted) return;
      setState(() {
        _ads = weighted;
        _index = 0;
        _theme = (j['theme'] is Map)
            ? Map<String, dynamic>.from(j['theme'] as Map)
            : {};
        _requestUrl = (j['requestAdUrl'] ?? kRasaRequestAdUrl).toString();
      });
    } catch (_) {
      // بدون اینترنت یا سرور خاموش: بی‌صدا نادیده گرفته می‌شود
    }
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
      child: Image.network(
        '$kRasaAdsBaseUrl$image',
        height: height,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => SizedBox(height: height ?? 0),
      ),
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
    if (widget.slot == 'side') return _buildSide(context);
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

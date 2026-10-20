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

/// نوار تبلیغات رسا دسک: آگهی‌ها را (بر اساس زبان کاربر) از سرور تبلیغات می‌گیرد و می‌چرخاند.
/// هر آگهی می‌تواند بنر، متن و دامنه‌ی مقصد داشته باشد؛ متن و دامنه لینک مستقیم به سایت تبلیغ‌دهنده است.
/// اگر سرور در دسترس نباشد یا آگهی‌ای نباشد، فقط لینک «درخواست تبلیغ» دیده می‌شود.
class RasaAdBanner extends StatefulWidget {
  /// slot: 'bottom' (نوار افقی پایین صفحه) یا 'side' (ستون کنار، فقط وقتی آگهی داشته باشد)
  const RasaAdBanner({Key? key, this.slot = 'bottom'}) : super(key: key);

  final String slot;

  @override
  State<RasaAdBanner> createState() => _RasaAdBannerState();
}

class _RasaAdBannerState extends State<RasaAdBanner> {
  List<Map<String, dynamic>> _ads = [];
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
          .get(Uri.parse('$kRasaAdsBaseUrl/api/ads?lang=$_lang&slot=${widget.slot}'))
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

  // ستون کنار: بدون آگهی هیچ فضایی نمی‌گیرد؛ تصویر متحرک (GIF/WebP) خودکار پخش می‌شود
  Widget _buildSide(BuildContext context) {
    if (_ads.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    final muted = Theme.of(context).textTheme.bodySmall?.color?.withOpacity(0.6);
    final ad = _ads[_index % _ads.length];
    final click = '$kRasaAdsBaseUrl${ad['link']}';
    final image = (ad['image'] ?? '').toString();
    final title = (ad['title'] ?? '').toString();
    final text = (ad['text'] ?? '').toString();
    final host = (ad['host'] ?? '').toString();
    final line = [title, text].where((s) => s.isNotEmpty).join(' — ');
    return Container(
      width: 200,
      margin: const EdgeInsets.all(8),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey.withOpacity(0.25)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_t('ad'), style: TextStyle(fontSize: 11, color: muted)),
          const SizedBox(height: 6),
          if (image.isNotEmpty)
            InkWell(
              onTap: () => _open(click),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: Image.network(
                  '$kRasaAdsBaseUrl$image',
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                ),
              ),
            ),
          if (line.isNotEmpty || host.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: InkWell(
                onTap: () => _open(click),
                child: Text.rich(
                  TextSpan(children: [
                    if (line.isNotEmpty) TextSpan(text: '$line  '),
                    if (host.isNotEmpty)
                      TextSpan(
                        text: host,
                        style: TextStyle(
                            color: scheme.primary,
                            decoration: TextDecoration.underline),
                      ),
                  ]),
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.slot == 'side') return _buildSide(context);
    final scheme = Theme.of(context).colorScheme;
    final muted = Theme.of(context).textTheme.bodySmall?.color?.withOpacity(0.6);
    final children = <Widget>[];
    if (_ads.isNotEmpty) {
      final ad = _ads[_index % _ads.length];
      final click = '$kRasaAdsBaseUrl${ad['link']}';
      final image = (ad['image'] ?? '').toString();
      final title = (ad['title'] ?? '').toString();
      final text = (ad['text'] ?? '').toString();
      final host = (ad['host'] ?? '').toString();
      if (image.isNotEmpty) {
        children.add(InkWell(
          onTap: () => _open(click),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: Image.network(
              '$kRasaAdsBaseUrl$image',
              height: 90,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => const SizedBox(height: 90),
            ),
          ),
        ));
      }
      // متن آگهی + دامنه‌ی مقصد به‌صورت لینک مستقیم به سایت تبلیغ‌دهنده
      final line = [title, text].where((s) => s.isNotEmpty).join(' — ');
      if (line.isNotEmpty || host.isNotEmpty) {
        children.add(Padding(
          padding: const EdgeInsets.only(top: 4),
          child: InkWell(
            onTap: () => _open(click),
            child: Text.rich(
              TextSpan(children: [
                if (line.isNotEmpty) TextSpan(text: '$line  '),
                if (host.isNotEmpty)
                  TextSpan(
                    text: host,
                    style: TextStyle(
                        color: scheme.primary,
                        decoration: TextDecoration.underline),
                  ),
              ]),
              style: const TextStyle(fontSize: 13),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
            ),
          ),
        ));
      }
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      decoration: BoxDecoration(
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
              InkWell(
                onTap: () => _open(_requestUrl),
                child: Text(_t('request'),
                    style: TextStyle(
                        fontSize: 12,
                        color: scheme.primary,
                        decoration: TextDecoration.underline)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

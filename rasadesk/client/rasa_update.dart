import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/models/platform_model.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'rasa_config.dart';

/// اعلان و اجبار به‌روزرسانی.
/// هنگام باز شدن و هر ۳۰ دقیقه شماره‌ی ساخت این برنامه را با اطلاعات سرور مقایسه می‌کند:
///  - ساخت قدیمی‌تر از «آخرین»: نوار اعلان قابل‌بستن
///  - ساخت قدیمی‌تر از «حداقل مجاز»: صفحه‌ی اجباری تمام‌پنجره (فقط رابط برنامه؛ سرویس اتصال ورودی را قطع نمی‌کند)
/// اگر سرور در دسترس نباشد هیچ اجباری اعمال نمی‌شود.
class RasaUpdateGate extends StatefulWidget {
  const RasaUpdateGate({Key? key, required this.child}) : super(key: key);

  final Widget child;

  @override
  State<RasaUpdateGate> createState() => _RasaUpdateGateState();
}

class _RasaUpdateGateState extends State<RasaUpdateGate> {
  int _latest = 0;
  int _min = 0;
  String _url = kRasaDownloadUrl;
  String _softMsg = '';
  String _forceMsg = '';
  bool _dismissed = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _check();
    _timer = Timer.periodic(const Duration(minutes: 30), (_) => _check());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  String _lang() {
    var l = '';
    try {
      l = bind.mainGetLocalOption(key: kCommConfKeyLang);
    } catch (_) {}
    if (l.isEmpty || l == 'default') l = localeName;
    return l.split(RegExp('[-_]')).first.toLowerCase();
  }

  Future<void> _check() async {
    if (kRasaBuild <= 0) return; // ساخت محلی بدون شماره: بررسی نمی‌شود
    try {
      final r = await http
          .get(Uri.parse(
              '$kRasaAdsBaseUrl/api/version?build=$kRasaBuild&lang=${_lang()}'))
          .timeout(const Duration(seconds: 8));
      if (r.statusCode != 200) return;
      final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _latest = (j['latest'] as num?)?.toInt() ?? 0;
        _min = (j['min'] as num?)?.toInt() ?? 0;
        final u = (j['url'] ?? '').toString();
        if (u.startsWith('http')) _url = u;
        _softMsg = (j['soft'] ?? '').toString();
        _forceMsg = (j['force'] ?? '').toString();
      });
    } catch (_) {}
  }

  void _download() {
    final u = Uri.tryParse(_url);
    if (u != null && (u.scheme == 'http' || u.scheme == 'https')) {
      launchUrl(u, mode: LaunchMode.externalApplication);
    }
  }

  bool get _force => kRasaBuild > 0 && _min > kRasaBuild;
  bool get _soft =>
      kRasaBuild > 0 && _latest > kRasaBuild && !_force && !_dismissed;

  String _t(String fa, String en) => _lang() == 'fa' ? fa : en;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Stack(
      children: [
        Column(
          children: [
            if (_soft)
              Material(
                color: scheme.primary.withOpacity(0.12),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  child: Row(
                    children: [
                      Icon(Icons.system_update_alt, size: 18, color: scheme.primary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _softMsg.isNotEmpty
                              ? _softMsg
                              : _t('نسخه جدید رسا دسک در دسترس است.',
                                  'A new version of Rasa Desk is available.'),
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                      TextButton(
                        onPressed: _download,
                        child: Text(_t('دانلود', 'Download')),
                      ),
                      IconButton(
                        iconSize: 18,
                        splashRadius: 16,
                        icon: const Icon(Icons.close),
                        onPressed: () => setState(() => _dismissed = true),
                      ),
                    ],
                  ),
                ),
              ),
            Expanded(child: widget.child),
          ],
        ),
        if (_force)
          Positioned.fill(
            child: Material(
              color: Theme.of(context).scaffoldBackgroundColor,
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.system_update_alt, size: 56, color: scheme.primary),
                      const SizedBox(height: 16),
                      Text(
                        _t('به‌روزرسانی لازم است', 'Update required'),
                        style: const TextStyle(
                            fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 10),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 420),
                        child: Text(
                          _forceMsg.isNotEmpty
                              ? _forceMsg
                              : _t(
                                  'این نسخه دیگر پشتیبانی نمی‌شود. لطفاً نسخه جدید را دانلود و نصب کنید.',
                                  'This version is no longer supported. Please download and install the new version.'),
                          textAlign: TextAlign.center,
                        ),
                      ),
                      const SizedBox(height: 20),
                      ElevatedButton(
                        onPressed: _download,
                        child: Text(_t('دانلود نسخه جدید', 'Download new version')),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

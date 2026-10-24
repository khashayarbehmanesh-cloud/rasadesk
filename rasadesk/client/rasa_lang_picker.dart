import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/common.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/models/platform_model.dart';

/// انتخاب زبان در صفحه اول برنامه.
/// گزینه‌ی «پیش‌فرض» یعنی زبان سیستم‌عامل (locale ویندوز) هر کاربر؛ انتخاب دستی همان تنظیمات
/// «Settings > Display > Language» خود برنامه است و روی همه‌ی پنجره‌ها اعمال می‌شود.
class RasaLangPicker extends StatefulWidget {
  const RasaLangPicker({Key? key}) : super(key: key);

  @override
  State<RasaLangPicker> createState() => _RasaLangPickerState();
}

class _RasaLangPickerState extends State<RasaLangPicker> {
  List<List<String>> _langs = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final raw = await bind.mainGetLangs();
      final list = (jsonDecode(raw) as List)
          .map((e) => [e[0].toString(), e[1].toString()])
          .toList();
      if (mounted) setState(() => _langs = list);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_langs.isEmpty) return const SizedBox.shrink();
    final def = defaultOptionLang;
    var current = bind.mainGetLocalOption(key: kCommConfKeyLang);
    if (current.isEmpty) current = def;
    if (current != def && !_langs.any((l) => l[0] == current)) current = def;
    final items = <DropdownMenuItem<String>>[
      DropdownMenuItem(
        value: def,
        child: Text(translate('Default'),
            style: const TextStyle(fontSize: 12)),
      ),
      ..._langs.map((l) => DropdownMenuItem(
            value: l[0],
            child: Text(l[1], style: const TextStyle(fontSize: 12)),
          )),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 10, 11, 4),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          isExpanded: true,
          isDense: true,
          value: current,
          items: items,
          onChanged: (key) async {
            if (key == null) return;
            await bind.mainSetLocalOption(key: kCommConfKeyLang, value: key);
            await reloadAllWindows();
            bind.mainChangeLanguage(lang: key);
            if (mounted) setState(() {});
          },
        ),
      ),
    );
  }
}

import 'dart:convert';
import 'dart:async';
import 'dart:typed_data';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:video_player/video_player.dart';

const apiBase = String.fromEnvironment('API_BASE_URL');
const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
const androidFirebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
const iosFirebaseAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');
String get firebaseAppId => Platform.isIOS ? iosFirebaseAppId : androidFirebaseAppId;
const firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
const firebaseSenderId = String.fromEnvironment('FIREBASE_SENDER_ID');
const secureStorage = FlutterSecureStorage();
final navigatorKey = GlobalKey<NavigatorState>();
final messengerKey = GlobalKey<ScaffoldMessengerState>();

bool get pushConfigured => firebaseApiKey.isNotEmpty && firebaseAppId.isNotEmpty &&
    firebaseProjectId.isNotEmpty && firebaseSenderId.isNotEmpty;

FirebaseOptions get firebaseOptions => FirebaseOptions(
      apiKey: firebaseApiKey,
      appId: firebaseAppId,
      messagingSenderId: firebaseSenderId,
      projectId: firebaseProjectId,
    );

@pragma('vm:entry-point')
Future<void> backgroundMessage(RemoteMessage message) async {
  if (pushConfigured) await Firebase.initializeApp(options: firebaseOptions);
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (pushConfigured) {
    await Firebase.initializeApp(options: firebaseOptions);
    FirebaseMessaging.onBackgroundMessage(backgroundMessage);
  }
  runApp(const CctvApp());
}

class Api {
  Api(this.token);
  String? token;
  Uri uri(String path) => Uri.parse('${apiBase.replaceFirst(RegExp(r"/$"), "")}$path');
  Map<String, String> get headers => {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };
  Map<String, String> get mediaHeaders => {
        if (token != null) 'Authorization': 'Bearer $token',
      };
  Future<dynamic> get(String path) async => _decode(await http.get(uri(path), headers: headers));
  Future<dynamic> post(String path, Map<String, dynamic> body) async =>
      _decode(await http.post(uri(path), headers: headers, body: jsonEncode(body)));
  dynamic _decode(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(response.statusCode == 401 ? 'Sesi berakhir. Masuk kembali.' :
          'Permintaan gagal (${response.statusCode}).');
    }
    return response.body.isEmpty ? null : jsonDecode(response.body);
  }
}

ThemeData cctvTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(seedColor: const Color(0xff465fff), brightness: brightness)
      .copyWith(primary: const Color(0xff465fff), surface: Color(dark ? 0xff1a2231 : 0xffffffff));
  return ThemeData(
    useMaterial3: true, colorScheme: scheme,
    scaffoldBackgroundColor: Color(dark ? 0xff101828 : 0xfff9fafb),
    appBarTheme: AppBarTheme(backgroundColor: scheme.surface, foregroundColor: scheme.onSurface,
      surfaceTintColor: Colors.transparent, elevation: 0, centerTitle: false),
    cardTheme: CardThemeData(elevation: 0, color: scheme.surface, surfaceTintColor: Colors.transparent,
      margin: const EdgeInsets.symmetric(vertical: 7),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Color(dark ? 0xff344054 : 0xffe4e7ec)))),
    inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: scheme.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: Color(dark ? 0xff344054 : 0xffd0d5dd)))),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)))),
    listTileTheme: const ListTileThemeData(contentPadding: EdgeInsets.symmetric(horizontal: 18, vertical: 8)),
  );
}

class CctvApp extends StatefulWidget {
  const CctvApp({super.key});
  @override
  State<CctvApp> createState() => _CctvAppState();
}

class _CctvAppState extends State<CctvApp> {
  Api api = Api(null);
  bool loading = true;
  bool pushListenersAdded = false;

  @override
  void initState() { super.initState(); _restore(); }

  Future<void> _restore() async {
    api.token = await secureStorage.read(key: 'api_token');
    if (api.token != null) {
      try { await api.get('/api/incidents'); }
      catch (_) { await secureStorage.delete(key: 'api_token'); api.token = null; }
      if (api.token != null) { try { await _registerPush(); } catch (_) {} }
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _registerPush() async {
    if (!pushConfigured || api.token == null) return;
    await FirebaseMessaging.instance.requestPermission();
    await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true);
    if (Platform.isIOS && await FirebaseMessaging.instance.getAPNSToken() == null) return;
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) await api.post('/api/devices', {'token': token, 'platform': Platform.isIOS ? 'ios' : 'android'});
    if (!pushListenersAdded) {
      pushListenersAdded = true;
      FirebaseMessaging.instance.onTokenRefresh.listen((value) {
        if (api.token != null) api.post('/api/devices', {'token': value, 'platform': Platform.isIOS ? 'ios' : 'android'});
      });
      FirebaseMessaging.onMessage.listen((message) {
        if (api.token == null || Platform.isIOS) return;
        messengerKey.currentState?.showSnackBar(SnackBar(
          content: Text(message.notification?.title ?? 'Peringatan CCTV'),
          duration: const Duration(seconds: 10),
          action: SnackBarAction(label: 'Lihat', onPressed: () => _openMessage(message)),
        ));
      });
      FirebaseMessaging.onMessageOpenedApp.listen(_openMessage);
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) _openMessage(initial);
    }
  }

  void _openMessage(RemoteMessage message) {
    final id = int.tryParse(message.data['incident_id'] ?? '');
    if (id != null && api.token != null) {
      navigatorKey.currentState?.push(MaterialPageRoute(
          builder: (_) => IncidentDetail(api: api, incidentId: id)));
    }
  }

  Future<void> _login(String email, String password) async {
    final result = await api.post('/api/login', {'email': email, 'password': password});
    api.token = result['token'] as String;
    await secureStorage.write(key: 'api_token', value: api.token);
    try { await _registerPush(); } catch (_) {}
    setState(() {});
  }

  Future<void> _logout() async {
    try { await api.post('/api/logout', {}); } catch (_) {}
    await secureStorage.delete(key: 'api_token');
    setState(() => api.token = null);
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        navigatorKey: navigatorKey,
        scaffoldMessengerKey: messengerKey,
        title: 'AI CCTV Checker',
        theme: cctvTheme(Brightness.light),
        darkTheme: cctvTheme(Brightness.dark),
        themeMode: ThemeMode.system,
        home: apiBase.isEmpty || (!apiBase.startsWith('https://') &&
                !apiBase.startsWith('http://10.0.2.2:'))
            ? const Scaffold(body: Center(child: Padding(
                padding: EdgeInsets.all(24),
                child: Text('Alamat API HTTPS belum diatur. Bangun APK dengan --dart-define=API_BASE_URL=https://server-anda.'))))
            : loading ? const Scaffold(body: Center(child: CircularProgressIndicator()))
            : api.token == null ? LoginPage(onLogin: _login)
            : HomePage(api: api, onLogout: _logout),
      );
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.onLogin});
  final Future<void> Function(String, String) onLogin;
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final email = TextEditingController();
  final password = TextEditingController();
  String? error;
  bool busy = false;
  bool showPassword = false;
  @override
  void dispose() { email.dispose(); password.dispose(); super.dispose(); }
  Future<void> submit() async {
    setState(() { busy = true; error = null; });
    try { await widget.onLogin(email.text.trim(), password.text); }
    catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('CCTV SLM')),
        body: Center(child: SingleChildScrollView(child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: Padding(padding: const EdgeInsets.all(28), child: Column(
            crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min,
            children: [Container(padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: const Color(0xff465fff), borderRadius: BorderRadius.circular(16)),
                child: const Icon(Icons.videocam_outlined, size: 32, color: Colors.white)),
              const SizedBox(height: 28),
              const Text('Selamat datang kembali', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              const Text('Masuk untuk memantau kamera dan memeriksa kejadian di Aneka Jaya.'),
              const SizedBox(height: 28),
              TextField(controller: email, keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.username], decoration: const InputDecoration(labelText: 'Email')),
              const SizedBox(height: 18),
              TextField(controller: password, obscureText: !showPassword,
                autofillHints: const [AutofillHints.password],
                decoration: InputDecoration(labelText: 'Kata sandi', suffixIcon: IconButton(
                  tooltip: showPassword ? 'Sembunyikan sandi' : 'Tampilkan sandi',
                  onPressed: () => setState(() => showPassword = !showPassword),
                  icon: Icon(showPassword ? Icons.visibility_off_outlined : Icons.visibility_outlined))),
                onSubmitted: (_) => busy ? null : submit()),
              if (error != null) Padding(padding: const EdgeInsets.only(top: 12),
                  child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
              const SizedBox(height: 24), SizedBox(width: double.infinity,
                child: FilledButton(onPressed: busy ? null : submit,
                  child: Text(busy ? 'Memeriksa akun…' : 'Masuk ke dashboard'))),
              const SizedBox(height: 24), const Text('CCTV SLM · Aneka Jaya', style: TextStyle(fontSize: 12)),
            ]))))),
      );

}

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.api, required this.onLogout});
  final Api api;
  final Future<void> Function() onLogout;
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  late Future<List<dynamic>> incidents;
  late Future<List<dynamic>> cameras;
  @override
  void initState() { super.initState(); refresh(); }
  void refresh() => setState(() {
        incidents = widget.api.get('/api/incidents').then((value) => value['data'] as List<dynamic>);
        cameras = widget.api.get('/api/cameras').then((value) => value as List<dynamic>);
      });
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('CCTV SLM'), actions: [
          IconButton(onPressed: refresh, icon: const Icon(Icons.refresh), tooltip: 'Segarkan'),
        ]),
        drawer: Drawer(child: SafeArea(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [const Padding(padding: EdgeInsets.all(24), child: Column(
            crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(Icons.videocam_outlined, color: Color(0xff465fff), size: 36), SizedBox(height: 14),
              Text('CCTV SLM', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              Text('Aneka Jaya')])),
            const Divider(),
            ListTile(leading: const Icon(Icons.dashboard_outlined), title: const Text('Ringkasan'),
              selected: true, onTap: () => Navigator.pop(context)),
            ListTile(leading: const Icon(Icons.qr_code), title: const Text('Label & invoice'), onTap: () {
              Navigator.pop(context); Navigator.push(context, MaterialPageRoute(builder: (_) => LabelHistory(api: widget.api))); }),
            ListTile(leading: const Icon(Icons.assessment_outlined), title: const Text('Laporan orang'), onTap: () {
              Navigator.pop(context); Navigator.push(context, MaterialPageRoute(builder: (_) => PresenceReports(api: widget.api))); }),
            const Spacer(),
            ListTile(leading: const Icon(Icons.logout), title: const Text('Keluar dari akun'), onTap: () {
              Navigator.pop(context); widget.onLogout(); }),
            const Padding(padding: EdgeInsets.all(24), child: Text('Pemeriksaan berdasarkan bukti', style: TextStyle(fontSize: 12))),
          ]))),
        body: RefreshIndicator(onRefresh: () async { refresh(); await incidents; },
          child: ListView(padding: const EdgeInsets.all(16), children: [
            if (!pushConfigured) const Card(child: ListTile(leading: Icon(Icons.notifications_off_outlined),
              title: Text('Push belum dikonfigurasi'), subtitle: Text('Dashboard web tetap dapat dipakai.'))),
            const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('Status kamera',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold))),
            FutureBuilder<List<dynamic>>(future: cameras, builder: (context, snap) {
              if (snap.hasError) return Text('Gagal memuat kamera: ${snap.error}');
              if (!snap.hasData) return const LinearProgressIndicator();
              if (snap.data!.isEmpty) return const Text('Belum ada kamera.');
              return Column(children: snap.data!.map((raw) {
                final camera = raw as Map<String, dynamic>;
                final seen = DateTime.tryParse(camera['last_seen_at'] ?? '');
                final online = camera['status'] == 'online' && seen != null &&
                    DateTime.now().difference(seen.toLocal()).inSeconds < 60;
                return Card(child: ListTile(leading: Icon(online ? Icons.videocam : Icons.videocam_off,
                    color: online ? Colors.green : Colors.red), title: Text(camera['name'] ?? ''),
                    subtitle: Text('${camera['location'] ?? ''} · ${online ? 'Aktif' : 'Terhenti'}'),
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CameraLive(api: widget.api, camera: camera)))));
              }).toList());
            }),
            const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('Kejadian terbaru',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold))),
            FutureBuilder<List<dynamic>>(future: incidents, builder: (context, snap) {
              if (snap.hasError) return Text('Gagal memuat kejadian: ${snap.error}');
              if (!snap.hasData) return const LinearProgressIndicator();
              if (snap.data!.isEmpty) return const Text('Belum ada kejadian.');
              return Column(children: snap.data!.map((raw) {
                final item = raw as Map<String, dynamic>;
                return Card(child: ListTile(
                  title: Text(item['type'] == 'anomaly' ? 'Dugaan anomali yang perlu diperiksa' : item['type'] == 'person_absent' ? 'Track tidak terlihat; perlu diperiksa' : 'Pemantauan terhenti'),
                  subtitle: Text('${item['camera']?['name'] ?? ''} · ${item['occurred_at'] ?? ''}\n${item['reason'] ?? ''}',
                      maxLines: 3, overflow: TextOverflow.ellipsis),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push(context, MaterialPageRoute(
                      builder: (_) => IncidentDetail(api: widget.api, incidentId: item['id'] as int))),
                ));
              }).toList());
            }),
          ])),
      );
}

class IncidentDetail extends StatefulWidget {
  const IncidentDetail({super.key, required this.api, required this.incidentId});
  final Api api;
  final int incidentId;
  @override
  State<IncidentDetail> createState() => _IncidentDetailState();
}

class _IncidentDetailState extends State<IncidentDetail> {
  late Future<Map<String, dynamic>> incident;
  VideoPlayerController? player;
  @override
  void initState() { super.initState(); load(); }
  void load() => setState(() {
        incident = widget.api.get('/api/incidents/${widget.incidentId}')
            .then((value) => value as Map<String, dynamic>);
      });
  Future<void> play() async {
    player?.dispose();
    final controller = VideoPlayerController.networkUrl(
      widget.api.uri('/api/evidence/incident-clip/${widget.incidentId}'),
      httpHeaders: widget.api.mediaHeaders);
    await controller.initialize(); await controller.play();
    setState(() => player = controller);
  }
  Future<void> review(String status) async {
    await widget.api.post('/api/incidents/${widget.incidentId}/review', {'status': status}); load();
  }
  @override
  void dispose() { player?.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Detail kejadian')),
        body: FutureBuilder<Map<String, dynamic>>(future: incident, builder: (context, snap) {
          if (snap.hasError) return Center(child: Text('Gagal memuat: ${snap.error}'));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final item = snap.data!;
          return ListView(padding: const EdgeInsets.all(18), children: [
            Text(item['type'] == 'anomaly' ? 'Dugaan anomali yang perlu diperiksa' : item['type'] == 'person_absent' ? 'Track tidak terlihat; perlu diperiksa' : 'Pemantauan terhenti',
                style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8), Text('${item['camera']?['name'] ?? ''} · ${item['occurred_at'] ?? ''}'),
            const SizedBox(height: 8), Text(item['reason'] ?? ''),
            Text('Status pemeriksaan: ${item['status'] ?? ''}'),
            if (item['snapshot_path'] != null) Padding(padding: const EdgeInsets.symmetric(vertical: 16),
              child: Image.network(widget.api.uri('/api/evidence/incident-snapshot/${widget.incidentId}').toString(),
                  headers: widget.api.mediaHeaders)),
            if (item['clip_path'] != null) FilledButton.icon(onPressed: play,
              icon: const Icon(Icons.play_arrow), label: const Text('Putar cuplikan bukti')),
            if (player != null && player!.value.isInitialized) AspectRatio(aspectRatio: player!.value.aspectRatio,
              child: VideoPlayer(player!)),
            const SizedBox(height: 20),
            const Text('Hasil AI adalah dugaan. Periksa bukti sebelum mengambil keputusan.'),
            const SizedBox(height: 12), Wrap(spacing: 8, children: [
              OutlinedButton(onPressed: () => review('dismissed'), child: const Text('Peringatan keliru')),
              FilledButton(onPressed: () => review('confirmed'), child: const Text('Perlu tindak lanjut')),
            ]),
          ]);
        }),
      );
}


class CameraLive extends StatefulWidget {
  const CameraLive({super.key, required this.api, required this.camera});
  final Api api;
  final Map<String, dynamic> camera;
  @override
  State<CameraLive> createState() => _CameraLiveState();
}

class _CameraLiveState extends State<CameraLive> {
  Timer? timer;
  Uint8List? frame;
  VideoPlayerController? livePlayer;
  String status = 'Memuat gambar';
  bool busy = false;
  @override
  void initState() { super.initState(); refresh(); timer = Timer.periodic(const Duration(seconds: 6), (_) => refresh()); }
  Future<void> refresh() async {
    if (busy) return;
    busy = true;
    try {
      final response = await http.get(widget.api.uri('/api/cameras/${widget.camera['id']}/live-frame'),
          headers: widget.api.mediaHeaders).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) throw Exception('Gambar belum tersedia');
      final timestamp = DateTime.tryParse(response.headers['x-frame-time'] ?? '');
      final stale = timestamp == null || DateTime.now().difference(timestamp).inSeconds > 20;
      if (mounted) setState(() { frame = response.bodyBytes; status = stale ? 'Gambar lama; periksa koneksi' : 'Gambar terbaru: ${timestamp.toLocal()}'; });
    } catch (_) { if (mounted) setState(() => status = 'Gambar belum tersedia atau koneksi terputus'); }
    finally { busy = false; }
  }
  @override
  void dispose() { timer?.cancel(); livePlayer?.dispose(); super.dispose(); }
  Future<void> playLive() async {
    final controller = VideoPlayerController.networkUrl(widget.api.uri('/api/cameras/${widget.camera['id']}/live/stream.m3u8'), httpHeaders: widget.api.mediaHeaders);
    try {
      await controller.initialize();
      if (!mounted) { await controller.dispose(); return; }
      await controller.play();
      livePlayer?.dispose();
      setState(() => livePlayer = controller);
    } catch (_) { await controller.dispose(); if (mounted) setState(() => status = 'Video live belum tersedia atau koneksi terputus'); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(widget.camera['name'] ?? 'Kamera')),
    body: ListView(padding: const EdgeInsets.all(16), children: [Text(status),
      if (frame != null) Image.memory(frame!, gaplessPlayback: true),
      FilledButton.icon(onPressed: playLive, icon: const Icon(Icons.play_arrow), label: const Text('Putar video live')),
      if (livePlayer != null && livePlayer!.value.isInitialized) AspectRatio(aspectRatio: livePlayer!.value.aspectRatio, child: VideoPlayer(livePlayer!)),
      const Text('Video live memakai HLS dengan jeda beberapa detik. Gambar cadangan diperbarui sekitar setiap dua detik. Track anonim tidak mengenali wajah dan ID dapat berubah.'),
    ]),
  );
}

class PresenceReports extends StatefulWidget {
  const PresenceReports({super.key, required this.api});
  final Api api;
  @override
  State<PresenceReports> createState() => _PresenceReportsState();
}
class _PresenceReportsState extends State<PresenceReports> {
  late Future<dynamic> report;
  String filter = '';
  @override
  void initState() { super.initState(); load(); }
  void load() { report = widget.api.get('/api/reports/presence?classification=$filter'); }
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Laporan CCTV')),
    body: Column(children: [
      DropdownButton<String>(value: filter, items: const [
        DropdownMenuItem(value: '', child: Text('Semua track')),
        DropdownMenuItem(value: 'customer', child: Text('Customer (ditandai pemeriksa)')),
        DropdownMenuItem(value: 'unclassified', child: Text('Belum diklasifikasikan')),
      ], onChanged: (value) => setState(() { filter = value ?? ''; load(); })),
      const Padding(padding: EdgeInsets.all(12), child: Text('Track bukan orang unik. Tidak terlihat bukan bukti meninggalkan toko.')),
      Expanded(child: FutureBuilder<dynamic>(future: report, builder: (context, snap) {
        if (snap.hasError) return const Center(child: Text('Gagal memuat laporan'));
        if (!snap.hasData) return const Center(child: CircularProgressIndicator());
        final rows = snap.data['data'] as List<dynamic>;
        return ListView.builder(itemCount: rows.length, itemBuilder: (context, index) {
          final row = rows[index];
          return ListTile(title: Text('${row['camera']?['name']} / Track ${row['track_id']}'),
            subtitle: Text('${row['classification']}\nTerakhir terlihat: ${row['last_seen_at']}\n${row['absence_alerted_at'] == null ? 'Belum ada peringatan' : 'Tidak terlihat; perlu diperiksa'}'));
        });
      })),
    ]));
}

class LabelHistory extends StatelessWidget {
  const LabelHistory({super.key, required this.api});
  final Api api;
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Riwayat invoice')),
    body: FutureBuilder<dynamic>(future: api.get('/api/labels'), builder: (context, snap) {
      if (snap.hasError) return const Center(child: Text('Gagal memuat invoice'));
      if (!snap.hasData) return const Center(child: CircularProgressIndicator());
      final rows = snap.data['data'] as List<dynamic>;
      return ListView.builder(itemCount: rows.length, itemBuilder: (context, index) {
        final row = rows[index];
        return ExpansionTile(title: Text(row['field_one']),
          subtitle: Text('${row['field_two'] ?? 'Customer perlu diperiksa'} · SLM: ${row['slm_status']}'),
          children: [Text('Pertama terlihat: ${row['first_seen_at']}'),
            Image.network(api.uri('/api/evidence/label-snapshot/${row['id']}').toString(), headers: api.mediaHeaders),
            const Padding(padding: EdgeInsets.all(12), child: Text('Koreksi label dan pencocokan dilakukan melalui dashboard web.'))]);
      });
    }));
}

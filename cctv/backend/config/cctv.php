<?php

return [
    'ingest_token' => env('CCTV_INGEST_TOKEN'),
    'slm_base_url' => env('SLM_BASE_URL'),
    'slm_lookup_path' => env('SLM_LOOKUP_PATH', '/api/cctv/labels/lookup'),
    'slm_health_path' => env('SLM_HEALTH_PATH', '/api/health'),
    'slm_sync_path' => env('SLM_SYNC_PATH'),
    'slm_sync_upload_photo' => (bool) env('SLM_SYNC_UPLOAD_PHOTO', false),
    'slm_events_path' => env('SLM_EVENTS_PATH', '/api/cctv/events'),
    'slm_announcement_result_path' => env('SLM_ANNOUNCEMENT_RESULT_PATH', '/api/cctv/announcements/result'),
    'slm_webhook_enabled' => (bool) env('SLM_WEBHOOK_ENABLED', true),
    'slm_token' => env('SLM_API_TOKEN'),
    'slm_auto_sync' => (bool) env('SLM_AUTO_SYNC', true),
    'fcm_project_id' => env('FCM_PROJECT_ID'),
    'fcm_service_account_file' => env('FCM_SERVICE_ACCOUNT_FILE'),
    'wa_phone_number_id' => env('WA_PHONE_NUMBER_ID'),
    'wa_access_token' => env('WA_ACCESS_TOKEN'),
    'wa_template_name' => env('WA_TEMPLATE_NAME'),
    'ai_provider' => env('CCTV_AI_PROVIDER', 'gemini'),
    'ai_api_key' => env('CCTV_AI_API_KEY', env('GEMINI_API_KEY')),
    'ai_model' => env('CCTV_AI_MODEL', 'gemini-3.5-flash-lite'),
    'auto_sync_packing' => (bool) env('CCTV_AUTO_SYNC_PACKING', false),
    'x_accel_redirect' => (bool) env('CCTV_X_ACCEL_REDIRECT', false),
    'default_store_label' => env('CCTV_DEFAULT_STORE_LABEL', 'Aneka Jaya'),
    'auto_full_frame_zones' => (bool) env('CCTV_AUTO_FULL_FRAME_ZONES', true),
    'min_confidence' => (float) env('CCTV_MIN_CONFIDENCE', 0.90),
    'min_dwell_seconds' => (int) env('CCTV_MIN_DWELL_SECONDS', env('APP_ENV') === 'testing' ? 0 : 2),
    'retention_evidence_days' => (int) env('CCTV_EVIDENCE_RETENTION_DAYS', 60),
    'retention_incident_days' => (int) env('CCTV_INCIDENT_RETENTION_DAYS', 90),
    'retention_presence_days' => (int) env('CCTV_PRESENCE_RETENTION_DAYS', 14),
    'min_free_disk_percent' => (float) env('CCTV_MIN_FREE_DISK_PERCENT', env('APP_ENV') === 'testing' ? 0.0 : 15.0),
    // Suara peringatan: Google Cloud Text-to-Speech (Bahasa Indonesia).
    'tts_api_key' => env('GOOGLE_TTS_API_KEY'),
    'tts_voice' => env('GOOGLE_TTS_VOICE', 'id-ID-Standard-A'),
    'tts_speaking_rate' => (float) env('GOOGLE_TTS_SPEAKING_RATE', 0.95),
    // Google menyesuaikan suara untuk speaker kecil (lebih jelas di speaker kamera); kosongkan untuk mematikan.
    'tts_effects_profile' => env('GOOGLE_TTS_EFFECTS_PROFILE', 'small-bluetooth-speaker-class-device'),
    // Penguatan volume dalam dB (-96 s.d. 16); 0 = asli.
    'tts_volume_gain_db' => (float) env('GOOGLE_TTS_VOLUME_GAIN_DB', 4),
    // Suara yang dikirim di depan ke speaker (milidetik) untuk menahan jaringan yang tersendat; terlalu besar bisa
    // membuat DVR membuang suara bila penyangganya penuh.
    // Hening di awal setiap peringatan (ms) supaya sendatan saat speaker baru menyala tidak memotong kalimat.
    // Live realtime lewat relay go2rtc + proxy nginx di stack (docker-compose). Sub-stream (…02) untuk ditonton.
    'realtime_relay' => filter_var(env('CCTV_REALTIME_RELAY', false), FILTER_VALIDATE_BOOL),
    'realtime_substream' => filter_var(env('CCTV_REALTIME_SUBSTREAM', true), FILTER_VALIDATE_BOOL),
    // Pengumuman dari SLM (laporan pesanan belum diproses): speaker kamera ini, kanal bawaan bila SLM tidak menyebut.
    // Kamera/worker baru dianggap offline (kejadian + notifikasi) bila putus lebih lama dari ini (detik).
    'offline_grace_seconds' => (int) env('CCTV_OFFLINE_GRACE_SECONDS', 180),
    'announce_camera_id' => (int) env('CCTV_ANNOUNCE_CAMERA_ID', 1),
    'announce_channel' => (int) env('CCTV_ANNOUNCE_CHANNEL', 12),
    'speaker_lead_in_ms' => (int) env('CCTV_SPEAKER_LEAD_IN_MS', 800),
    'speaker_prefill_ms' => (int) env('CCTV_SPEAKER_PREFILL_MS', 600),
    'min_free_disk_gb' => (float) env('CCTV_MIN_FREE_DISK_GB', env('APP_ENV') === 'testing' ? 0.0 : 2.0),
];

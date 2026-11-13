// Nilai palsu untuk uji; token dan alamat CCTV asli hanya ada di .env server.
process.env.CCTV_BASE_URL ??= "http://203.0.113.10:8000";
process.env.CCTV_API_TOKEN ??= "test-cctv-token";
process.env.CCTV_INTEGRATION_TOKEN ??= "test-cctv-token";
// CCTV hanya untuk domain SLM; request uji datang dari localhost, dan render di luar request memakai CCTV_ENABLED.
process.env.CCTV_ALLOWED_HOSTS ??= "slm.lrmslm.com,localhost";
process.env.CCTV_ENABLED ??= "true";
// Batas jam kerja dimatikan di uji lain supaya hasil tidak bergantung jam saat uji dijalankan.
process.env.ACCESS_HOURS ??= "off";

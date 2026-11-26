#!/usr/bin/env bash
# Kirim laporan DO belum terproses ke Owner. Dipanggil slm-do-backlog.timer (Senin-Sabtu 12.30 dan 15.00 WIB).
# Job dipanggil dari dalam container slm-app memakai CRON_SECRET milik container; secret tidak pernah dicetak.
set -euo pipefail
container="${SLM_CONTAINER:-slm-app}"
docker exec "$container" node -e '
const port = process.env.PORT || 3000;
fetch(`http://127.0.0.1:${port}/api/jobs/send-do-backlog`, { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET || "" } })
  .then(async (r) => { console.log(r.status, (await r.text()).slice(0, 400)); process.exit(r.ok ? 0 : 1); })
  .catch((e) => { console.error(e.message); process.exit(1); });
' 2>&1 | logger -s -t slm-do-backlog

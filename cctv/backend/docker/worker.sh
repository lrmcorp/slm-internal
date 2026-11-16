#!/bin/sh
# Satu container untuk antrian (queue:work) dan penjadwal (schedule:work) supaya hemat RAM.
# queue:work berhenti sendiri setelah batas memori/jumlah job/waktu lalu dijalankan ulang di sini;
# bila penjadwal mati, container keluar dan Docker menyalakannya lagi (restart: unless-stopped).
set -u
QUEUE_ARGS="--queue=alerts,default --sleep=1 --tries=5 --timeout=90 --memory=${QUEUE_MEMORY_MB:-128} --max-jobs=${QUEUE_MAX_JOBS:-500} --max-time=${QUEUE_MAX_TIME:-3600}"

php artisan schedule:work &
SCHEDULER=$!
QUEUE=""
stopping=0
trap 'stopping=1; kill -TERM $SCHEDULER ${QUEUE:-} 2>/dev/null' TERM INT

while [ "$stopping" -eq 0 ] && kill -0 "$SCHEDULER" 2>/dev/null; do
  if [ -z "$QUEUE" ] || ! kill -0 "$QUEUE" 2>/dev/null; then
    # shellcheck disable=SC2086
    php artisan queue:work $QUEUE_ARGS &
    QUEUE=$!
  fi
  sleep 2
done

kill -TERM "$SCHEDULER" ${QUEUE:-} 2>/dev/null
wait
[ "$stopping" -eq 1 ] && exit 0
echo "Penjadwal berhenti; container dimulai ulang" >&2
exit 1

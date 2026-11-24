<?php

namespace App\Services;

use App\Models\Camera;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/** Kapan jaga area terlarang aktif untuk sebuah kamera. Waktu selalu WIB (Asia/Jakarta). */
class GuardSchedule
{
    public const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];
    public const DEFAULT_MESSAGE = 'Perhatian. Area ini sedang tidak boleh dilewati. Mohon segera keluar dari area ini. Terima kasih.';

    /** Hari ISO (1 = Senin … 7 = Minggu). */
    public static function days(Camera $camera): array
    {
        $days = $camera->guard_days ?? self::DEFAULT_DAYS;
        return array_values(array_unique(array_map('intval', array_filter((array) $days, fn ($d) => (int) $d >= 1 && (int) $d <= 7))));
    }

    public static function message(Camera $camera): string
    {
        $text = trim((string) $camera->guard_message);
        return $text !== '' ? $text : self::DEFAULT_MESSAGE;
    }

    /** Titik zona area terlarang (koordinat 0..1), atau null bila belum digambar. */
    public static function zone(Camera $camera): ?array
    {
        foreach ((array) $camera->zones as $zone) {
            if (($zone['type'] ?? null) === 'restricted_zone' && count($zone['points'] ?? []) >= 3) {
                return $zone['points'];
            }
        }
        return null;
    }

    /**
     * Aktif bila jaga dinyalakan, zona sudah digambar, hari ini termasuk jadwal, dan jam sekarang di antara
     * mulai (termasuk) dan selesai (tidak termasuk). Jam selesai lebih kecil dari mulai = melewati tengah malam.
     */
    public static function isActive(Camera $camera, ?CarbonInterface $now = null): bool
    {
        if (!$camera->guard_enabled || self::zone($camera) === null) {
            return false;
        }
        $now = Carbon::instance($now ?? now())->setTimezone('Asia/Jakarta');
        $minutes = $now->hour * 60 + $now->minute;
        $start = self::minutes($camera->guard_start ?: '12:00');
        $end = self::minutes($camera->guard_end ?: '15:00');
        if ($start === $end) {
            return in_array($now->dayOfWeekIso, self::days($camera), true);
        }
        if ($start < $end) {
            return in_array($now->dayOfWeekIso, self::days($camera), true) && $minutes >= $start && $minutes < $end;
        }
        // Melewati tengah malam: bagian setelah tengah malam milik hari sebelumnya.
        if ($minutes >= $start) {
            return in_array($now->dayOfWeekIso, self::days($camera), true);
        }
        return $minutes < $end && in_array($now->copy()->subDay()->dayOfWeekIso, self::days($camera), true);
    }

    /** Untuk worker vision: data jaga yang dikirim bersama heartbeat/config. */
    public static function forWorker(Camera $camera): array
    {
        return [
            'active' => self::isActive($camera),
            'zone' => self::zone($camera),
            'cooldown_seconds' => max(10, (int) ($camera->guard_cooldown_seconds ?: 60)),
        ];
    }

    private static function minutes(string $time): int
    {
        [$h, $m] = array_map('intval', explode(':', $time) + [0, 0]);
        return max(0, min(23, $h)) * 60 + max(0, min(59, $m));
    }
}

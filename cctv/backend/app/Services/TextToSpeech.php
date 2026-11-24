<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * Suara Bahasa Indonesia dari Google Cloud Text-to-Speech, langsung dalam G.711 µ-law 8 kHz
 * (format speaker kamera Hikvision). Hasil disimpan per kalimat supaya API tidak dipanggil berulang.
 */
class TextToSpeech
{
    public const SAMPLE_RATE = 8000;

    public function ulaw(string $text): string
    {
        $text = trim($text);
        if ($text === '') {
            throw new RuntimeException('Kalimat kosong.');
        }
        $voice = (string) config('cctv.tts_voice');
        $path = 'cctv/tts/'.sha1($voice.'|'.config('cctv.tts_speaking_rate').'|'.$text).'.ulaw';
        $disk = Storage::disk('local');
        if ($disk->exists($path)) {
            return $disk->get($path);
        }
        $key = (string) config('cctv.tts_api_key');
        if ($key === '') {
            throw new RuntimeException('GOOGLE_TTS_API_KEY belum diisi di cctv/.env.');
        }
        $response = Http::timeout(15)->withHeaders(['X-Goog-Api-Key' => $key])
            ->post('https://texttospeech.googleapis.com/v1/text:synthesize', [
                'input' => ['text' => $text],
                'voice' => ['languageCode' => 'id-ID', 'name' => $voice],
                'audioConfig' => ['audioEncoding' => 'MULAW', 'sampleRateHertz' => self::SAMPLE_RATE,
                    'speakingRate' => (float) config('cctv.tts_speaking_rate')],
            ]);
        if (!$response->successful()) {
            $reason = $response->json('error.message') ?: 'HTTP '.$response->status();
            throw new RuntimeException("Google Text-to-Speech menolak permintaan: {$reason}");
        }
        $audio = self::stripWavHeader(base64_decode((string) $response->json('audioContent'), true) ?: '');
        if ($audio === '') {
            throw new RuntimeException('Google Text-to-Speech tidak mengirim suara.');
        }
        $disk->put($path, $audio);
        return $audio;
    }

    /** Google membungkus µ-law dalam WAV; speaker butuh sampel mentah. */
    public static function stripWavHeader(string $bytes): string
    {
        if (!str_starts_with($bytes, 'RIFF') || substr($bytes, 8, 4) !== 'WAVE') {
            return $bytes;
        }
        $offset = 12;
        while ($offset + 8 <= strlen($bytes)) {
            $id = substr($bytes, $offset, 4);
            $size = unpack('V', substr($bytes, $offset + 4, 4))[1];
            if ($id === 'data') {
                return substr($bytes, $offset + 8, $size);
            }
            $offset += 8 + $size + ($size % 2);
        }
        return '';
    }
}

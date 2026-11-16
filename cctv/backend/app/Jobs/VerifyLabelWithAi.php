<?php

namespace App\Jobs;

use App\Models\LabelRecord;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

class VerifyLabelWithAi implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;
    public int $timeout = 60;

    public function __construct(public int $labelId) {}

    public function backoff(): array
    {
        return [10, 60];
    }

    public function handle(): void
    {
        $label = LabelRecord::findOrFail($this->labelId);
        $key = config('cctv.ai_api_key');
        if (!$key || !$label->evidence_path || !Storage::disk('local')->exists($label->evidence_path)) {
            $label->update(['ai_status' => 'unavailable']);
            return;
        }

        $label->update(['ai_status' => 'processing']);
        $disk = Storage::disk('local');
        $mime = $disk->mimeType($label->evidence_path);
        if (!in_array($mime, ['image/jpeg', 'image/png'], true)) {
            $label->update(['ai_status' => 'error']);
            return;
        }
        $rawBase64 = base64_encode($disk->get($label->evidence_path));
        $provider = config('cctv.ai_provider');
        $model = config('cctv.ai_model', 'gemini-3.5-flash-lite');

        $isGemini = ($provider === 'gemini')
            || str_starts_with($key, 'AQ.')
            || str_starts_with($key, 'AIza')
            || str_contains($model, 'gemini');

        if ($provider === 'openai' || str_starts_with($key, 'sk-') || str_contains($model, 'gpt')) {
            $isGemini = false;
        }

        if ($isGemini) {
            $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent";
            $response = Http::timeout(30)->acceptJson()->withHeaders(['x-goog-api-key' => $key])->post($url, [
                'contents' => [
                    [
                        'parts' => [
                            [
                                'text' => 'Baca tiga bidang pada label dus atau QR code: nomor invoice (format 6 digit - 2 digit seperti 061026-23), nama customer (toko tujuan), dan tanda toko (Aneka Jaya atau MJ). Kembalikan karakter persis yang terlihat. Gunakan null bila bidang tidak terbaca.',
                            ],
                            [
                                'inline_data' => [
                                    'mime_type' => $mime,
                                    'data' => $rawBase64,
                                ],
                            ],
                        ],
                    ],
                ],
                'generationConfig' => [
                    'response_mime_type' => 'application/json',
                    'response_schema' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'field_one' => ['type' => 'STRING'],
                            'field_two' => ['type' => 'STRING'],
                            'field_three' => ['type' => 'STRING'],
                        ],
                    ],
                    'temperature' => 0.1,
                ],
            ])->throw()->json();

            $jsonText = $response['candidates'][0]['content']['parts'][0]['text'] ?? null;
            $answer = json_decode($jsonText ?? '', true);
        } else {
            $image = 'data:'.$mime.';base64,'.$rawBase64;
            $response = Http::withToken($key)->timeout(30)->acceptJson()
                ->post('https://api.openai.com/v1/responses', [
                    'model' => $model,
                    'store' => false,
                    'input' => [[
                        'role' => 'user',
                        'content' => [
                            ['type' => 'input_text', 'text' => 'Baca tiga bidang pada label dus: nomor invoice, nama customer, dan tanda sumber. Label bisa terputar. Kembalikan karakter yang terlihat persis, termasuk nol di depan invoice. Gunakan null bila bidang tidak terbaca; jangan menebak. Tanda sumber pada label cetak adalah Aneka Jaya atau MJ.'],
                            ['type' => 'input_image', 'image_url' => $image],
                        ],
                    ]],
                    'text' => ['format' => [
                        'type' => 'json_schema', 'name' => 'cctv_label_reading', 'strict' => true,
                        'schema' => [
                            'type' => 'object', 'additionalProperties' => false,
                            'properties' => [
                                'field_one' => ['type' => ['string', 'null']],
                                'field_two' => ['type' => ['string', 'null']],
                                'field_three' => ['type' => ['string', 'null']],
                            ],
                            'required' => ['field_one', 'field_two', 'field_three'],
                        ],
                    ]],
                ])->throw()->json();
            $answer = null;
            foreach ($response['output'] ?? [] as $output) {
                foreach ($output['content'] ?? [] as $content) {
                    if (($content['type'] ?? null) === 'output_text') {
                        $answer = json_decode($content['text'] ?? '', true);
                        break 2;
                    }
                }
            }
        }
        if (!is_array($answer)) {
            throw new \RuntimeException('AI response did not contain a label reading');
        }
        $suggestion = [];
        foreach (['field_one', 'field_two', 'field_three'] as $field) {
            $value = $answer[$field] ?? null;
            $suggestion[$field] = is_string($value) ? mb_substr(trim($value), 0, 150) : null;
        }
        if ($suggestion['field_one'] !== null &&
            !preg_match('/^\d{6}-\d{2}$/', $suggestion['field_one'])) {
            $suggestion['field_one'] = null;
        }

        $updates = ['ai_suggestion' => $suggestion, 'ai_status' => 'suggestion_ready'];
        if (empty($label->field_one) && !empty($suggestion['field_one'])) {
            $updates['field_one'] = $suggestion['field_one'];
        }
        if (empty($label->field_two) && !empty($suggestion['field_two'])) {
            $updates['field_two'] = $suggestion['field_two'];
        }
        if (empty($label->field_three) && !empty($suggestion['field_three'])) {
            $updates['field_three'] = $suggestion['field_three'];
        }
        $label->update($updates);
    }

    public function failed(?\Throwable $exception): void
    {
        LabelRecord::whereKey($this->labelId)->update(['ai_status' => 'error']);
    }
}

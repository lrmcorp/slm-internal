# syntax=docker/dockerfile:1
# Image vision ramping: OpenCV headless + ffmpeg statis dari PyPI, tanpa paket ffmpeg/tesseract Debian.
FROM python:3.12-slim
# 1 = pasang ultralytics/torch untuk deteksi paket (image jauh lebih besar). Bawaan: tanpa model.
ARG WITH_MODEL=0
# 1 = pasang tesseract untuk mode label "auto" (OCR teks bila QR tidak terbaca). Bawaan: QR saja.
ARG WITH_TESSERACT=0
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MALLOC_ARENA_MAX=2
RUN if [ "$WITH_TESSERACT" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /app
COPY requirements.txt requirements-ocr.txt requirements-model.txt ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi && \
    pip install --no-cache-dir -r requirements.txt && \
    if [ "$WITH_TESSERACT" = "1" ]; then pip install --no-cache-dir -r requirements-ocr.txt; fi && \
    if [ "$WITH_MODEL" = "1" ]; then pip install --no-cache-dir -r requirements-model.txt; fi
COPY runtime.py logic.py evidence_spool.py live_video.py worker.py ./
CMD ["python", "worker.py"]

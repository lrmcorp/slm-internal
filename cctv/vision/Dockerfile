# syntax=docker/dockerfile:1
FROM python:3.12-slim
ARG WITH_MODEL=0
ENV PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr libglib2.0-0 ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt requirements-model.txt ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi && \
    pip install --no-cache-dir -r requirements.txt && \
    if [ "$WITH_MODEL" = "1" ]; then pip install --no-cache-dir -r requirements-model.txt; fi
COPY logic.py evidence_spool.py live_video.py worker.py ./
CMD ["python", "worker.py"]

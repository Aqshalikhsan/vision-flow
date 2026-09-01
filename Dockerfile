FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    VISIONFLOW_DATA_DIR=/app/local_data \
    XDG_CACHE_HOME=/app/local_data/cache \
    MPLCONFIGDIR=/app/local_data/cache/matplotlib \
    YOLO_CONFIG_DIR=/app/local_data/cache/ultralytics \
    TORCH_HOME=/app/local_data/cache/torch \
    HF_HOME=/app/local_data/cache/huggingface
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./backend/requirements.txt
# Hosts without an NVIDIA GPU can set TORCH_INDEX_URL to the CPU wheel index so
# ultralytics resolves against a torch that is already installed, instead of
# pulling several GB of CUDA runtime libraries it can never use. Left empty the
# build keeps the default PyPI torch, which is what the GPU compose files expect.
ARG TORCH_INDEX_URL=""
RUN if [ -n "$TORCH_INDEX_URL" ]; then \
      pip install --no-cache-dir --timeout 120 --retries 10 \
        torch torchvision --index-url "$TORCH_INDEX_URL"; \
    fi
RUN pip install --no-cache-dir --timeout 120 --retries 10 -r backend/requirements.txt
COPY backend ./backend
COPY --from=frontend /app/dist ./dist
RUN mkdir -p /app/local_data/uploads /app/local_data/versions /app/local_data/runs /app/local_data/exports /app/local_data/cache /app/models
EXPOSE 8000
VOLUME ["/app/local_data", "/app/models"]
WORKDIR /app/models
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/ready', timeout=3)"
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]

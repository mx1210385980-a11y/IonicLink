FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

WORKDIR /app/backend

COPY backend/requirements.txt ./requirements.txt

RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY backend/ ./

RUN mkdir -p /app/backend/data /app/backend/temp_uploads

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

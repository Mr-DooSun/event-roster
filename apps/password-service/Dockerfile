FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY src /app/src
RUN pip install --no-cache-dir "uv>=0.6,<1" && uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:${PATH}"
EXPOSE 8080
CMD ["sh", "-c", "uvicorn password_service.main:app --host 0.0.0.0 --port ${PORT:-8080}"]

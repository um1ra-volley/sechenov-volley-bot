FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Europe/Moscow
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin volley
COPY --chown=10001:10001 bot.py attendance_sheet.py /app/
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=5 \
    CMD ["python", "/app/bot.py", "health"]
ENTRYPOINT ["python", "/app/bot.py"]
CMD ["run"]

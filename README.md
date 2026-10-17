# sechenov-volley-bot

Telegram-бот [@sechenov_volley_bot](https://t.me/sechenov_volley_bot) для Сеченовского университета и команды Росэнергоатома в ЛЧБ.

Реализованы подписки на **МССИ, ЛВЛ, ЧМ, ЛЧБ** и тренировки, сбор ФИО, ответы «Буду / Не буду», поимённая статистика владельца, ручные отметки, переносы и уведомления. Тренировки: **пн и чт, 19:30 МСК, Буревестник**.

## Документация

- [Архитектура](docs/superpowers/specs/2026-10-17-sechenov-volley-bot-design.md).
- [План реализации](docs/superpowers/plans/2026-10-17-sechenov-volley-bot.md).
- [Ход выполнения и проверки](docs/implementation-progress.md).
- [Запуск в Google](docs/deployment.md).
- [Эксплуатация и переключение среды](docs/operations.md).

## Размещение

Приватный GitHub хранит код и данные. Google Apps Script выполняет обработку. Исходное расписание читается из Google Sheets. Локальная копия проекта не требуется.

Секреты не входят в файлы Git. Перед запуском нужен новый Telegram-токен и закрытая настройка доступа к GitHub и Google.

## Проверки и поставка

[GitHub Actions](https://github.com/um1ra/sechenov-volley-bot/actions) запускает Bot CI и проверку реальных транзакций GitHub на временной синтетической ветке. Артефакт apps-script-COMMIT содержит Code.gs и appsscript.json.

## Состояние запуска

Код находится на этапе проверки сборки и интеграции. Рабочий Google deployment, реальные рассылки и приёмка webhook ещё не подтверждены. configureWebhook блокирует подключение Telegram, если реальная среда не проходит исходную HTTP-проверку.

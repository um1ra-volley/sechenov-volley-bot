# Выбор готовой основы — 17.10.2026

Просмотрены официальные репозитории:
- https://github.com/aiogram/aiogram — актуальный aiogram 3.31.0, MIT; выбран как клиент Telegram, типов кнопок и polling API.
- https://github.com/python-telegram-bot/python-telegram-bot — альтернативная Python-библиотека, есть примеры timerbot и conversationbot.
- https://github.com/nishonow/aiogram-bot-template — шаблон aiogram с админкой, Docker и SQLite; его хранилище не соответствует требованию хранить бизнес-данные в GitHub.

Дополнительно просмотрен https://github.com/BohdanFV/TeleEU_Bot — близкий по расписанию проект, но со студенческой регистрацией и SQLite.
Их исходники не клонировались на Mac. Библиотека устанавливается по requirements.txt на сервере/в образе.
Полный чужой бот не копировался: специфические правила лиг, ФИО, опросов и приватного GitHub-хранилища реализованы в bot.py.
Текущая инструкция владельца: «не надо тестить, просто просмотри и сделай»; новые тесты и прогоны прекращены.

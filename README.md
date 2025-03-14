# Telegram Timer Bot

Бот для установки таймеров с интерактивным выбором даты и времени.

## Функциональность

- Интерактивный выбор даты и времени
- Поддержка ручного ввода даты
- Отображение оставшегося времени
- Закрепление сообщения с таймером
- Поддержка нескольких часовых поясов

## Команды бота

- `/start` - Начать работу с ботом
- `/setdate` - Установить таймер через интерактивное меню
- `/setdate YYYY-MM-DD HH:mm` - Установить таймер вручную
- `/cleartimer` - Удалить текущий таймер
- `/help` - Показать справку

## Локальная разработка

### Предварительные требования

- Node.js 18+
- npm
- Docker и Docker Compose (для продакшн деплоя)

### Установка и запуск

1. Клонируйте репозиторий:
```bash
git clone https://github.com/your-username/telegram-timer-bot.git
cd telegram-timer-bot
```

2. Установите зависимости:
```bash
npm install
```

3. Создайте файл `.env` в корне проекта:

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

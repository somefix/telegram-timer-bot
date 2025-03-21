import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as TelegramBot from 'node-telegram-bot-api';
import * as moment from 'moment-timezone';

interface Timer {
  id: string;
  eventDate: moment.Moment;
  chatId: number;
  pinnedMessageId: number | null;
  isRunning: boolean;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: TelegramBot;
  private readonly timezone: string;
  private timers: Map<string, Timer> = new Map();
  private dateTimeState: {
    [key: string]: {
      year?: number;
      month?: number;
      day?: number;
      hour?: number;
      minute?: number;
      timerId?: string;
    };
  } = {};

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.timezone =
      this.configService.get<string>('TIMEZONE') || 'Europe/Moscow';
  }

  async onModuleInit() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN не установлен в .env файле');
    }

    this.bot = new TelegramBot(token, { polling: true });

    // Восстанавливаем таймеры при запуске
    await this.restoreTimers();

    // Устанавливаем команды бота
    this.bot.setMyCommands([
      {
        command: '/start',
        description: 'Начать работу с ботом',
      },
      {
        command: '/setdate',
        description: 'Создать новый таймер через интерактивное меню',
      },
      {
        command: '/mytimers',
        description: 'Показать все активные таймеры',
      },
      {
        command: '/cleartimer',
        description: 'Удалить таймер',
      },
      {
        command: '/help',
        description: 'Показать справку по командам',
      },
    ]);

    // Обновляем текст справки
    this.bot.onText(/\/help/, (msg) => {
      this.handleErrors(async () => {
        const helpText =
          '🤖 *Справка по командам*\n\n' +
          '📋 *Основные команды:*\n' +
          '▫️ /start - Начать работу с ботом\n' +
          '▫️ /setdate - Создать новый таймер через удобное меню\n' +
          '▫️ /mytimers - Показать список всех ваших активных таймеров\n' +
          '▫️ /cleartimer - Удалить таймер (можно указать ID: /cleartimer ID)\n' +
          '▫️ /help - Показать это сообщение\n\n' +
          '📝 *Дополнительные возможности:*\n' +
          '▫️ Можно установить таймер вручную: /setdate ДД.ММ.ГГГГ ЧЧ:ММ\n' +
          '▫️ Пример: /setdate 31.12.2024 23:59\n' +
          '▫️ Каждый таймер имеет свой ID для управления\n' +
          '▫️ Можно создавать несколько таймеров одновременно\n\n' +
          '⚡️ *Подсказки:*\n' +
          '▫️ Используйте /mytimers для просмотра ID ваших таймеров\n' +
          '▫️ При удалении таймера без указания ID появится меню выбора';

        await this.bot.sendMessage(msg.chat.id, helpText, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });
      });
    });

    // Обновляем приветственное сообщение
    this.bot.onText(/\/start/, (msg) => {
      this.handleErrors(async () => {
        const welcomeText =
          '👋 Привет! Я бот для управления таймерами\n\n' +
          '🔥 *Что я умею:*\n' +
          '▫️ Создавать несколько таймеров\n' +
          '▫️ Показывать оставшееся время\n' +
          '▫️ Уведомлять когда время истекло\n\n' +
          '🚀 *Начало работы:*\n' +
          '1️⃣ Используйте /setdate для создания таймера\n' +
          '2️⃣ /mytimers покажет все ваши таймеры\n' +
          '3️⃣ /help расскажет обо всех возможностях\n\n' +
          '✨ Готовы начать? Нажмите /setdate!';

        await this.bot.sendMessage(msg.chat.id, welcomeText, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });
      });
    });

    // Обновляем метод mytimers
    this.bot.onText(/\/mytimers/, (msg) => {
      this.handleErrors(async () => {
        const userTimers = Array.from(this.timers.values()).filter(
          (timer) => timer.chatId === msg.chat.id,
        );

        if (userTimers.length === 0) {
          await this.bot.sendMessage(
            msg.chat.id,
            '❌ У вас нет активных таймеров',
          );
          return;
        }

        const timersList = userTimers
          .map((timer, index) => {
            const remaining = moment.duration(timer.eventDate.diff(moment()));
            let timeLeft = '';

            if (remaining.years() > 0) timeLeft += `${remaining.years()}г `;
            if (remaining.months() > 0) timeLeft += `${remaining.months()}м `;
            if (remaining.days() > 0) timeLeft += `${remaining.days()}д `;
            if (remaining.hours() > 0) timeLeft += `${remaining.hours()}ч `;
            if (remaining.minutes() > 0)
              timeLeft += `${remaining.minutes()}мин `;
            timeLeft += `${remaining.seconds()}с`;

            return `${index + 1}. 📅 ${timer.eventDate.format('DD.MM.YYYY HH:mm')}\n⏳ Осталось: ${timeLeft}`;
          })
          .join('\n\n');

        await this.bot.sendMessage(
          msg.chat.id,
          '📋 *Ваши активные таймеры:*\n\n' +
            timersList +
            '\n\n_Используйте /cleartimer для удаления таймера_',
          {
            parse_mode: 'Markdown',
          },
        );
      });
    });

    // Обновляем обработчик установки таймера
    this.bot.onText(
      /\/setdate (\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/,
      (msg, match) => {
        this.handleErrors(async () => {
          if (!match) return;

          const [_, day, month, year, hours, minutes] = match;
          const eventDate = moment.tz(
            `${year}-${month}-${day} ${hours}:${minutes}:00`,
            'YYYY-MM-DD HH:mm:ss',
            this.timezone,
          );

          if (!eventDate.isValid()) {
            await this.bot.sendMessage(
              msg.chat.id,
              'Неправильный формат даты. Используйте /setdate для выбора даты или формат ДД.ММ.ГГГГ ЧЧ:ММ',
            );
            return;
          }

          const timerId = await this.createTimer(eventDate, msg.chat.id);
          await this.bot.sendMessage(
            msg.chat.id,
            `✅ Таймер (ID: ${timerId}) установлен на ${eventDate.format('DD.MM.YYYY HH:mm')}!`,
          );
        });
      },
    );

    // Обновляем обработчик команды cleartimer для более понятного отображения
    this.bot.onText(/\/cleartimer(?:\s+(\w+))?/, (msg, match) => {
      this.handleErrors(async () => {
        const timerId = match?.[1];
        const userTimers = Array.from(this.timers.values()).filter(
          (timer) => timer.chatId === msg.chat.id,
        );

        if (userTimers.length === 0) {
          await this.bot.sendMessage(
            msg.chat.id,
            '❌ У вас нет активных таймеров',
          );
          return;
        }

        if (!timerId) {
          const keyboard = userTimers.map((timer) => [
            {
              text: `📅 ${timer.eventDate.format('DD.MM.YYYY HH:mm')}`,
              callback_data: `delete_timer_${timer.id}`,
            },
          ]);

          await this.bot.sendMessage(
            msg.chat.id,
            'Выберите таймер для удаления:',
            {
              reply_markup: { inline_keyboard: keyboard },
            },
          );
          return;
        }

        await this.deleteTimer(timerId, msg.chat.id);
      });
    });

    this.bot.onText(/^\/setdate$/, (msg) => {
      this.handleErrors(async () => {
        const userId = msg.from?.id.toString();
        if (!userId) return;

        this.dateTimeState[userId] = {};
        await this.showYearPicker(msg.chat.id);
      });
    });

    // Обновляем обработчик callback_query
    this.bot.on('callback_query', (callbackQuery) => {
      this.handleErrors(async () => {
        const { data, message } = callbackQuery;
        const userId = callbackQuery.from.id.toString();

        if (!message || !data) return;

        if (data.startsWith('delete_timer_')) {
          const timerId = data.replace('delete_timer_', '');
          await this.deleteTimer(timerId, message.chat.id);
          // Удаляем сообщение с кнопками после выбора
          await this.bot.deleteMessage(message.chat.id, message.message_id);
          await this.bot.answerCallbackQuery(callbackQuery.id, {
            text: '✅ Таймер удален',
          });
          return;
        }

        if (data.startsWith('year_')) {
          const year = parseInt(data.split('_')[1]);
          this.dateTimeState[userId] = { year };
          await this.showMonthPicker(message.chat.id);
        } else if (data.startsWith('month_')) {
          const month = parseInt(data.split('_')[1]);
          this.dateTimeState[userId].month = month;
          await this.showDayPicker(message.chat.id, userId);
        } else if (data.startsWith('day_')) {
          const day = parseInt(data.split('_')[1]);
          this.dateTimeState[userId].day = day;
          await this.showHourPicker(message.chat.id);
        } else if (data.startsWith('hour_')) {
          const hour = parseInt(data.split('_')[1]);
          this.dateTimeState[userId].hour = hour;
          await this.showMinutePicker(message.chat.id);
        } else if (data.startsWith('minute_')) {
          const minute = parseInt(data.split('_')[1]);
          this.dateTimeState[userId].minute = minute;
          await this.setDateTime(message.chat.id, userId);
        }

        await this.bot.answerCallbackQuery(callbackQuery.id);
      });
    });
  }

  private async handleErrors(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (error) {
      console.error('Ошибка в Telegram сервисе:', error);

      // Проверяем, является ли ошибка связанной с Telegram API
      if (error instanceof Error) {
        // Игнорируем некоторые некритичные ошибки
        if (
          error.message.includes('message is not modified') ||
          error.message.includes('message to edit not found') ||
          error.message.includes('message to delete not found')
        ) {
          return;
        }
      }

      // Для остальных ошибок - пробрасываем дальше
      throw error;
    }
  }

  private async restoreTimers(): Promise<void> {
    try {
      const savedTimers = await this.prisma.timer.findMany({
        where: { isRunning: true },
      });

      for (const timerData of savedTimers) {
        const eventDate = moment(timerData.eventDate);

        // Пропускаем истекшие таймеры
        if (eventDate.isBefore(moment())) {
          await this.prisma.timer.delete({
            where: { id: timerData.id },
          });
          continue;
        }

        try {
          // Проверяем права бота для данного чата
          const chatMember = await this.bot.getChatMember(
            timerData.chatId,
            (await this.bot.getMe()).id
          );
          const canPin = chatMember.can_pin_messages;

          if (!canPin) {
            // Если нет прав - тихо удаляем таймер
            await this.prisma.timer.delete({
              where: { id: timerData.id },
            });
            continue;
          }

          // Если права есть - восстанавливаем таймер
          const timer: Timer = {
            eventDate,
            id: timerData.id,
            chatId: Number(timerData.chatId),
            pinnedMessageId: timerData.pinnedMessageId,
            isRunning: true,
          };

          this.timers.set(timer.id, timer);
          void this.startTimer(timer.id);
        } catch (error) {
          // Если произошла ошибка при проверке прав (например, бот удален из чата)
          // тоже тихо удаляем таймер
          await this.prisma.timer.delete({
            where: { id: timerData.id },
          });
          console.error(
            `Ошибка при проверке прав для таймера ${timerData.id}:`,
            error
          );
          continue;
        }
      }

      console.log(`Восстановлено ${this.timers.size} таймеров`);
    } catch (error) {
      console.error('Ошибка при восстановлении таймеров:', error);
      throw error;
    }
  }

  private async createTimer(
    eventDate: moment.Moment,
    chatId: TelegramBot.ChatId,
  ): Promise<string> {
    // Проверяем права бота перед созданием таймера
    try {
      const chatMember = await this.bot.getChatMember(chatId, (await this.bot.getMe()).id);
      const canPin = chatMember.can_pin_messages;
      
      if (!canPin) {
        await this.bot.sendMessage(
          chatId,
          '⚠️ Для корректной работы таймеров, пожалуйста:\n' +
          '1. Сделайте бота администратором группы\n' +
          '2. Включите право "Закреплять сообщения"\n\n' +
          'После этого попробуйте создать таймер снова.',
          { parse_mode: 'Markdown' }
        );
        throw new Error('Недостаточно прав для создания таймера');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Недостаточно прав для создания таймера') {
        throw error;
      }
      console.error('Ошибка при проверке прав бота:', error);
      await this.bot.sendMessage(
        chatId,
        '❌ Произошла ошибка при проверке прав. Попробуйте позже.',
      );
      throw error;
    }

    // Отправляем сообщение с лоадером
    const loadingMessage = await this.bot.sendMessage(
      chatId,
      '⏳ Создаю таймер...',
    );

    try {
      const timerId = Math.random().toString(36).substr(2, 9);
      const timer: Timer = {
        id: timerId,
        eventDate,
        chatId: Number(chatId),
        pinnedMessageId: null,
        isRunning: true,
      };

      // Анимация загрузки
      const loadingStates = ['⏳', '⌛️'];
      let currentState = 0;
      const loadingInterval = setInterval(async () => {
        try {
          await this.bot.editMessageText(
            `${loadingStates[currentState]} Создаю таймер...`,
            {
              chat_id: chatId,
              message_id: loadingMessage.message_id,
            },
          );
          currentState = (currentState + 1) % loadingStates.length;
        } catch (error) {
          // Игнорируем ошибки анимации
        }
      }, 500);

      // Сохраняем в базу данных через Prisma
      await this.prisma.timer.create({
        data: {
          id: timer.id,
          eventDate: timer.eventDate.toDate(),
          chatId: Number(timer.chatId),
          pinnedMessageId: timer.pinnedMessageId,
          isRunning: timer.isRunning,
        },
      });

      this.timers.set(timerId, timer);
      void this.startTimer(timerId);

      // Останавливаем анимацию и удаляем сообщение с лоадером
      clearInterval(loadingInterval);
      await this.bot.deleteMessage(chatId, loadingMessage.message_id);

      return timerId;
    } catch (error) {
      // В случае ошибки меняем сообщение на ошибку
      await this.bot.editMessageText('❌ Ошибка при создании таймера', {
        chat_id: chatId,
        message_id: loadingMessage.message_id,
      });
      throw error;
    }
  }

  private async deleteTimer(
    timerId: string,
    chatId: TelegramBot.ChatId,
  ): Promise<void> {
    try {
      const timer = this.timers.get(timerId);

      if (!timer) {
        await this.bot.sendMessage(chatId, '❌ Таймер не найден');
        return;
      }

      if (timer.chatId !== chatId) {
        await this.bot.sendMessage(
          chatId,
          '❌ У вас нет доступа к этому таймеру',
        );
        return;
      }

      timer.isRunning = false;

      if (timer.pinnedMessageId) {
        try {
          await this.bot.unpinChatMessage(chatId, {
            message_id: timer.pinnedMessageId,
          });
          await this.bot.deleteMessage(chatId, timer.pinnedMessageId);
        } catch (error) {
          console.error('Ошибка при откреплении/удалении сообщения:', error);
        }
      }

      // Удаляем из базы данных через Prisma
      await this.prisma.timer.delete({
        where: { id: timerId },
      });
      this.timers.delete(timerId);

      if (!this.bot.listenerCount('callback_query')) {
        await this.bot.sendMessage(chatId, `✅ Таймер удален`);
      }
    } catch (error) {
      console.error('Ошибка при удалении таймера:', error);
      throw error;
    }
  }

  private async updateTimer(timer: Timer): Promise<void> {
    await this.prisma.timer.update({
      where: { id: timer.id },
      data: {
        pinnedMessageId: timer.pinnedMessageId,
        isRunning: timer.isRunning,
      },
    });
  }

  private async startTimer(timerId: string) {
    const timer = this.timers.get(timerId);
    if (!timer) return;

    try {
      while (timer.isRunning && this.timers.has(timerId)) {
        await this.handleErrors(async () => {
          const now = moment();
          const diff = moment.duration(timer.eventDate.diff(now));
          const milliseconds = diff.asMilliseconds();

          await this.cleanupExpiredTimers(timer.chatId);

          if (milliseconds <= 0) {
            if (timer.pinnedMessageId) {
              try {
                await this.bot.unpinChatMessage(timer.chatId, {
                  message_id: timer.pinnedMessageId,
                });
                await this.bot.deleteMessage(timer.chatId, timer.pinnedMessageId);
              } catch (error) {
                console.error('Ошибка при откреплении/удалении сообщения:', error);
              }
            }
            await this.bot.sendMessage(timer.chatId, `⏳ Время пришло! (Таймер ${timer.id})`);
            this.timers.delete(timerId);
            return;
          }

          let timerText = `⏳ Таймер ${timer.id}\nОсталось: `;
          const parts: string[] = [];

          if (diff.years() > 0) {
            parts.push(
              `${diff.years()} ${this.pluralize(diff.years(), ['год', 'года', 'лет'])}`,
            );
          }
          if (diff.months() > 0) {
            parts.push(
              `${diff.months()} ${this.pluralize(diff.months(), ['месяц', 'месяца', 'месяцев'])}`,
            );
          }
          if (diff.days() > 0) {
            parts.push(
              `${diff.days()} ${this.pluralize(diff.days(), ['день', 'дня', 'дней'])}`,
            );
          }
          if (diff.hours() > 0) {
            parts.push(
              `${diff.hours()} ${this.pluralize(diff.hours(), ['час', 'часа', 'часов'])}`,
            );
          }
          if (diff.minutes() > 0) {
            parts.push(
              `${diff.minutes()} ${this.pluralize(diff.minutes(), ['минута', 'минуты', 'минут'])}`,
            );
          }
          if (diff.seconds() > 0) {
            parts.push(
              `${diff.seconds()} ${this.pluralize(diff.seconds(), ['секунда', 'секунды', 'секунд'])}`,
            );
          }

          timerText += parts.join(', ');

          if (timer.pinnedMessageId) {
            try {
              await this.bot.editMessageText(timerText, {
                chat_id: timer.chatId,
                message_id: timer.pinnedMessageId,
              });
            } catch (error) {
              if (
                error instanceof Error &&
                error.message.includes('message is not modified')
              ) {
                // Игнорируем ошибку о неизмененном сообщении
              } else {
                throw error;
              }
            }
          } else {
            try {
              const sentMessage = await this.bot.sendMessage(
                timer.chatId,
                timerText,
              );
              await this.bot.pinChatMessage(timer.chatId, sentMessage.message_id);
              timer.pinnedMessageId = sentMessage.message_id;
            } catch (error) {
              if (error instanceof Error && error.message.includes('not enough rights')) {
                // Если нет прав на закрепление, отправляем уведомление
                await this.bot.sendMessage(
                  timer.chatId,
                  '⚠️ Для корректной работы таймеров, пожалуйста:\n' +
                  '1. Сделайте бота администратором группы\n' +
                  '2. Включите право "Закреплять сообщения"',
                  { parse_mode: 'Markdown' }
                );
                // Останавливаем таймер
                timer.isRunning = false;
                this.timers.delete(timerId);
                return;
              }
              throw error;
            }
          }

          await this.updateTimer(timer);
        });

        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } catch (error) {
      console.error(`Ошибка в таймере ${timerId}:`, error);
      try {
        await this.bot.sendMessage(
          timer.chatId,
          `⚠️ Произошла ошибка в работе таймера ${timerId}. Таймер остановлен.`,
        );
      } catch (sendError) {
        console.error('Ошибка при отправке сообщения об ошибке:', sendError);
      } finally {
        this.timers.delete(timerId);
      }
    }
  }

  // Добавляем новый метод для очистки устаревших таймеров
  private async cleanupExpiredTimers(chatId: number): Promise<void> {
    try {
      // Получаем все таймеры для данного чата
      const chatTimers = Array.from(this.timers.values()).filter(
        (timer) => timer.chatId === chatId
      );

      const now = moment();
      
      // Проверяем каждый таймер
      for (const timer of chatTimers) {
        // Если таймер истек или не запущен
        if (!timer.isRunning || timer.eventDate.isBefore(now)) {
          if (timer.pinnedMessageId) {
            try {
              // Открепляем и удаляем сообщение
              await this.bot.unpinChatMessage(chatId, {
                message_id: timer.pinnedMessageId,
              });
              await this.bot.deleteMessage(chatId, timer.pinnedMessageId);
            } catch (error) {
              // Игнорируем ошибки, если сообщение уже удалено
              if (
                error instanceof Error &&
                !error.message.includes('message to delete not found') &&
                !error.message.includes('message to unpin not found')
              ) {
                console.error('Ошибка при очистке устаревшего таймера:', error);
              }
            }
          }
          
          // Удаляем таймер из базы данных и из памяти
          try {
            await this.prisma.timer.delete({
              where: { id: timer.id },
            });
            this.timers.delete(timer.id);
          } catch (error) {
            console.error('Ошибка при удалении таймера из БД:', error);
          }
        }
      }
    } catch (error) {
      console.error('Ошибка при очистке устаревших таймеров:', error);
    }
  }

  // Вспомогательная функция для правильного склонения слов
  private pluralize(number: number, words: [string, string, string]): string {
    const cases = [2, 0, 1, 1, 1, 2];
    return words[
      number % 100 > 4 && number % 100 < 20
        ? 2
        : cases[number % 10 < 5 ? number % 10 : 5]
    ];
  }

  private async showYearPicker(chatId: number) {
    const currentYear = moment().year();
    const years = Array.from({ length: 5 }, (_, i) => currentYear + i);
    const keyboard = this.createButtonRows(
      years.map((year) => ({
        text: year.toString(),
        callback_data: `year_${year}`,
      })),
      3,
    );

    await this.bot.sendMessage(chatId, 'Выберите год:', {
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  private async showMonthPicker(chatId: number) {
    const months = moment.months();
    const keyboard = this.createButtonRows(
      months.map((month, index) => ({
        text: month,
        callback_data: `month_${index + 1}`,
      })),
      3,
    );

    await this.bot.sendMessage(chatId, 'Выберите месяц:', {
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  private async showDayPicker(chatId: number, userId: string) {
    const state = this.dateTimeState[userId];
    const daysInMonth = moment(
      `${state.year}-${state.month}`,
      'YYYY-M',
    ).daysInMonth();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const keyboard = this.createButtonRows(
      days.map((day) => ({
        text: day.toString(),
        callback_data: `day_${day}`,
      })),
      7,
    );

    await this.bot.sendMessage(chatId, 'Выберите день:', {
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  private async showHourPicker(chatId: number) {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const keyboard = this.createButtonRows(
      hours.map((hour) => ({
        text: hour.toString().padStart(2, '0'),
        callback_data: `hour_${hour}`,
      })),
      6,
    );

    await this.bot.sendMessage(chatId, 'Выберите час:', {
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  private async showMinutePicker(chatId: number) {
    const minutes = [0, 15, 30, 45];
    const keyboard = this.createButtonRows(
      minutes.map((minute) => ({
        text: minute.toString().padStart(2, '0'),
        callback_data: `minute_${minute}`,
      })),
      4,
    );

    await this.bot.sendMessage(chatId, 'Выберите минуты:', {
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  private async setDateTime(chatId: number, userId: string) {
    const state = this.dateTimeState[userId];
    const dateString = `${state.year}-${state.month}-${state.day} ${state.hour}:${state.minute}`;
    const eventDate = moment.tz(dateString, 'YYYY-M-D H:m', this.timezone);

    if (!eventDate.isValid()) {
      await this.bot.sendMessage(
        chatId,
        'Произошла ошибка при установке даты. Попробуйте еще раз.',
      );
      return;
    }

    try {
      const timerId = await this.createTimer(eventDate, chatId);
      if (timerId) { // Проверяем, что таймер был создан
        await this.bot.sendMessage(
          chatId,
          `✅ Таймер (ID: ${timerId}) установлен на ${eventDate.format('DD.MM.YYYY HH:mm')}!`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Недостаточно прав для создания таймера') {
        // Ничего не делаем, так как сообщение об ошибке уже отправлено в createTimer
      } else {
        await this.bot.sendMessage(
          chatId,
          '❌ Произошла ошибка при создании таймера. Попробуйте еще раз.',
        );
        console.error('Ошибка при создании таймера:', error);
      }
    } finally {
      delete this.dateTimeState[userId];
    }
  }

  private createButtonRows<T extends TelegramBot.InlineKeyboardButton>(
    buttons: T[],
    columnsCount: number,
  ): T[][] {
    return buttons.reduce((rows: T[][], button: T, index: number) => {
      const rowIndex = Math.floor(index / columnsCount);
      if (!rows[rowIndex]) {
        rows[rowIndex] = [];
      }
      rows[rowIndex].push(button);
      return rows;
    }, []);
  }
}

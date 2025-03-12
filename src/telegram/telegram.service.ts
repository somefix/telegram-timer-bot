import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import * as moment from 'moment-timezone';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: TelegramBot;
  private eventDate: moment.Moment | null = null;
  private pinnedMessageId: number | null = null;
  private chatId: TelegramBot.ChatId | null = null;
  private readonly timezone: string;
  private dateTimeState: {
    [key: string]: {
      year?: number;
      month?: number;
      day?: number;
      hour?: number;
      minute?: number;
    };
  } = {};

  constructor(private configService: ConfigService) {
    this.timezone = this.configService.get<string>('TIMEZONE') || 'Europe/Moscow';
  }

  onModuleInit() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN не установлен в .env файле');
    }

    this.bot = new TelegramBot(token, { polling: true });

    this.bot.onText(/\/start/, (msg) => {
      this.handleErrors(async () => {
        await this.bot.sendMessage(
          msg.chat.id,
          'Привет! Используйте /setdate для установки таймера или введите дату вручную в формате /setdate YYYY-MM-DD HH:mm',
        );
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

    this.bot.onText(
      /\/setdate (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/,
      (msg, match) => {
        this.handleErrors(async () => {
          if (!match) return;

          const [_, date, time] = match;
          this.eventDate = moment.tz(
            `${date} ${time}:00`,
            'YYYY-MM-DD HH:mm:ss',
            this.timezone,
          );

          this.chatId = msg.chat.id;

          if (!this.eventDate.isValid()) {
            await this.bot.sendMessage(
              msg.chat.id,
              'Неправильный формат даты. Используйте /setdate для выбора даты.',
            );
            return;
          }

          await this.bot.sendMessage(
            msg.chat.id,
            `Событие установлено на ${this.eventDate.format('YYYY-MM-DD HH:mm')}!`,
          );
          await this.startTimer();
        });
      },
    );

    this.bot.onText(/\/cleartimer/, (msg) => {
      this.handleErrors(async () => {
        if (!this.chatId || !this.pinnedMessageId) {
          await this.bot.sendMessage(msg.chat.id, '❌ Таймер не установлен.');
          return;
        }

        const options = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Да', callback_data: 'confirm_delete' },
                { text: '❌ Отмена', callback_data: 'cancel_delete' },
              ],
            ],
          },
        };

        await this.bot.sendMessage(
          msg.chat.id,
          'Вы уверены, что хотите удалить таймер?',
          options,
        );
      });
    });

    this.bot.on('callback_query', (callbackQuery) => {
      this.handleErrors(async () => {
        const { data, message } = callbackQuery;
        const userId = callbackQuery.from.id.toString();

        if (!message || !data) return;

        if (data.startsWith('year_')) {
          const year = parseInt(data.split('_')[1]);
          this.dateTimeState[userId].year = year;
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
        } else if (
          data === 'confirm_delete' &&
          this.chatId &&
          this.pinnedMessageId
        ) {
          const currentChatId = this.chatId;
          await this.bot.unpinChatMessage(currentChatId, {
            message_id: this.pinnedMessageId,
          });
          this.pinnedMessageId = null;
          this.eventDate = null;
          this.chatId = null;
          await this.bot.sendMessage(message.chat.id, '✅ Таймер удалён.');
        } else if (data === 'cancel_delete') {
          await this.bot.sendMessage(
            message.chat.id,
            '❌ Удаление таймера отменено.',
          );
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
      if (this.chatId) {
        const currentChatId = this.chatId;
        try {
          await this.bot.sendMessage(
            currentChatId,
            '⚠️ Произошла ошибка при выполнении операции.',
          );
        } catch (sendError) {
          console.error('Ошибка при отправке сообщения об ошибке:', sendError);
        }
      }
    }
  }

  private async startTimer() {
    if (!this.eventDate || !this.chatId) return;

    const currentChatId = this.chatId;

    while (true) {
      await this.handleErrors(async () => {
        const now = moment();
        const diff = moment.duration(this.eventDate!.diff(now));

        if (diff.asMilliseconds() <= 0) {
          await this.bot.sendMessage(currentChatId, '⏳ Время пришло!');
          this.eventDate = null;
          return;
        }

        const timerText =
          `⏳ Осталось: ${diff.years()} лет, ${diff.months()} месяцев, ${diff.days()} дней, ` +
          `${diff.hours()} часов, ${diff.minutes()} минут, ${diff.seconds()} секунд`;

        if (this.pinnedMessageId) {
          await this.bot.editMessageText(timerText, {
            chat_id: currentChatId,
            message_id: this.pinnedMessageId,
          });
        } else {
          const sentMessage = await this.bot.sendMessage(
            currentChatId,
            timerText,
          );
          await this.bot.pinChatMessage(currentChatId, sentMessage.message_id);
          this.pinnedMessageId = sentMessage.message_id;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
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
    this.eventDate = moment.tz(dateString, 'YYYY-M-D H:m', this.timezone);
    this.chatId = chatId;

    if (!this.eventDate.isValid()) {
      await this.bot.sendMessage(
        chatId,
        'Произошла ошибка при установке даты. Попробуйте еще раз.',
      );
      return;
    }

    await this.bot.sendMessage(
      chatId,
      `Событие установлено на ${this.eventDate.format('YYYY-MM-DD HH:mm')}!`,
    );
    delete this.dateTimeState[userId];
    await this.startTimer();
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

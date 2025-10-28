import { Bot, Context, InlineKeyboard, InputFile } from 'grammy';
import { FileManager } from '../utils/fileUtils';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { MyContext } from '../types';

// Глобальное хранилище состояния пользователей
const userStates = new Map<number, {
    step: 'idle' | 'awaiting_name' | 'awaiting_uid' | 'awaiting_url',
    name?: string,
    uid?: string
}>();

const DATA_DIR = path.join(__dirname, '../../data');

// Инициализация меню   
const scrapingMenu = new InlineKeyboard()
    .text('Добавить категорию', 'add_category')
    .text('Удалить категорию', 'delete_category');

// Обработчики колбэков
export function setupScrapingHandlers(bot: Bot<MyContext>) {
    // Добавление категории
    bot.callbackQuery('add_category', async (ctx) => {
        const userId = ctx.chat?.id;
        if (!userId) return;

        if (userStates.has(userId)) {
            await ctx.answerCallbackQuery('⚠️ Завершите текущую операцию');
            return;
        }

        userStates.set(userId, { step: 'awaiting_name' });
        await ctx.editMessageText("📝 Введите название категории:");
    });

    // Удаление категории
    bot.callbackQuery('delete_category', async (ctx) => {
        const categories = FileManager.readJson<Record<string, string>>('data') || {};
        const keyboard = new InlineKeyboard();

        Object.keys(categories).forEach(name => {
            keyboard.text(name, `delete_${name}`).row();
        });

        keyboard.text('Назад', 'back_to_menu');
        await ctx.editMessageText("🗑 Выберите категорию для удаления:", {
            reply_markup: keyboard
        });
    });

    // Обработка удаления
    bot.callbackQuery(/delete_(.+)/, async (ctx) => {
        const categoryName = ctx.match![1];
        const categories = FileManager.readJson<Record<string, string>>('data') || {};
        const links = FileManager.readJson<Record<string, string>>('links') || {};

        if (categories[categoryName]) {
            const uid = categories[categoryName];
            delete categories[categoryName];
            delete links[uid];

            FileManager.saveJson('data', categories);
            FileManager.saveJson('links', links);
            await ctx.answerCallbackQuery(`🗑 Категория "${categoryName}" удалена`);
        } else {
            await ctx.answerCallbackQuery("❌ Категория не найдена");
        }

        const updatedKeyboard = new InlineKeyboard();
        Object.keys(categories).forEach(name => {
            updatedKeyboard.text(name, `delete_${name}`).row();
        });
        updatedKeyboard.text('Назад', 'back_to_menu');
        await ctx.editMessageReplyMarkup({ reply_markup: updatedKeyboard });
    });

    // Возврат в меню
    bot.callbackQuery('back_to_menu', async (ctx) => {
        await ctx.editMessageText("⚙️ Управление категориями:", {
            reply_markup: scrapingMenu
        });
    });

    // Обработчик сообщений
    bot.on('message:text', async (ctx) => {
        const userId = ctx.chat?.id;
        const text = ctx.message.text;
        if (!userId || !text) return;

        try {
            const state = userStates.get(userId) || { step: 'idle' };

            // Обработка отмены
            if (text.toLowerCase() === '/cancel') {
                userStates.delete(userId);
                await ctx.reply('🚫 Операция отменена');
                return;
            }

            switch (state.step) {
                case 'awaiting_name':
                    userStates.set(userId, {
                        step: 'awaiting_uid',
                        name: text
                    });
                    await ctx.reply("🔢 Введите UID (латиница, цифры, _-):\nПример: phones_oskemen");
                    break;

                case 'awaiting_uid':
                    if (!/^[a-z0-9_-]+$/i.test(text)) {
                        await ctx.reply("❌ Недопустимый UID!\nПопробуйте снова или /cancel");
                        return;
                    }

                    userStates.set(userId, {
                        ...state,
                        step: 'awaiting_url',
                        uid: text
                    });
                    await ctx.reply("🌐 Введите URL категории OLX:\nПример: https://www.olx.kz/elektronika/");
                    break;

                case 'awaiting_url':
                    try {
                        const url = new URL(text);
                        if (!url.hostname.includes('olx.kz')) {
                            throw new Error('Invalid domain');
                        }

                        const links = FileManager.readJson<Record<string, string>>('links');
                        const categories = FileManager.readJson<Record<string, string>>('data');

                        if (state.uid && links[state.uid]) {
                            await ctx.reply("⚠️ Этот UID уже используется!");
                            return;
                        }

                        if (state.name && state.uid) {
                            FileManager.saveJson('links', {
                                ...links,
                                [state.uid]: text
                            });

                            FileManager.saveJson('data', {
                                ...categories,
                                [state.name]: state.uid
                            });

                            await ctx.reply(`✅ Категория добавлена!\nНазвание: ${state.name}\nUID: ${state.uid}`);
                            userStates.delete(userId);
                        }
                    } catch (error) {
                        await ctx.reply("❌ Некорректный URL! Пример: https://www.olx.kz/elektronika/");
                    }
                    break;

                default:
                    if (text === '/scraping') return;
                    await ctx.reply("ℹ️ Используйте команды из меню /help");
                    break;
            }

        } catch (error) {
            console.error('Ошибка:', error);
            userStates.delete(userId);
            await ctx.reply("❌ Критическая ошибка! Сессия сброшена.");
        }
    });
}

// Команды
export async function startCommand(ctx: Context) {
    await ctx.reply('🚀 Бот активирован! /help - список команд');
}

export async function scrapingCommand(ctx: Context) {
    const userId = ctx.chat?.id;
    if (userId && userStates.has(userId)) {
        await ctx.reply("⚠️ Завершите текущую операцию (/cancel)");
        return;
    }

    await ctx.reply("⚙️ Управление категориями:", {
        reply_markup: scrapingMenu
    });
}

export async function helpCommand(ctx: Context) {
    await ctx.reply(
        '📜 Список команд:\n' +
        '/start - Активация бота\n' +
        '/scraping - Управление категориями\n' +
        '/get_jsons - Экспорт данных\n' +
        '/cancel - Отмена операции'
    );
}

export async function getJsonsCommand(ctx: Context) {
    try {
        const zip = new AdmZip();
        const files = ['links', 'data', 'found', 'sent'] as const;

        files.forEach(file => {
            const filePath = path.join(DATA_DIR, `${file}.json`);
            if (fs.existsSync(filePath)) {
                zip.addLocalFile(filePath);
            }
        });

        if (zip.getEntries().length === 0) {
            await ctx.reply("❌ Нет данных для экспорта");
            return;
        }

        const zipPath = path.join(DATA_DIR, 'data_export.zip');
        zip.writeZip(zipPath);

        await ctx.replyWithDocument(new InputFile(zipPath), {
            caption: '📦 Архив данных:\nlinks, data, found, sent'
        });

        fs.unlinkSync(zipPath);
    } catch (error) {
        console.error('Ошибка экспорта:', error);
        await ctx.reply("❌ Не удалось создать архив");
    }
}
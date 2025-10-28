import { Bot, session } from 'grammy';
import {
    startCommand,
    helpCommand,
    getJsonsCommand,
    scrapingCommand,
    setupScrapingHandlers
} from './routes';
import { startPeriodicParsing } from './scraper/scraper';
import 'dotenv/config';
import type { SessionData, MyContext } from './types/index';
import { FileManager } from './utils/fileUtils';

FileManager.init();

// Конфигурация для отключения логов
const botConfig = {
    client: {
        canUseWebhookReply: () => false,
        baseClientConfig: {
            logger: {
                debug: () => { },
                info: () => { },
                warn: () => { },
                error: (err: Error) => console.error('⚠️ Grammy Error:', err.message)
            }
        }
    }
};

const bot = new Bot<MyContext>(process.env.API_TOKEN!, botConfig);

// Настройка сессии
bot.use(session({
    initial: (): SessionData => ({
        step: undefined,
        categoryName: undefined,
        categoryUid: undefined
    }),
    getSessionKey: (ctx) => ctx.chat?.id.toString()
}));

// Фильтрация внутренних ошибок
bot.catch((err) => {
    if (!err.message.includes('update_id')) { // Игнорируем стандартные ошибки
        console.error("Критическая ошибка:", err);
    }
});

// Регистрация команд
bot.command('start', ctx => startCommand(ctx));
bot.command('help', helpCommand);
bot.command('get_jsons', getJsonsCommand);
bot.command('scraping', scrapingCommand);

// Подключение обработчиков
setupScrapingHandlers(bot);

// Запуск периодического парсинга
startPeriodicParsing(bot);

// Запуск бота
bot.start({
    onStart: (botInfo) => {
        console.log(`✅ Бот @${botInfo.username} запущен`);
    }
}).catch(err => {
    console.error('🚨 Ошибка запуска:', err);
});
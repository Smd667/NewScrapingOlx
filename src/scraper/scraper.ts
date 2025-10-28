import axios from 'axios';
import { parse } from 'node-html-parser';
import * as fs from 'fs';
import { Bot, GrammyError, InputFile } from 'grammy';
import * as path from 'path';
import {
    Ad,
    MyContext,
    SentData,
    StoredData,
    Links,
    ExtendedAdDetails,
    PhotoBuffer
} from '../types/index';

process.env.DEBUG = '';
console.debug = () => { };

const BASE_URL = "https://www.olx.kz";
const DATA_DIR = path.resolve(__dirname, '../../data');
const FOUND_JSON_PATH = path.join(DATA_DIR, 'found.json');
const LINKS_JSON_PATH = path.join(DATA_DIR, 'links.json');
const SENT_JSON_PATH = path.join(DATA_DIR, 'sent.json');

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36'
];

function getRandomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function adjustTime(dateStr: string): Date | null {
    const now = new Date();
    dateStr = dateStr.replace('Опубликовано', '').trim();

    if (dateStr.includes('Сегодня')) {
        const timePartMatch = dateStr.match(/в (\d{1,2}:\d{2})/);
        if (timePartMatch) {
            const timeStr = timePartMatch[1];
            const [hours, minutes] = timeStr.split(':').map(Number);
            const dateTime = new Date(now);
            dateTime.setHours(hours, minutes, 0, 0);
            dateTime.setHours(dateTime.getHours() + 5);
            return dateTime;
        }
        return now;
    }

    try {
        const parts = dateStr.split(' ');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseMonthRussian(parts[1]);
            const year = parseInt(parts[2], 10);
            if (!isNaN(day) && month !== -1 && !isNaN(year)) {
                return new Date(year, month, day);
            }
        }
        return null;
    } catch {
        return null;
    }
}

function parseMonthRussian(monthName: string): number {
    const months: Record<string, number> = {
        'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
        'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
        'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11
    };
    return months[monthName.toLowerCase()] ?? -1;
}

function isWithinOneDay(date: Date | null): boolean {
    return date ? (Date.now() - date.getTime()) < 86400000 : false;
}

function formatDate(date: Date): string {
    return `${date.getDate()} ${getMonthRussian(date.getMonth())} ${date.getFullYear()} ` +
        `в ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getMonthRussian(monthIndex: number): string {
    return [
        'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ][monthIndex];
}

async function randomDelay(min: number, max: number): Promise<void> {
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

// Функция для скачивания фото
async function downloadImage(url: string): Promise<PhotoBuffer | null> {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
            },
            timeout: 30000
        });

        const filename = `photo_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

        return {
            buffer: Buffer.from(response.data),
            filename
        };
    } catch (error) {
        console.error(`❌ Ошибка загрузки фото: ${url}`, error);
        return null;
    }
}

async function parseAdDetails(adUrl: string): Promise<ExtendedAdDetails> {
    const headers = {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://www.olx.kz/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
    };

    try {
        console.log(`🔍 Загрузка деталей объявления: ${adUrl}`);
        await randomDelay(2500, 5000);

        const response = await axios.get(adUrl, {
            headers,
            timeout: 15000,
        });

        const root = parse(response.data);

        // 💬 Продавец (частное лицо / компания)
        let isPrivate = false;
        const paramsContainer = root.querySelector('div[data-testid="ad-parameters-container"]');
        if (paramsContainer) {
            const firstParagraph = paramsContainer.querySelector('p span');
            if (firstParagraph) {
                isPrivate = firstParagraph.textContent.includes('Частное лицо');
            }
        }

        // 📝 Описание
        let description = 'Описание отсутствует';
        const descElement = root.querySelector('div.css-19duwlz');
        if (descElement) {
            description = descElement.innerHTML
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/?[^>]+(>|$)/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim()
                .substring(0, 3000);
        }

        // 🖼️ Фото
        const images: string[] = [];

        // Способ 1: Из галереи
        const galleryImages = root.querySelectorAll('div[data-testid="image-galery-container"] img');
        galleryImages.forEach(img => {
            const src = img.getAttribute('src');
            if (src && !src.includes('data:image') && !src.includes('/app/static/media/')) {
                const highQualitySrc = src.replace(/;s=\d+x\d+/, ';s=1000x1000');
                images.push(highQualitySrc);
            }
        });

        // Способ 2: Из swiper слайдов
        const swiperImages = root.querySelectorAll('.swiper-slide img');
        swiperImages.forEach(img => {
            const src = img.getAttribute('src');
            if (src && !src.includes('data:image') && !src.includes('/app/static/media/')) {
                const highQualitySrc = src.replace(/;s=\d+x\d+/, ';s=1000x1000');
                if (!images.includes(highQualitySrc)) {
                    images.push(highQualitySrc);
                }
            }
        });

        // 📞 Телефон - ПАРСИМ ЧЕРЕЗ API OLX
        let phone: string | null = null;
        try {
            // Извлекаем ID объявления из URL
            const adIdMatch = adUrl.match(/-ID([^\.]+)\.html/);
            if (adIdMatch && adIdMatch[1]) {
                const adId = adIdMatch[1];
                const phoneApiUrl = `https://www.olx.kz/api/v1/offers/${adId}/phone/`;

                console.log(`📞 Запрос телефона через API: ${phoneApiUrl}`);

                const phoneResponse = await axios.post(phoneApiUrl, {}, {
                    headers: {
                        'User-Agent': getRandomUserAgent(),
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': adUrl,
                    },
                    timeout: 10000
                });

                if (phoneResponse.data && phoneResponse.data.phone) {
                    phone = phoneResponse.data.phone;
                    console.log(`✅ Получен телефон: ${phone}`);
                }
            }
        } catch (phoneError) {
            console.log('❌ Не удалось получить телефон через API, пробуем альтернативные методы...');

            // Альтернативный метод: поиск в данных кнопки
            try {
                const phoneScripts = root.querySelectorAll('script');
                for (const script of phoneScripts) {
                    const scriptContent = script.innerHTML;
                    // Ищем телефон в различных форматах
                    const phoneRegex = /(?:\+7|8)[\s\-\(\)]*\d{3}[\s\-\(\)]*\d{3}[\s\-\(\)]*\d{2}[\s\-\(\)]*\d{2}/g;
                    const matches = scriptContent.match(phoneRegex);
                    if (matches && matches.length > 0) {
                        // Берем первый найденный номер и очищаем его от лишних символов
                        phone = matches[0].replace(/[\s\-\(\)]/g, '');
                        console.log(`✅ Найден телефон в скрипте: ${phone}`);
                        break;
                    }
                }
            } catch (altError) {
                console.log('❌ Альтернативные методы также не сработали');
            }
        }

        // 👁️ Просмотры
        let views: string | null = null;
        const viewsElement = root.querySelector('span[data-testid="page-view-counter"]');
        if (viewsElement) {
            views = viewsElement.textContent.trim();
        } else {
            const viewsText = root.querySelector('.css-16uueru');
            if (viewsText) {
                views = viewsText.textContent.trim();
            }
        }

        // 🏙️ Город
        let city: string | null = null;
        const cityElement = root.querySelector('p.css-9pna1a');
        if (cityElement) {
            city = cityElement.textContent.trim();
        }

        // 👤 Имя продавца
        let sellerName: string | null = null;
        const nameElement = root.querySelector('h4[data-testid="user-profile-user-name"]');
        if (nameElement) {
            sellerName = nameElement.textContent.trim();
        }

        let sellerSince: string | null = null;
        const sinceElement = root.querySelector('p[data-testid="member-since"]');
        if (sinceElement) {
            sellerSince = sinceElement.textContent.trim();
        }

        return {
            isPrivate,
            description,
            images: images.slice(0, 10),
            phone,
            views,
            city,
            sellerName,
            sellerSince
        };
    } catch (error) {
        console.error(`❌ Ошибка парсинга деталей для ${adUrl}:`, error);
        return {
            isPrivate: false,
            description: 'Не удалось загрузить описание',
            images: [],
            phone: null,
            views: null,
            city: null,
            sellerName: null,
            sellerSince: null
        };
    }
}

function getSentAds(): string[] {
    if (!fs.existsSync(SENT_JSON_PATH)) {
        fs.writeFileSync(SENT_JSON_PATH, JSON.stringify({ sentAdIds: [] }), 'utf-8');
        return [];
    }
    try {
        const data = JSON.parse(fs.readFileSync(SENT_JSON_PATH, 'utf-8')) as SentData;
        return Array.isArray(data?.sentAdIds) ? data.sentAdIds : [];
    } catch (error) {
        console.error(`Error reading sent ads: ${error}`);
        return [];
    }
}

function saveSentAd(adId: string): void {
    try {
        const sentData: SentData = fs.existsSync(SENT_JSON_PATH)
            ? JSON.parse(fs.readFileSync(SENT_JSON_PATH, 'utf-8'))
            : { sentAdIds: [] };

        if (!sentData.sentAdIds.includes(adId)) {
            sentData.sentAdIds.push(adId);
            fs.writeFileSync(SENT_JSON_PATH, JSON.stringify(sentData, null, 2), 'utf-8');
            console.log(`✅ ID ${adId} сохранен в sent.json`);
        }
    } catch (error) {
        console.error(`🚨 Ошибка сохранения ID: ${error}`);
    }
}

function escapeMarkdown(text: string): string {
    if (!text) return '';

    if (text.match(/^[\d\s\-\+\(\)]+$/)) {
        return text.replace(/[\+\-\(\)]/g, '\\$&');
    }

    return text
        .replace(/\s+/g, ' ')
        .replace(/^[^\S\n]+/gm, '')
        .replace(/[ \t]+$/gm, '')
        .replace(/[\u00A0\u200B\u200C\u200D]+/g, ' ')
        .trim()
        .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}



async function sendAdToChat(bot: Bot<MyContext>, ad: Ad): Promise<void> {
    const targetChatId = process.env.TARGET_CHAT_ID;
    if (!targetChatId) {
        console.error('TARGET_CHAT_ID не установлен');
        return;
    }

    if (getSentAds().includes(ad.id)) return;

    try {
        const {
            isPrivate,
            description,
            images,
            phone,
            views,
            city,
            sellerName,
            sellerSince
        } = await parseAdDetails(ad.id);

        if (ad.category === 'astelec' || ad.category === 'astlaptop') {
            if (!isPrivate) {
                console.log(`⏩ Пропуск объявления (не частное лицо): ${ad.name}`);
                saveSentAd(ad.id);
                return;
            }
        }

        // 📝 Формируем сообщение
        let message = `📌 *${escapeMarkdown(ad.name)}*\n\n`;
        message += `💰 *Цена:* ${escapeMarkdown(ad.price)}\n`;
        message += `👤 *Продавец:* ${isPrivate ? 'Частное лицо ✅' : 'Компания/Бизнес'}\n`;

        if (sellerName) {
            message += `👨‍💼 *Имя:* ${escapeMarkdown(sellerName)}\n`;
        }
        if (sellerSince) {
            message += `📅 ${escapeMarkdown(sellerSince)}\n`;
        }

        message += `🕒 *Опубликовано:* ${escapeMarkdown(ad.loc_date)}\n`;

        if (city) {
            message += `🏙️ *Город:* ${escapeMarkdown(city)}\n`;
        }
        if (views) {
            message += `👁️ *Просмотры:* ${escapeMarkdown(views)}\n`;
        }

        // Телефон теперь должен парситься правильно
        if (phone) {
            message += `📞 *Телефон:* \\+${escapeMarkdown(phone.replace('+', ''))}\n`;
        } else {
            message += `📞 *Телефон:* Не удалось получить номер\n`;
        }

        message += `\n📝 *Описание:*\n${escapeMarkdown(description)}\n\n`;
        message += `🖼️ *Фото:* ${images.length} изображений\n`;
        message += `\n🔗 *Ссылка:* ${escapeMarkdown(ad.id)}`;

        message = message.replace(/\n\s*\n/g, '\n').trim();

        // 📸 Отправляем фото группой с текстом
        if (images.length > 0) {
            try {
                console.log(`🖼️ Подготовка ${images.length} фото для групповой отправки...`);

                // Скачиваем все фото (ограничиваем до 5 для избежания ограничений Telegram)
                const photosToSend = images.slice(0, 5);
                const mediaGroup: any[] = [];

                for (let i = 0; i < photosToSend.length; i++) {
                    const imageUrl = photosToSend[i];
                    console.log(`⬇️ Загрузка фото ${i + 1}/${photosToSend.length}`);

                    const imageData = await downloadImage(imageUrl);
                    if (imageData) {
                        // Для первого фото добавляем подпись (текст объявления)
                        if (i === 0) {
                            mediaGroup.push({
                                type: 'photo',
                                media: new InputFile(imageData.buffer, imageData.filename),
                                caption: message,
                                parse_mode: 'MarkdownV2'
                            });
                        } else {
                            // Для остальных фото без подписи
                            mediaGroup.push({
                                type: 'photo',
                                media: new InputFile(imageData.buffer, imageData.filename)
                            });
                        }
                    }
                }

                if (mediaGroup.length > 0) {
                    console.log(`📤 Отправка группы из ${mediaGroup.length} фото...`);
                    await bot.api.sendMediaGroup(targetChatId, mediaGroup);
                    console.log(`✅ Успешно отправлено ${mediaGroup.length} фото группой`);
                } else {
                    // Если не удалось загрузить фото, отправляем только текст
                    await bot.api.sendMessage(targetChatId, message, {
                        parse_mode: 'MarkdownV2'
                    });
                }

            } catch (mediaError) {
                console.error('❌ Ошибка отправки медиа-группы:', mediaError);
                // Fallback: отправляем только текст
                await bot.api.sendMessage(targetChatId, message, {
                    parse_mode: 'MarkdownV2'
                });
            }
        } else {
            // Если нет фото, отправляем только текст
            await bot.api.sendMessage(targetChatId, message, {
                parse_mode: 'MarkdownV2'
            });
        }

        saveSentAd(ad.id);
        console.log(`✅ Отправлено объявление: ${ad.name}`);

        // Задержка между объявлениями
        await randomDelay(5000, 8000);

    } catch (error: any) {
        if (error instanceof GrammyError && error.error_code === 429) {
            const retryAfter = error.parameters?.retry_after || 30;
            console.error(`⚠️ Лимит запросов! Повтор через ${retryAfter} сек.`);
            await new Promise(r => setTimeout(r, retryAfter * 1000));

            try {
                const simpleMessage = `📌 ${escapeMarkdown(ad.name)}\n💰 ${escapeMarkdown(ad.price)}\n🔗 ${escapeMarkdown(ad.id)}`;

                await bot.api.sendMessage(targetChatId, simpleMessage, {
                    parse_mode: 'MarkdownV2'
                });
                saveSentAd(ad.id);
                console.log(`✅ Отправлено упрощенное объявление: ${ad.name}`);
            } catch (retryError) {
                console.error(`🚨 Ошибка повторной отправки: ${retryError}`);
            }
        } else {
            console.error(`🚨 Ошибка отправки: ${error}`);
        }
    }
}

// Остальной код остается без изменений...
async function scrapeData(url: string, bot: Bot<MyContext>, categoryName: string): Promise<void> {
    const headers = {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://www.google.com/'
    };

    try {
        console.log(`🔍 Парсинг категории: ${categoryName}`);
        await randomDelay(1000, 4000);

        const response = await axios.get(url, {
            headers,
            timeout: 15000,
            maxRedirects: 5
        });

        console.log(`✅ Статус: ${response.status}`);

        const root = parse(response.data);
        const ads = root.querySelectorAll('div[data-cy="l-card"]');
        console.log(`📊 Найдено объявлений: ${ads.length}`);

        const foundAds: Ad[] = [];
        const sentAds = getSentAds();

        for (const element of ads) {
            const title = element.querySelector('div[data-cy="ad-card-title"] h4')?.innerText.trim() ||
                element.querySelector('h4')?.innerText.trim() ||
                'Без названия';

            const price = element.querySelector('[data-testid="ad-price"]')?.innerText.trim() || 'Цена не указана';
            const rawDateElement = element.querySelector('p[data-testid="location-date"]');
            const dateText = rawDateElement?.innerText || '';
            const adjustedDate = adjustTime(dateText);

            if (!isWithinOneDay(adjustedDate)) continue;

            const link = element.querySelector('a')?.getAttribute('href');
            const fullLink = link ? (link.startsWith('http') ? link : BASE_URL + link) : '';

            if (!fullLink) continue;

            foundAds.push({
                name: title,
                price,
                loc_date: adjustedDate ? formatDate(adjustedDate) : 'Дата неизвестна',
                id: fullLink,
                category: categoryName
            });
        }

        console.log(`🆕 Отфильтровано новых объявлений: ${foundAds.length}`);

        let existingData: StoredData = { adds: [] };
        if (fs.existsSync(FOUND_JSON_PATH)) {
            existingData = JSON.parse(fs.readFileSync(FOUND_JSON_PATH, 'utf-8')) as StoredData;
        } else {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        const adsMap = new Map<string, Ad>();
        existingData.adds.forEach(ad => adsMap.set(ad.id, ad));

        const newAds: Ad[] = [];
        for (const ad of foundAds) {
            adsMap.set(ad.id, ad);

            if (!sentAds.includes(ad.id)) {
                newAds.push(ad);
            }
        }

        fs.writeFileSync(
            FOUND_JSON_PATH,
            JSON.stringify({ adds: Array.from(adsMap.values()) }, null, 4),
            'utf-8'
        );

        console.log(`💾 Сохранено новых: ${foundAds.length}, всего: ${adsMap.size}`);

        for (const ad of newAds) {
            await sendAdToChat(bot, ad);
            await randomDelay(8000, 12000); // Увеличена задержка
        }

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`❌ Ошибка запроса: ${error.message}\nСтатус: ${error.response?.status}`);

            if (error.response?.status !== 403) {
                await randomDelay(4000, 8900);
            }
        } else {
            console.error(`❌ Ошибка: ${error instanceof Error ? error.message : error}`);
            await randomDelay(5000, 10000);
        }
    }
}

async function scrapeDataFromAllLinks(bot: Bot<MyContext>): Promise<void> {
    if (!fs.existsSync(LINKS_JSON_PATH)) {
        console.error(`❌ Файл links.json не найден!`);
        console.log(`📋 Создайте файл вручную или через команду /scraping в боте`);

        const defaultLinks = {
            links: {
                "example": "https://www.olx.kz/elektronika/"
            }
        };

        try {
            fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify(defaultLinks, null, 2));
            console.log(`✅ Создан файл links.json с примером`);
        } catch (error) {
            console.error(`❌ Не удалось создать links.json: ${error}`);
        }
        return;
    }

    try {
        const content = fs.readFileSync(LINKS_JSON_PATH, 'utf-8');
        let links: Links;

        try {
            links = JSON.parse(content) as Links;
        } catch {
            links = { links: JSON.parse(content) };
        }

        if (!Object.keys(links.links).length) {
            console.error("❌ Ссылки не найдены");
            return;
        }

        console.log(`🔄 Обработка категорий: ${Object.keys(links.links).length}`);

        for (const [name, url] of Object.entries(links.links)) {
            console.log(`🎯 Обработка: ${name}`);
            try {
                await scrapeData(url, bot, name);
                const delay = Math.random() * 15000 + 5000; // Увеличена задержка
                await new Promise(r => setTimeout(r, delay));
            } catch (error) {
                console.error(`❌ Ошибка в ${name}: ${error}`);
                await randomDelay(4000, 8500);
            }
        }
    } catch (error) {
        console.error(`❌ Ошибка обработки ссылок: ${error}`);
    }
}

async function startPeriodicParsing(bot: Bot<MyContext>): Promise<void> {
    const run = async () => {
        try {
            console.log('\n=== 🚀 НАЧАЛО НОВОГО ЦИКЛА ПАРСИНГА ===');
            await scrapeDataFromAllLinks(bot);
            console.log('=== ✅ ЦИКЛ ПАРСИНГА ЗАВЕРШЕН ===\n');
        } catch (error) {
            console.error(`❌ Ошибка цикла парсинга: ${error}`);
        }
    };

    await run();
    setInterval(run, 120000);
}

export { scrapeData, scrapeDataFromAllLinks, startPeriodicParsing };

if (require.main === module) {
    console.log('Этот файл не предназначен для прямого запуска');
}
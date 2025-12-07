import axios from 'axios';
import { parse } from 'node-html-parser';
import * as fs from 'fs';
import { Bot, GrammyError, InputFile } from 'grammy';
import * as path from 'path';
import puppeteer from 'puppeteer';
import {
    Ad,
    MyContext,
    SentData,
    StoredData,
    Links,
    ExtendedAdDetails,
    PhotoBuffer
} from '../types/index';
import { xml } from 'cheerio';

process.env.DEBUG = '';
console.debug = () => { };

const BASE_URL = "https://www.olx.kz";
const DATA_DIR = path.resolve(__dirname, '../../data');
const FOUND_JSON_PATH = path.join(DATA_DIR, 'found.json');
const LINKS_JSON_PATH = path.join(DATA_DIR, 'links.json');
const SENT_JSON_PATH = path.join(DATA_DIR, 'sent.json');

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
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
            timeout: 45000
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

// ОТДЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПАРСИНГА ПРОСМОТРОВ ЧЕРЕЗ PUPPETEER
async function getViewsCount(adUrl: string): Promise<string | null> {
    let browser;

    try {
        console.log(`🔍 Получение просмотров через Puppeteer для: ${adUrl}`);

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=' + getRandomUserAgent(),
                '--window-size=1920,1080',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();

        // Эмуляция реального браузера
        await page.setUserAgent(getRandomUserAgent());
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });

        // Блокируем только ненужные ресурсы
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' ||
                resourceType === 'stylesheet' ||
                resourceType === 'font' ||
                req.url().includes('google') ||
                req.url().includes('analytics') ||
                req.url().includes('baxter')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Загружаем страницу
        await page.goto(adUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Ждем появления счетчика просмотров
        console.log('⏳ Ожидание счетчика просмотров...');
        try {
            await page.waitForSelector('[data-testid="page-view-counter"], .css-16uueru', {
                timeout: 10000
            });
            console.log('✅ Счетчик просмотров найден');
        } catch (error) {
            console.log('⚠️ Счетчик просмотров не найден, продолжаем...');
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        const views = await page.evaluate(() => {
            // Способ 1: По data-testid
            const viewsElement = document.querySelector('span[data-testid="page-view-counter"]');
            if (viewsElement) {
                const text = viewsElement.textContent?.trim();
                if (text && text.includes('Просмотров:')) {
                    return text;
                }
            }

            // Способ 2: По классу
            const classElement = document.querySelector('.css-16uueru');
            if (classElement) {
                const text = classElement.textContent?.trim();
                if (text && text.includes('Просмотров:')) {
                    return text;
                }
            }

            // Способ 3: Поиск в footer
            const footer = document.querySelector('div[data-testid="ad-footer-bar-section"]');
            if (footer) {
                const footerText = footer.textContent;
                if (footerText && footerText.includes('Просмотров:')) {
                    const match = footerText.match(/Просмотров:\s*(\d+)/);
                    if (match) {
                        return `Просмотров: ${parseInt(match[1]).toLocaleString('ru-RU')}`;
                    }
                }
            }

            // Способ 4: Поиск по всем span
            const allSpans = document.querySelectorAll('span');
            for (const span of allSpans) {
                const text = span.textContent;
                if (text && text.includes('Просмотров:')) {
                    const match = text.match(/Просмотров:\s*(\d+)/);
                    if (match) {
                        return `Просмотров: ${parseInt(match[1]).toLocaleString('ru-RU')}`;
                    }
                }
            }

            return null;
        });

        await browser.close();

        if (views) {
            console.log(`✅ Получены просмотры: ${views}`);
        } else {
            console.log('❌ Просмотры не найдены через Puppeteer');
        }

        return views;

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error(`❌ Ошибка получения просмотров:`, error);
        return null;
    }
}

// ГИБРИДНЫЙ ПАРСИНГ ОСНОВНЫХ ДАННЫХ ЧЕРЕЗ AXIOS
async function parseAdDetailsHybrid(adUrl: string): Promise<ExtendedAdDetails> {
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
        'DNT': '1'
    };

    try {
        console.log(`🔍 Гибридный парсинг: ${adUrl}`);

        // Получаем основные данные через axios
        const response = await axios.get(adUrl, {
            headers,
            timeout: 15000,
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            }
        });

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const root = parse(response.data);

        // Проверяем, что получили нормальную страницу
        const title = root.querySelector('h1') || root.querySelector('title');
        if (!title || title.textContent?.includes('Доступ ограничен') || title.textContent?.includes('Bot')) {
            throw new Error('Возможная блокировка или капча');
        }

        // 💬 Продавец (частное лицо / компания)
        let isPrivate = false;
        const paramsContainer = root.querySelector('div[data-testid="ad-parameters-container"]');
        if (paramsContainer) {
            const firstParagraph = paramsContainer.querySelector('p span');
            if (firstParagraph) {
                isPrivate = firstParagraph.textContent?.includes('Частное лицо') || false;
            }
        }

        // 📝 Описание
        let description = 'Описание отсутствует';
        const descElement = root.querySelector('div[data-cy="ad_description"]') ||
            root.querySelector('div.css-19duwlz');
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

        // Способ 1: Галерея с data-testid
        const galleryImages = root.querySelectorAll('div[data-testid="image-galery-container"] img');
        galleryImages.forEach(img => {
            const src = img.getAttribute('src');
            if (src && !src.includes('data:image') && !src.includes('/app/static/media/')) {
                const highQualitySrc = src.replace(/;s=\d+x\d+/, ';s=1000x1000');
                if (!images.includes(highQualitySrc)) {
                    images.push(highQualitySrc);
                }
            }
        });

        // Способ 2: Swiper слайды
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

        // Способ 3: Альтернативные селекторы
        const altImages = root.querySelectorAll('img[data-testid*="image"], img[alt*="iPhone"], img[alt*="Айфон"]');
        altImages.forEach(img => {
            const src = img.getAttribute('src');
            if (src && src.includes('apollo.olxcdn.com') && !src.includes('data:image')) {
                const highQualitySrc = src.replace(/;s=\d+x\d+/, ';s=1000x1000');
                if (!images.includes(highQualitySrc)) {
                    images.push(highQualitySrc);
                }
            }
        });

        // 👁️ ПРОСМОТРЫ - ОТДЕЛЬНО ЧЕРЕЗ PUPPETEER
        let views: string | null = null;
        try {
            views = await getViewsCount(adUrl);
        } catch (error) {
            console.warn('⚠️ Не удалось получить просмотры через Puppeteer');
        }

        // 🏙️ Город
        let city: string | null = null;
        const cityElement = root.querySelector('p.css-9pna1a') ||
            root.querySelector('[data-testid="location-date"]');
        if (cityElement) {
            city = cityElement.textContent?.trim().split(',')[0] || null;
        }

        // 👤 Имя продавца
        let sellerName: string | null = null;
        const nameElement = root.querySelector('h4[data-testid="user-profile-user-name"]');
        if (nameElement) {
            sellerName = nameElement.textContent?.trim() || null;
        }

        // 📅 Дата регистрации продавца
        let sellerSince: string | null = null;
        const sinceElement = root.querySelector('p[data-testid="member-since"]');
        if (sinceElement) {
            sellerSince = sinceElement.textContent?.trim() || null;
        }

        console.log(`✅ Гибридный парсинг успешен: ${images.length} фото, ${views || 'нет просмотров'}`);

        return {
            isPrivate,
            description,
            images: images.slice(0, 10),
            phone: null,
            views,
            city,
            sellerName,
            sellerSince
        };

    } catch (error) {
        console.error(`❌ Ошибка гибридного парсинга:`, error);
        throw error;
    }
}

// FALLBACK ПАРСИНГ (полный Puppeteer)
async function parseAdDetailsFallback(adUrl: string): Promise<ExtendedAdDetails> {
    let browser;

    try {
        console.log(`🔍 Fallback парсинг (полный Puppeteer): ${adUrl}`);

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=' + getRandomUserAgent(),
                '--window-size=1920,1080',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();

        await page.setUserAgent(getRandomUserAgent());
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' ||
                resourceType === 'stylesheet' ||
                resourceType === 'font' ||
                req.url().includes('google') ||
                req.url().includes('analytics') ||
                req.url().includes('baxter')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(adUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Ждем ключевые элементы
        try {
            await page.waitForSelector('[data-testid="ad-parameters-container"], [data-cy="ad_description"], .swiper-slide', {
                timeout: 10000
            });
        } catch (error) {
            console.log('⚠️ Ключевые элементы не найдены');
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

        const html = await page.content();
        const root = parse(html);

        let isPrivate = false;
        const paramsContainer = root.querySelector('div[data-testid="ad-parameters-container"]');
        if (paramsContainer) {
            const firstParagraph = paramsContainer.querySelector('p span');
            if (firstParagraph) {
                isPrivate = firstParagraph.textContent?.includes('Частное лицо') || false;
            }
        }

        let description = 'Описание отсутствует';
        const descElement = root.querySelector('div[data-cy="ad_description"]') ||
            root.querySelector('div.css-19duwlz');
        if (descElement) {
            description = descElement.innerHTML
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/?[^>]+(>|$)/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim()
                .substring(0, 3000);
        }

        const images: string[] = [];
        const galleryImages = root.querySelectorAll('div[data-testid="image-galery-container"] img');
        galleryImages.forEach(img => {
            const src = img.getAttribute('src');
            if (src && !src.includes('data:image') && !src.includes('/app/static/media/')) {
                const highQualitySrc = src.replace(/;s=\d+x\d+/, ';s=1000x1000');
                images.push(highQualitySrc);
            }
        });

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

        let views: string | null = null;
        try {
            views = await getViewsCount(adUrl);
        } catch (error) {
            console.warn('⚠️ Не удалось получить просмотры в fallback');
        }

        let city: string | null = null;
        const cityElement = root.querySelector('p.css-9pna1a');
        if (cityElement) {
            city = cityElement.textContent?.trim() || null;
        }

        let sellerName: string | null = null;
        const nameElement = root.querySelector('h4[data-testid="user-profile-user-name"]');
        if (nameElement) {
            sellerName = nameElement.textContent?.trim() || null;
        }

        let sellerSince: string | null = null;
        const sinceElement = root.querySelector('p[data-testid="member-since"]');
        if (sinceElement) {
            sellerSince = sinceElement.textContent?.trim() || null;
        }

        await browser.close();

        console.log(`✅ Fallback успешен: ${images.length} фото, ${views || 'нет просмотров'}`);

        return {
            isPrivate,
            description,
            images: images.slice(0, 10),
            phone: null,
            views,
            city,
            sellerName,
            sellerSince
        };

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error(`❌ Fallback парсинг не удался:`, error);
        throw error;
    }
}

// ФУНКЦИЯ С РЕТРАЯМИ
async function parseAdDetailsWithRetry(adUrl: string, maxRetries: number = 2): Promise<ExtendedAdDetails> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 Попытка парсинга ${attempt}/${maxRetries} для ${adUrl}`);

            if (attempt > 1) {
                await randomDelay(5000 * attempt, 8000 * attempt);
            }

            // Сначала пробуем гибридный парсинг
            return await parseAdDetailsHybrid(adUrl);

        } catch (error) {
            lastError = error;
            console.log(`❌ Гибридный парсинг не удался (попытка ${attempt}):`, error);

            if (attempt === maxRetries) {
                console.log('🔄 Переход к fallback парсингу...');
                try {
                    return await parseAdDetailsFallback(adUrl);
                } catch (fallbackError) {
                    console.error('❌ Fallback также не сработал');
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
        }
    }

    throw lastError;
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

    const escaped = text
        .replace(/\s+/g, ' ')
        .replace(/^[^\S\n]+/gm, '')
        .replace(/[ \t]+$/gm, '')
        .replace(/[\u00A0\u200B\u200C\u200D]+/g, ' ')
        .trim()
        .replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
        .replace(/^-/gm, '\\-')
        .replace(/([+])/g, '\\$1');

    return escaped;
}

// ФУНКЦИЯ ОТПРАВКИ
async function sendAdToChat(bot: Bot<MyContext>, ad: Ad): Promise<void> {
    const targetChatId = process.env.TARGET_CHAT_ID;
    if (!targetChatId) {
        console.error('TARGET_CHAT_ID не установлен');
        return;
    }

    if (getSentAds().includes(ad.id)) {
        console.log(`⏩ Пропуск дубликата перед отправкой: ${ad.id}`);
        return;
    }

    try {
        const adUrl = (ad as any).url || ad.id;

        const {
            isPrivate,
            description,
            images,
            phone,
            views,
            city,
            sellerName,
            sellerSince
        } = await parseAdDetailsWithRetry(adUrl, 2);

        if (ad.category === 'astelec' || ad.category === 'astlaptop') {
            if (!isPrivate) {
                console.log(`⏩ Пропуск объявления (не частное лицо): ${ad.name}`);
                saveSentAd(ad.id);
                return;
            }
        }

        let message = `<b>📌 ${ad.name}</b>\n\n`;
        message += `<b>💰 Цена:</b> ${ad.price}\n`;
        message += `<b>👤 Продавец:</b> ${isPrivate ? 'Частное лицо ✅' : 'Компания/Бизнес'}\n`;

        if (sellerName) {
            message += `<b>👨‍💼 Имя:</b> ${sellerName}\n`;
        }
        if (sellerSince) {
            message += `<b>📅</b> ${sellerSince}\n`;
        }

        message += `<b>🕒 Опубликовано:</b> ${ad.loc_date}\n`;

        if (city) {
            message += `<b>🏙️ Город:</b> ${city}\n`;
        }

        if (views) {
            message += `<b>👀 Кол-во просмотров:</b> ${views}\n`;
        } else {
            message += `<b>👀 Кол-во просмотров:</b> Неизвестно\n`;
        }

        message += `<b>📞 Телефон:</b> Доступен по ссылке ниже\n`;
        message += `\n<b>📝 Описание:</b>\n${description}\n\n`;
        message += `<b>🖼️ Фото:</b> ${images.length} изображений\n`;
        message += `\n<b>🔗 Ссылка:</b> <a href="${adUrl}">${adUrl}</a>`;

        message = message.replace(/\n\s*\n/g, '\n').trim();

        if (images.length > 0) {
            try {
                console.log(`🖼️ Подготовка ${images.length} фото для групповой отправки...`);

                const photosToSend = images.slice(0, 5);
                const mediaGroup: any[] = [];

                for (let i = 0; i < photosToSend.length; i++) {
                    const imageUrl = photosToSend[i];
                    console.log(`⬇️ Загрузка фото ${i + 1}/${photosToSend.length}`);

                    const imageData = await downloadImage(imageUrl);
                    if (imageData) {
                        if (i === 0) {
                            mediaGroup.push({
                                type: 'photo',
                                media: new InputFile(imageData.buffer, imageData.filename),
                                caption: message,
                                parse_mode: 'HTML'
                            });
                        } else {
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
                    await bot.api.sendMessage(targetChatId, message, {
                        parse_mode: 'HTML'
                    });
                }

            } catch (mediaError) {
                console.error('❌ Ошибка отправки медиа-группы:', mediaError);
                await bot.api.sendMessage(targetChatId, message, {
                    parse_mode: 'HTML'
                });
            }
        } else {
            await bot.api.sendMessage(targetChatId, message, {
                parse_mode: 'HTML'
            });
        }

        saveSentAd(ad.id);
        console.log(`✅ Отправлено объявление: ${ad.name}`);

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

            const adIdMatch = fullLink.match(/ID([^\.]+)\.html/);
            const adId = adIdMatch ? `ID${adIdMatch[1]}` : fullLink;

            if (sentAds.includes(adId)) {
                console.log(`⏩ Пропуск дубликата: ${adId}`);
                continue;
            }

            foundAds.push({
                name: title,
                price,
                loc_date: adjustedDate ? formatDate(adjustedDate) : 'Дата неизвестна',
                id: adId,
                url: fullLink,
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
            if (!adsMap.has(ad.id) && !sentAds.includes(ad.id)) {
                adsMap.set(ad.id, ad);
                newAds.push(ad);
                console.log(`✅ Новое объявление: ${ad.name}`);
            } else {
                console.log(`⏩ Пропуск дубликата (в found.json): ${ad.id}`);
            }
        }

        fs.writeFileSync(
            FOUND_JSON_PATH,
            JSON.stringify({ adds: Array.from(adsMap.values()) }, null, 4),
            'utf-8'
        );

        console.log(`💾 Сохранено новых: ${newAds.length}, всего: ${adsMap.size}`);

        for (const ad of newAds) {
            await sendAdToChat(bot, ad);
            await randomDelay(8000, 12000);
        }

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`❌ Ошибка запроса: ${error.message}\nСтатус: ${error.response?.status}`);

            if (error.response?.status !== 403) {
                await randomDelay(4000, 8900);
            }
        } else {
            console.error(`❌ Ошибка:`, error);
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
            console.error(`❌ Не удалось создать links.json:`, error);
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
                const delay = Math.random() * 15000 + 5000;
                await new Promise(r => setTimeout(r, delay));
            } catch (error) {
                console.error(`❌ Ошибка в ${name}:`, error);
                await randomDelay(4000, 8500);
            }
        }
    } catch (error) {
        console.error(`❌ Ошибка обработки ссылок:`, error);
    }
}

async function startPeriodicParsing(bot: Bot<MyContext>): Promise<void> {
    const run = async () => {
        try {
            console.log('\n=== 🚀 НАЧАЛО НОВОГО ЦИКЛА ПАРСИНГА ===');
            await scrapeDataFromAllLinks(bot);
            console.log('=== ✅ ЦИКЛ ПАРСИНГА ЗАВЕРШЕН ===\n');
        } catch (error) {
            console.error(`❌ Ошибка цикла парсинга:`, error);
        }
    };

    await run();
    setInterval(run, 120000);
}

export { scrapeData, scrapeDataFromAllLinks, startPeriodicParsing };

if (require.main === module) {
    console.log('Этот файл не предназначен для прямого запуска');
}
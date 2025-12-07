import { chromium } from 'playwright';

async function parsePhoneNumber(): Promise<string> {
    const browser = await chromium.launch({
        headless: false,
        slowMo: 50,
    });

    const page = await browser.newPage();

    try {
        console.log('Загружаем страницу...');
        await page.goto('https://www.olx.kz/d/obyavlenie/prodam-iphone-12-pro-max-na-128-gb-IDqoTiZ.html', {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        console.log('Страница загружена');
        await page.waitForTimeout(3000);

        // Прокручиваем к кнопке
        await page.evaluate(() => {
            const button = document.querySelector('button[data-cy="ad-contact-phone"]');
            if (button) {
                button.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });

        await page.waitForTimeout(1000);

        console.log('Пробуем разные методы клика...');

        // МЕТОД 1: Обычный клик через Playwright
        console.log('Метод 1: Обычный клик');
        try {
            await page.click('button[data-cy="ad-contact-phone"]', { delay: 100 });
            console.log('Клик выполнен (метод 1)');
        } catch (error) {
            console.log('Метод 1 не сработал');
        }

        await page.waitForTimeout(3000);

        // Проверяем результат
        let buttonText = await page.$eval(
            'button[data-cy="ad-contact-phone"]',
            (el: Element) => el.textContent?.trim() || ''
        );

        if (buttonText !== 'Показать телефон') {
            console.log('Успех! Текст изменился:', buttonText);
            return buttonText;
        }

        // МЕТОД 2: Двойной клик
        console.log('Метод 2: Двойной клик');
        try {
            const button = await page.$('button[data-cy="ad-contact-phone"]');
            if (button) {
                await button.dblclick({ delay: 100 });
                console.log('Двойной клик выполнен');
            }
        } catch (error) {
            console.log('Метод 2 не сработал');
        }

        await page.waitForTimeout(3000);

        buttonText = await page.$eval(
            'button[data-cy="ad-contact-phone"]',
            (el: Element) => el.textContent?.trim() || ''
        );

        if (buttonText !== 'Показать телефон') {
            console.log('Успех! Текст изменился:', buttonText);
            return buttonText;
        }

        // МЕТОД 3: JavaScript click() с полной эмуляцией событий
        console.log('Метод 3: Полная эмуляция событий через JS');
        const clickResult = await page.evaluate(() => {
            const button = document.querySelector('button[data-cy="ad-contact-phone"]') as HTMLButtonElement;
            if (!button) return 'Кнопка не найдена';

            try {
                // Создаем полную последовательность событий мыши
                const events = ['mousedown', 'mouseup', 'click'] as const;

                events.forEach(eventType => {
                    const event = new MouseEvent(eventType, {
                        view: window,
                        bubbles: true,
                        cancelable: true,
                        button: 0,
                        buttons: 1
                    });
                    button.dispatchEvent(event);
                });

                // Также вызываем нативный click
                button.click();

                return 'События отправлены';
            } catch (error) {
                return `Ошибка: ${error}`;
            }
        });

        console.log('Результат JS клика:', clickResult);
        await page.waitForTimeout(3000);

        buttonText = await page.$eval(
            'button[data-cy="ad-contact-phone"]',
            (el: Element) => el.textContent?.trim() || ''
        );

        if (buttonText !== 'Показать телефон') {
            console.log('Успех! Текст изменился:', buttonText);
            return buttonText;
        }

        // МЕТОД 4: Focus + Enter
        console.log('Метод 4: Focus + Enter');
        try {
            await page.focus('button[data-cy="ad-contact-phone"]');
            await page.waitForTimeout(500);
            await page.keyboard.press('Enter');
            await page.keyboard.press('Space');
            console.log('Focus + Enter выполнены');
        } catch (error) {
            console.log('Метод 4 не сработал');
        }

        await page.waitForTimeout(3000);

        // Финальная проверка
        buttonText = await page.$eval(
            'button[data-cy="ad-contact-phone"]',
            (el: Element) => el.textContent?.trim() || ''
        );

        console.log('Финальный текст кнопки:', buttonText);

        if (buttonText === 'Показать телефон') {
            // Проверяем, не disabled ли кнопка
            const isDisabled = await page.$eval(
                'button[data-cy="ad-contact-phone"]',
                (el: Element) => (el as HTMLButtonElement).disabled
            );

            if (isDisabled) {
                return 'Кнопка disabled - требуется авторизация';
            }

            // Делаем скриншот для анализа
            await page.screenshot({ path: 'final-debug.png' });
            return 'Клик не срабатывает - возможно требуется авторизация';
        }

        return buttonText;

    } catch (error) {
        console.error('Произошла ошибка:', error);
        await page.screenshot({ path: 'error.png' });

        const errorMessage = error instanceof Error ? error.message : String(error);
        return 'Ошибка: ' + errorMessage;
    } finally {
        await browser.close();
    }
}

// Простая функция для проверки состояния кнопки
async function checkButtonState() {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    try {
        await page.goto('https://www.olx.kz/d/obyavlenie/prodam-iphone-12-pro-max-na-128-gb-IDqoTiZ.html');
        await page.waitForTimeout(3000);

        // Проверяем состояние кнопки
        const buttonInfo = await page.evaluate(() => {
            const button = document.querySelector('button[data-cy="ad-contact-phone"]') as HTMLButtonElement;
            if (!button) return { error: 'Кнопка не найдена' };

            return {
                text: button.textContent?.trim(),
                disabled: button.disabled,
                style: {
                    display: window.getComputedStyle(button).display,
                    visibility: window.getComputedStyle(button).visibility,
                    opacity: window.getComputedStyle(button).opacity,
                    pointerEvents: window.getComputedStyle(button).pointerEvents,
                },
                classList: Array.from(button.classList),
                attributes: Array.from(button.attributes).map(attr => ({ name: attr.name, value: attr.value }))
            };
        });

        console.log('Информация о кнопке:', JSON.stringify(buttonInfo, null, 2));

        return buttonInfo;
    } finally {
        await browser.close();
    }
}

// Упрощенная функция для тестирования реакции кнопки
async function testButtonReaction() {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    try {
        await page.goto('https://www.olx.kz/d/obyavlenie/prodam-iphone-12-pro-max-na-128-gb-IDqoTiZ.html');
        await page.waitForTimeout(3000);

        // Добавляем обработчики для отслеживания событий
        await page.evaluate(() => {
            const button = document.querySelector('button[data-cy="ad-contact-phone"]');
            if (button) {
                const events = ['click', 'mousedown', 'mouseup', 'focus'];
                events.forEach(eventType => {
                    button.addEventListener(eventType, (e) => {
                        console.log(`Событие ${eventType} на кнопке`);
                    });
                });
            }
        });

        console.log('Кликаем на кнопку...');
        await page.click('button[data-cy="ad-contact-phone"]');

        await page.waitForTimeout(5000);

        // Проверяем, были ли события
        const eventsFired = await page.evaluate(() => {
            return (window as any).buttonEvents || [];
        });

        console.log('События кнопки:', eventsFired);

    } finally {
        await browser.close();
    }
}

// Запускаем
async function main() {
    console.log('══════════════════════════════');
    console.log('1. Проверяем состояние кнопки...');
    console.log('══════════════════════════════');

    const buttonInfo = await checkButtonState();

    console.log('══════════════════════════════');
    console.log('2. Тестируем реакцию кнопки...');
    console.log('══════════════════════════════');

    await testButtonReaction();

    console.log('══════════════════════════════');
    console.log('3. Запускаем основной парсер...');

    console.log('══════════════════════════════');


    const result = await parsePhoneNumber();
    console.log('ФИНАЛЬНЫЙ РЕЗУЛЬТАТ:', result);
}

main().catch(console.error);
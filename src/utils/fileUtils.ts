// src/utils/fileUtils.ts
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILES = {
    links: path.join(DATA_DIR, 'links.json'),
    data: path.join(DATA_DIR, 'data.json'),
    found: path.join(DATA_DIR, 'found.json'),
    sent: path.join(DATA_DIR, 'sent.json')
};

type FileType = keyof typeof DATA_FILES;

export class FileManager {
    private static DEFAULT_CONTENT: Record<FileType, any> = {
        links: {},
        data: {},
        found: { adds: [] },
        sent: { sentAdIds: [] }
    };

    static init() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        for (const [fileType, defaultContent] of Object.entries(this.DEFAULT_CONTENT)) {
            const filePath = DATA_FILES[fileType as FileType];
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
            }
        }
    }

    static readJson<T>(fileType: FileType): T {
        try {
            const rawData = fs.readFileSync(DATA_FILES[fileType], 'utf-8');
            return JSON.parse(rawData) || this.DEFAULT_CONTENT[fileType];
        } catch (error) {
            // Восстанавливаем файл при ошибке парсинга
            console.error(`Corrupted ${fileType} file, resetting to default`);
            this.saveJson(fileType, this.DEFAULT_CONTENT[fileType]);
            return this.DEFAULT_CONTENT[fileType];
        }
    }

    static saveJson(fileType: FileType, data: any) {
        fs.writeFileSync(
            DATA_FILES[fileType],
            JSON.stringify(data, null, 2),
            'utf-8'
        );
    }
}
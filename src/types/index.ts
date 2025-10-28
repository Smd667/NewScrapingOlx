import { Context } from "grammy";
import { InputFile } from "grammy";

export interface Ad {
    category: string;
    name: string;
    price: string;
    loc_date: string;
    id: string;
}

export interface ExtendedAdDetails {
    isPrivate: boolean;
    description: string;
    images: string[];
    phone: string | null;
    views: string | null;
    city: string | null;
    sellerName: string | null;
    sellerSince: string | null;
}

export interface SessionData {
    step?: 'name' | 'uid' | 'url';
    categoryName?: string;
    categoryUid?: string;
}

export interface MyContext extends Context {
    session: SessionData;
}

export interface StoredData {
    adds: Ad[];
}

export interface SentData {
    sentAdIds: string[];
}

export interface Links {
    links: Record<string, string>;
}

export interface PhotoBuffer {
    buffer: Buffer;
    filename: string;
}
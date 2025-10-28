import { Context } from "grammy";

// src/types/index.ts
export interface Ad {
    category: string;
    name: string;
    price: string;
    loc_date: string;
    id: string;
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
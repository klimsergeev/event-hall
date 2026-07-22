/* ============================================================
   МОК-данные (эмуляция «бэка на фронте»).
   Источники: SESSIONS/TIERS из handoff, билеты/цены — из Figma
   (нода 4898-91317 / 4902-80252). Значения — демонстрационные.
   ============================================================ */

/* Заголовок события (Figma 4903:81228) */
export const EVENT = {
    title: 'Сергей Лазарев «Шоумен»',
};

/* Сеансы (табы). Даты/площадки/цены — мок из handoff SESSIONS. */
export const SESSIONS = [
    { id: 's1', wd: 'сб', date: '28 авг', time: '20:00', venue: 'VK Stadium',         from: 'от 3 500 ₽', weekend: true  },
    { id: 's2', wd: 'вт', date: '31 авг', time: '19:30', venue: 'Adrenaline Stadium', from: 'от 2 800 ₽', weekend: false },
    { id: 's3', wd: 'чт', date: '9 сен',  time: '20:00', venue: 'Live Арена',         from: 'от 4 200 ₽', weekend: false },
    { id: 's4', wd: 'сб', date: '18 сен', time: '19:00', venue: 'ВТБ Арена',          from: 'от 5 500 ₽', weekend: true  },
    { id: 's5', wd: 'ср', date: '22 сен', time: '19:30', venue: 'БКЗ «Октябрьский»',  from: 'от 2 500 ₽', weekend: false },
    { id: 's6', wd: 'сб', date: '2 окт',  time: '20:00', venue: 'ЦСКА Арена',         from: 'от 3 800 ₽', weekend: true  },
    { id: 's7', wd: 'вс', date: '10 окт', time: '19:00', venue: 'Green Theatre',      from: 'от 4 500 ₽', weekend: true  },
];

/* Легенда цен (Figma «Hall price filter» 4903:81244) — цвета не токены DS. */
export const TIERS = [
    { color: '#00724d', label: '600'    },
    { color: '#00d9bc', label: '900'    },
    { color: '#027722', label: '2 000'  },
    { color: '#d3f36b', label: '8 000'  },
    { color: '#fdf177', label: '9 000'  },
    { color: '#e04a17', label: '15 000' },
    { color: '#ff7f7f', label: '16 000' },
    { color: '#ff403f', label: '18 000' },
    { color: '#b22625', label: '20 000' },
];

/* Выбранные места (Figma слайдер билетов 4902:80253). */
export const TICKETS = [
    { seat: '94', row: '9', price: '3 500 ₽' },
    { seat: '96', row: '9', price: '3 500 ₽' },
    { seat: '95', row: '9', price: '3 500 ₽' },
];

/* Итог CTA (Figma 4902:80257). */
export const CTA_TOTAL = '10 500 ₽';

/* Прод-значения твиков (handoff TWEAKS.md). */
export const TWEAKS = {
    compactionMode: 'any',   // 'any' | 'zoom-only' | 'never'
    shrinkTitle: true,
    marquee: true,
    headerButton: 'back',
};

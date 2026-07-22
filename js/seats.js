/* ============================================================
   Модель мест схемы зала.
   Данные (ряд/место/цена/секция/статус) НЕ хранятся отдельным списком,
   а ВЫВОДЯТСЯ из геометрии инлайн-SVG (assets/hall.svg) — единственного
   источника расположения мест. Так модель не может «разъехаться» со схемой.

   Каждое место схемы — <rect width=8 height=8>. Цвет fill кодирует тир:
     • тир-цвет из TIERS  → доступное место, цена = цене тира;
     • #BBC1C7            → занятое/недоступное место (без цены).
   (У занятого места в SVG два rect: заливка + белая обводка — обводочный
    rect без атрибута fill, поэтому фильтр по fill его отсеивает, дублей нет.)

   buildSeats() размечает rect'ы data-атрибутами (data-section/row/seat/
   price/tier/status) — данные «привязаны к местам» прямо в DOM — и
   возвращает массив объектов-мест.
   ============================================================ */
import { TIERS } from './data.js';

const OCCUPIED = '#BBC1C7';
const SECTION_GAP = 40;   // разрыв по Y больше этого = граница секций
const SECTIONS = ['Партер', 'Балкон'];

/* цена по цвету (единый источник — TIERS) */
const PRICE_BY_COLOR = new Map(TIERS.map((t) => [t.color.toUpperCase(), t.price]));

const norm = (c) => (c || '').toUpperCase();

export function buildSeats(svgRoot) {
    if (!svgRoot) return [];

    // только rect-места с заливкой (обводочные дубли занятых мест отсеиваются)
    const rects = [...svgRoot.querySelectorAll('rect[width="8"][height="8"]')]
        .filter((r) => r.getAttribute('fill'));

    // разбить ряды (уникальные Y) на секции по крупному вертикальному разрыву
    const ys = [...new Set(rects.map((r) => +r.getAttribute('y')))].sort((a, b) => a - b);
    const sectionOfY = new Map();
    let sec = 0;
    ys.forEach((y, i) => {
        if (i > 0 && y - ys[i - 1] >= SECTION_GAP) sec++;
        sectionOfY.set(y, sec);
    });

    // номер ряда внутри секции: меньший Y (ближе к сцене) = ряд 1
    const rowsBySection = {};                       // sec → отсортированные Y
    ys.forEach((y) => {
        const s = sectionOfY.get(y);
        (rowsBySection[s] ||= []).push(y);
    });
    const rowNumberOfY = new Map();
    Object.values(rowsBySection).forEach((list) => {
        list.sort((a, b) => a - b).forEach((y, i) => rowNumberOfY.set(y, i + 1));
    });

    // сгруппировать по Y, внутри ряда пронумеровать места слева направо (по X)
    const byY = new Map();
    rects.forEach((r) => {
        const y = +r.getAttribute('y');
        (byY.get(y) || byY.set(y, []).get(y)).push(r);
    });

    const seats = [];
    byY.forEach((list, y) => {
        list.sort((a, b) => +a.getAttribute('x') - +b.getAttribute('x'));
        const section = SECTIONS[sectionOfY.get(y)] || `Секция ${sectionOfY.get(y) + 1}`;
        const row = rowNumberOfY.get(y);
        list.forEach((r, i) => {
            const seatNo = i + 1;
            const color = norm(r.getAttribute('fill'));
            const occupied = color === OCCUPIED;
            const price = occupied ? null : (PRICE_BY_COLOR.get(color) ?? null);
            const status = occupied ? 'occupied' : (price != null ? 'available' : 'unknown');

            // привязать данные к месту схемы (в DOM)
            r.setAttribute('data-section', section);
            r.setAttribute('data-row', row);
            r.setAttribute('data-seat', seatNo);
            r.setAttribute('data-status', status);
            if (price != null) {
                r.setAttribute('data-price', price);
                r.setAttribute('data-tier', color);
            }

            seats.push({ el: r, section, row, seat: seatNo, price, tier: price != null ? color : null, status });
        });
    });

    return seats;
}

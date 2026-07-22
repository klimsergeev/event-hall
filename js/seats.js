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

            seats.push({ el: r, section, row, seat: seatNo, price, tier: price != null ? color : null, status, selected: false });
        });
    });

    return seats;
}

/* ============================================================
   Selected-вид места (Figma-нода 4902-80205 / layout/hall-place.svg).
   Выбранное место = оранжевый #FF5005 + белая галочка, ПЕРЕКРЫВАЕТ цвет тира.
   Оригинальный rect места (8×8) не трогаем — рисуем поверх отдельный слой
   <g class="sel-layer"> в конце <svg> (document order = сверху всех мест).
   Разметка галочки взята дословно из hall-place.svg для 8px-варианта с
   базовой точкой (88,16); для места (x,y) сдвигаем группу на (x-88, y-16). */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SEL_COLOR = '#FF5005';
const CHECK_D = 'M94.5543 18.1123C94.7008 18.2587 94.7008 18.4962 94.5543 18.6426L91.5983 21.5986C91.528 21.6689 91.4326 21.7085 91.3332 21.7085C91.2337 21.7085 91.1383 21.6689 91.068 21.5986L89.4013 19.932C89.2549 19.7855 89.2549 19.5481 89.4013 19.4016C89.5478 19.2552 89.7852 19.2552 89.9317 19.4016L91.3332 20.8031L94.024 18.1123C94.1704 17.9658 94.4079 17.9658 94.5543 18.1123Z';

function selectedGroup(x, y) {
    return `<g transform="translate(${x - 88} ${y - 16})">`
        + `<rect x="88" y="16" width="8" height="8" rx="2.5" fill="${SEL_COLOR}"/>`
        + `<rect x="88" y="16" width="8" height="8" rx="2.5" stroke="${SEL_COLOR}" stroke-width="3"/>`
        + `<path fill-rule="evenodd" clip-rule="evenodd" d="${CHECK_D}" fill="white"/>`
        + `</g>`;
}

/* Создать слой выбора и вернуть функцию его перерисовки под список мест. */
export function createSelectionLayer(svgRoot) {
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'sel-layer');
    svgRoot.appendChild(layer);
    return function render(seats) {
        layer.innerHTML = seats
            .filter((s) => s.selected)
            .map((s) => selectedGroup(+s.el.getAttribute('x'), +s.el.getAttribute('y')))
            .join('');
    };
}

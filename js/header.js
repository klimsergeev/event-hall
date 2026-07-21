/* ============================================================
   Шапка: бегущая строка (Web Animations API) + автоцентр чипа.
   Порт логики из handoff/header.jsx (CompactTitle, ChipBar).
   Тайминги/keyframes/пороги — как в референсе (выверены).
   ============================================================ */

/* --- Бегущая строка заголовка (компакт) --- */
export class CompactTitle {
    /* els: { inner, wrap, fadeL, fadeR } */
    constructor(els) {
        this.els = els;
        this.anims = [];
    }

    /* active — активна ли marquee (compact && shrinkTitle && marquee) */
    update(active) {
        const { inner, wrap, fadeL, fadeR } = this.els;

        // снять текущие анимации
        this.anims.forEach((a) => a.cancel());
        this.anims = [];
        if (inner) inner.style.transform = 'translateX(0)';
        if (fadeL) fadeL.style.opacity = '0';
        if (fadeR) fadeR.style.opacity = '0';
        if (!active || !inner || !wrap) return;

        // переполнение относительно фиксированного окна
        const overflow = inner.scrollWidth - wrap.clientWidth;
        if (overflow <= 1) return; // помещается — не двигаем

        const PAUSE = 2000;        // пауза в начале и конце
        const SPEED = 31;          // px/сек
        const scroll = (overflow / SPEED) * 1000;
        const total = PAUSE + scroll + PAUSE;
        const k1 = PAUSE / total;                // конец стартовой паузы
        const k2 = (PAUSE + scroll) / total;     // конец проезда
        const ramp = Math.min(0.05, (k2 - k1) / 4);
        const opts = { duration: total, iterations: Infinity, easing: 'linear' };

        const animInner = inner.animate([
            { transform: 'translateX(0)', offset: 0 },
            { transform: 'translateX(0)', offset: k1 },
            { transform: `translateX(${-overflow}px)`, offset: k2 },
            { transform: `translateX(${-overflow}px)`, offset: 1 },
        ], opts);

        const animL = fadeL && fadeL.animate([
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: k1 },
            { opacity: 1, offset: Math.min(k2, k1 + ramp) },
            { opacity: 1, offset: 1 },
        ], opts);

        const animR = fadeR && fadeR.animate([
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: Math.max(k1, k2 - ramp) },
            { opacity: 0, offset: k2 },
            { opacity: 0, offset: 1 },
        ], opts);

        this.anims = [animInner, animL, animR].filter(Boolean);
    }
}

/* --- Автоцентрирование активного чипа --- */
/* Двойной rAF: ждём, пока лейаут устаканится, затем меряем offsetLeft. */
export function centerActiveChip(scroller, activeEl) {
    if (!scroller || !activeEl) return;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const scRect = scroller.getBoundingClientRect();
            const elRect = activeEl.getBoundingClientRect();
            const margin = 16;
            if (elRect.left >= scRect.left + margin && elRect.right <= scRect.right - margin) return;
            const target = activeEl.offsetLeft - scroller.clientWidth / 2 + activeEl.offsetWidth / 2;
            scroller.scrollTo({ left: Math.max(0, target), behavior: 'auto' });
        });
    });
}

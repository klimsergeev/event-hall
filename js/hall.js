/* ============================================================
   Схема зала: пан/зум вьюпорт.
   Зум/пан применяются через АТРИБУТ viewBox инлайн-SVG (вектор
   перерисовывается растеризатором на каждом уровне — без текстурного
   мыла), а НЕ через CSS transform: scale() на промоутнутом слое.

   МОДЕЛЬ COVER: схема — слой на ВЕСЬ вьюпорт (полная ширина И высота,
   край в край). Верхний блок (шапка) и нижний (билеты+CTA) — оверлеи
   на слоях выше по z-index, схема уходит ПОД них и заполняет экран.

   scale измеряется в долях cover-фита (scale=1 → cover). Нижний предел зума —
   это ЗАГРУЗОЧНЫЙ (полный) вид: весь зал в кадре по МЕНЬШЕЙ стороне (contain),
   что в единицах scale = contain/cover ≤ 1 (см. _fitScale). Отзумив до упора,
   пользователь возвращается ровно к загрузочному виду. Зум до MAX_SCALE
   (5× cover-фита), свободный 2D-пан.

   Состояние (scale, tx, ty): tx/ty — пан в экранных px (положительный tx —
   схема вправо, положительный ty — вниз). Пороги компактификации и
   обработчики жестов те же, что в прежней версии. viewBox выводится из
   состояния. ppu (px на SVG-юнит) = cover(vp) * scale.
   ============================================================ */

const MAX_SCALE = 5;

/* Порог «тап vs drag»: если указатель за жест сместился меньше TAP_DIST px
   (и уложился в TAP_TIME), это тап — выбор места, а не пан. */
const TAP_DIST = 6;
const TAP_TIME = 500;

/* Базовый viewBox схемы (из assets/hall.svg): 0 0 536 442 */
const BASE_W = 536;
const BASE_H = 442;

/* Небольшой отступ клэмпа пана (экранные px): до крайних мест можно
   доехать с этим зазором, но без гигантского пустого поля. */
const PAD = 24;

export class HallViewport {
    /* opts: { compactionMode, onInteractStart, onInteractEnd,
              topInset, bottomInset, onTap } — insets в экранных px (число|fn):
       высоты оверлеев (шапка/нижний блок). На них расширяется пан-слэк,
       чтобы крайние места можно было вывести из-под оверлея.
       onTap(clientX, clientY) — вызывается на «тапе» (pointerdown→up без drag),
       чтобы верхний слой сделал hit-test места и выбрал/снял его. */
    constructor(viewport, content, opts = {}) {
        this.vp = viewport;
        this.content = content;
        this.opts = Object.assign({ compactionMode: 'any' }, opts);

        this.scale = 1;   // зум-фактор относительно cover-фита (инициализируется fit'ом ниже)
        this.tx = 0;      // пан по X в экранных px
        this.ty = 0;      // пан по Y в экранных px
        this.notified = false;

        this.drag = { active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0, pid: null };
        this.pinch = { active: false, baseDist: 0, baseScale: 1 };
        this.touchPan = { active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0 };
        this._tap = null;   // { x, y, t } — старт последнего жеста (для tap-детекции)
        this._raf = null;

        this._bind();
        // старт в загрузочном (полном) виде — это же нижний предел зума
        this.scale = this._fitScale();
        // ...опущенный на оффсет покоя (баланс леттербокса под развёрнутой шапкой)
        this.ty = this._restY();
    }

    /* Вертикальный оффсет ПОКОЯ (экранные px): в состоянии загрузки/покоя
       вписанная схема опускается на restOffsetY, чтобы вертикальный леттербокс
       распределился симметрично (шапка сверху перекрывает верхний зазор, иначе
       весь пустой воздух сваливается вниз). Значение (обычно половина высоты
       развёрнутой шапки) задаётся снаружи и клампится в пан-границы текущего
       зума. При непустой корзине оффсет = 0 → композиция как прежде. */
    _restY() {
        return this._clampPan(0, this._inset('restOffsetY'), this.scale)[1];
    }

    _svg() { return this.content.querySelector('svg'); }

    /* Нижний предел зума = ЗАГРУЗОЧНЫЙ вид (весь зал в кадре, contain).
       scale измеряется в долях cover-фита (scale=1 → cover). Полный вид =
       contain-фит, что в этих единицах = contain/cover ≤ 1. Это и есть min. */
    _fitScale() {
        const VW = this.vp.clientWidth;
        const VH = this.vp.clientHeight;
        const cover = Math.max(VW / BASE_W, VH / BASE_H) || 1;
        const contain = Math.min(VW / BASE_W, VH / BASE_H) || 1;
        return contain / cover;
    }

    _bind() {
        const vp = this.vp;
        vp.addEventListener('pointerdown', this._onPointerDown);
        vp.addEventListener('pointermove', this._onPointerMove);
        vp.addEventListener('pointerup', this._onPointerUp);
        vp.addEventListener('pointercancel', this._onPointerUp);
        vp.addEventListener('wheel', this._onWheel, { passive: false });
        vp.addEventListener('touchstart', this._onTouchStart, { passive: false });
        vp.addEventListener('touchmove', this._onTouchMove, { passive: false });
        vp.addEventListener('touchend', this._onTouchEnd);
        vp.addEventListener('dblclick', () => this.reset());
    }

    _inset(key) {
        const v = this.opts[key];
        const n = typeof v === 'function' ? v() : v;
        return n || 0;
    }

    /* Размеры вьюпорта (px) и cover-фактор: px на SVG-юнит при scale=1.
       cover = max(VW/BASE_W, VH/BASE_H) → по большей стороне зал заполняет
       вьюпорт, по меньшей выходит за края (кропится, панорамируется). */
    _dims() {
        const VW = this.vp.clientWidth;
        const VH = this.vp.clientHeight;
        const cover = Math.max(VW / BASE_W, VH / BASE_H) || 1;
        return { VW, VH, cover };
    }

    /* Клэмп пана: контент можно двигать так, чтобы любой его край доехал до
       края вьюпорта + PAD; сверх того — слэк на высоту оверлеев (insetTop/
       insetBottom), чтобы верхние/нижние места вывести из-под шапки/блока. */
    _clampPan(nx, ny, s) {
        const { VW, VH, cover } = this._dims();
        const ppu = cover * s;
        const Tx = Math.max(0, (BASE_W * ppu - VW) / 2) + PAD;
        const Ty = Math.max(0, (BASE_H * ppu - VH) / 2) + PAD;
        const insetTop = this._inset('topInset');
        const insetBottom = this._inset('bottomInset');
        return [
            Math.max(-Tx, Math.min(Tx, nx)),
            Math.max(-(Ty + insetBottom), Math.min(Ty + insetTop, ny)),
        ];
    }

    /* Выставить состояние и отрисовать через viewBox (мгновенно) */
    _apply(s, nx, ny) {
        s = Math.max(this._fitScale(), Math.min(MAX_SCALE, s));
        const [cx, cy] = this._clampPan(nx, ny, s);
        this.scale = s;
        this.tx = cx;
        this.ty = cy;
        this._renderViewBox();
        this._checkCompact();
    }

    /* Вывести viewBox из (scale, tx, ty).
       ppu = cover*scale; окно viewBox = VW/ppu × VH/ppu (аспект = аспекту
       вьюпорта → SVG заполняет слой без леттербокса). Центр окна в
       SVG-юнитах = центр зала минус пан/ppu. */
    _renderViewBox() {
        const svg = this._svg();
        if (!svg) return;
        const { VW, VH, cover } = this._dims();
        if (VW <= 0 || VH <= 0) return;
        const ppu = cover * this.scale;
        const vw = VW / ppu;
        const vh = VH / ppu;
        const cx = BASE_W / 2 - this.tx / ppu;
        const cy = BASE_H / 2 - this.ty / ppu;
        svg.setAttribute('viewBox', `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`);
    }

    /* Пересчитать viewBox под текущее состояние (после resize). */
    refit() {
        this._apply(this.scale, this.tx, this.ty);
    }

    /* Плавный переход состояния (reset / кнопочный зум) — твин по rAF,
       т.к. CSS-transition к атрибуту viewBox не применяется. */
    _animateTo(s, nx, ny) {
        const [tsx, tsy] = this._clampPan(nx, ny, s);
        const fromS = this.scale, fromX = this.tx, fromY = this.ty;
        const toS = s, toX = tsx, toY = tsy;
        const dur = 260;
        const t0 = performance.now();
        cancelAnimationFrame(this._raf);
        const ease = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic
        const step = (now) => {
            const p = Math.min(1, (now - t0) / dur);
            const k = ease(p);
            this._apply(fromS + (toS - fromS) * k, fromX + (toX - fromX) * k, fromY + (toY - fromY) * k);
            if (p < 1) this._raf = requestAnimationFrame(step);
        };
        this._raf = requestAnimationFrame(step);
    }

    /* Пороги компактификации (эквивалентны прежним):
       зум-фактор = this.scale; порог зума > 1.001.
       пан-смещение this.tx/ty (экранные px); порог |·| > 0.5. */
    _shouldCompact() {
        const zoomed = this.scale > this._fitScale() * 1.001;
        // пан меряем ОТНОСИТЕЛЬНО оффсета покоя: оффсет сам по себе — не «пан»,
        // иначе загрузочное опускание схемы схлопывало бы шапку.
        const panned = Math.abs(this.tx) > 0.5 || Math.abs(this.ty - this._restY()) > 0.5;
        const mode = this.opts.compactionMode;
        if (mode === 'never') return false;
        if (mode === 'zoom-only') return zoomed;
        return zoomed || panned; // 'any'
    }

    _checkCompact() {
        const should = this._shouldCompact();
        if (should && !this.notified) {
            this.notified = true;
            this.opts.onInteractStart && this.opts.onInteractStart();
        } else if (!should && this.notified) {
            this.notified = false;
            this.opts.onInteractEnd && this.opts.onInteractEnd();
        }
    }

    reset() {
        this._animateTo(this._fitScale(), 0, this._restY());
    }

    zoomBy(delta) {
        cancelAnimationFrame(this._raf);
        const next = Math.max(this._fitScale(), Math.min(MAX_SCALE, this.scale + delta));
        this._animateTo(next, this.tx, this.ty);
    }

    /* Мгновенный зум (без твина) — для QA-проверок */
    zoomTo(s) {
        cancelAnimationFrame(this._raf);
        this._apply(Math.max(this._fitScale(), Math.min(MAX_SCALE, s)), this.tx, this.ty);
    }

    /* Мгновенный пан (с клампом) на текущем зуме — для QA-проверок */
    panTo(tx, ty) {
        cancelAnimationFrame(this._raf);
        this._apply(this.scale, tx, ty);
    }

    /* Экранные координаты (clientX/clientY) → координаты в SVG-юнитах.
       Через getScreenCTM инлайн-SVG (учитывает viewBox и позицию слоя),
       поэтому работает при любом зуме/пане. null — если SVG ещё не в DOM. */
    clientToSvg(clientX, clientY) {
        const svg = this._svg();
        if (!svg || !svg.getScreenCTM) return null;
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const p = pt.matrixTransform(ctm.inverse());
        return { x: p.x, y: p.y };
    }

    /* Центрировать вьюпорт на точке (px,py) в SVG-юнитах и приблизить к scale
       (плавно, через тот же viewBox-твин). Пан выводится из условия «центр окна
       viewBox = (px,py)»: cx = BASE_W/2 - tx/ppu = px  →  tx = (BASE_W/2 - px)*ppu.
       Зум берём не меньше текущего (жест всегда приближает, не отдаляет). */
    focusOnSvgPoint(px, py, scale) {
        const { cover } = this._dims();
        const s = Math.max(this.scale, this._fitScale(), Math.min(MAX_SCALE, scale));
        const ppu = cover * s;
        const tx = (BASE_W / 2 - px) * ppu;
        const ty = (BASE_H / 2 - py) * ppu;
        this._animateTo(s, tx, ty);
    }

    /* ---- pointer (мышь): drag-пан ---- */
    _onPointerDown = (e) => {
        if (e.pointerType === 'touch') return; // тач — отдельно
        e.preventDefault();
        cancelAnimationFrame(this._raf);
        this._tap = { x: e.clientX, y: e.clientY, t: performance.now() };
        this.drag = { active: true, startX: e.clientX, startY: e.clientY, baseTx: this.tx, baseTy: this.ty, pid: e.pointerId };
        try { this.vp.setPointerCapture(e.pointerId); } catch {}
        this.vp.classList.add('grabbing');
    };
    _onPointerMove = (e) => {
        if (!this.drag.active || e.pointerType === 'touch') return;
        const dx = e.clientX - this.drag.startX;
        const dy = e.clientY - this.drag.startY;
        this._apply(this.scale, this.drag.baseTx + dx, this.drag.baseTy + dy);
    };
    _onPointerUp = (e) => {
        this.drag.active = false;
        this.vp.classList.remove('grabbing');
        try { this.vp.releasePointerCapture(e.pointerId); } catch {}
        this._maybeTap(e.clientX, e.clientY);
    };

    /* Если жест не превратился в пан (смещение < TAP_DIST, время < TAP_TIME) —
       это тап: отдать координаты наверх для hit-test/выбора места. */
    _maybeTap(clientX, clientY) {
        const d = this._tap;
        this._tap = null;
        if (!d) return;
        const moved = Math.hypot(clientX - d.x, clientY - d.y);
        if (moved <= TAP_DIST && performance.now() - d.t <= TAP_TIME) {
            this.opts.onTap && this.opts.onTap(clientX, clientY);
        }
    }

    /* ---- wheel: зум ---- */
    _onWheel = (e) => {
        e.preventDefault();
        cancelAnimationFrame(this._raf);
        const delta = -e.deltaY * 0.003;
        const next = Math.max(this._fitScale(), Math.min(MAX_SCALE, this.scale + delta));
        this._apply(next, this.tx, this.ty);
    };

    /* ---- touch: pinch-зум + 1-палец пан ---- */
    _onTouchStart = (e) => {
        cancelAnimationFrame(this._raf);
        if (e.touches.length === 2) {
            const [a, b] = e.touches;
            this.pinch = {
                active: true,
                baseDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                baseScale: this.scale,
            };
            this.touchPan.active = false;
        } else if (e.touches.length === 1) {
            const t = e.touches[0];
            this._tap = { x: t.clientX, y: t.clientY, t: performance.now() };
            this.touchPan = { active: true, startX: t.clientX, startY: t.clientY, baseTx: this.tx, baseTy: this.ty };
            this.pinch.active = false;
            this.vp.classList.add('grabbing');
        }
    };
    _onTouchMove = (e) => {
        if (this.pinch.active && e.touches.length === 2) {
            e.preventDefault();
            const [a, b] = e.touches;
            const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            const ratio = d / (this.pinch.baseDist || 1);
            const next = Math.max(this._fitScale(), Math.min(MAX_SCALE, this.pinch.baseScale * ratio));
            this._apply(next, this.tx, this.ty);
        } else if (this.touchPan.active && e.touches.length === 1) {
            e.preventDefault();
            const t = e.touches[0];
            const dx = t.clientX - this.touchPan.startX;
            const dy = t.clientY - this.touchPan.startY;
            this._apply(this.scale, this.touchPan.baseTx + dx, this.touchPan.baseTy + dy);
        }
    };
    _onTouchEnd = (e) => {
        // тап одним пальцем (без pinch): взять координаты отпущенного касания
        if (!this.pinch.active && e && e.changedTouches && e.changedTouches.length) {
            const t = e.changedTouches[0];
            this._maybeTap(t.clientX, t.clientY);
        } else {
            this._tap = null;
        }
        this.pinch.active = false;
        this.touchPan.active = false;
        this.vp.classList.remove('grabbing');
    };
}

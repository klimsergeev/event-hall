/* ============================================================
   Схема зала: пан/зум вьюпорт.
   Зум/пан применяются через АТРИБУТ viewBox инлайн-SVG (вектор
   перерисовывается растеризатором на каждом уровне — без текстурного
   мыла), а НЕ через CSS transform: scale() на промоутнутом слое.

   Внутреннее состояние сохранено как (scale, tx, ty) — те же семантики,
   что и в прежней transform-версии, поэтому пороги компактификации и
   обработчики жестов идентичны прежним. viewBox выводится из состояния.
   Порт логики из handoff/prototype-full.jsx (SeatViewport).
   ============================================================ */

const MIN_SCALE = 1;
const MAX_SCALE = 3.2;

/* Базовый viewBox схемы (из assets/hall.svg): 0 0 536 442 */
const BASE_W = 536;
const BASE_H = 442;

export class HallViewport {
    /* opts: { compactionMode, onInteractStart, onInteractEnd } */
    constructor(viewport, content, opts = {}) {
        this.vp = viewport;
        this.content = content;
        this.opts = Object.assign({ compactionMode: 'any' }, opts);

        this.scale = 1;   // зум-фактор = BASE_W / viewBox.width
        this.tx = 0;      // пан по X в экранных px
        this.ty = 0;      // пан по Y в экранных px
        this.notified = false;

        this.drag = { active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0, pid: null };
        this.pinch = { active: false, baseDist: 0, baseScale: 1 };
        this.touchPan = { active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0 };
        this._raf = null;

        this._bind();
    }

    _svg() { return this.content.querySelector('svg'); }

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

    _clampPan(nx, ny, s) {
        const vpw = this.vp.clientWidth;
        const vph = this.vp.clientHeight;
        // Реальный отрисованный размер схемы (CSS-box в cover-режиме — обычно
        // шире вьюпорта). Эффективный размер на экране при зуме = RW·s × RH·s.
        const rect = this.content.getBoundingClientRect();
        const RW = rect.width || vpw;
        const RH = rect.height || vph;
        const M = 40; // допуск, чтобы крайнее место входило в кадр с отступом
        // Предел пана: дальний край схемы доходит до края вьюпорта (+M),
        // без гигантского пустого поля за краем.
        const maxX = Math.max(0, (RW * s - vpw) / 2 + M);
        const maxY = Math.max(0, (RH * s - vph) / 2 + M);
        return [Math.max(-maxX, Math.min(maxX, nx)), Math.max(-maxY, Math.min(maxY, ny))];
    }

    /* Выставить состояние и отрисовать через viewBox (мгновенно) */
    _apply(s, nx, ny) {
        const [cx, cy] = this._clampPan(nx, ny, s);
        this.scale = s;
        this.tx = cx;
        this.ty = cy;
        this._renderViewBox();
        this._checkCompact();
    }

    /* Вывести viewBox из (scale, tx, ty).
       vw = BASE_W/s, vh = BASE_H/s;
       vx = BASE_W/2·(s-1)/s − (BASE_W/(s·RW))·tx  (RW,RH — рендер-размер SVG в px)
       vy = BASE_H/2·(s-1)/s − (BASE_H/(s·RH))·ty
       При s=1, tx=ty=0 → "0 0 536 442" (покой). Вывод эквивалентен
       прежнему transform: translate(tx,ty) scale(s) c origin=center. */
    _renderViewBox() {
        const svg = this._svg();
        if (!svg) return;
        const rect = this.content.getBoundingClientRect();
        const RW = rect.width;
        const RH = rect.height;
        if (RW <= 0 || RH <= 0) return;

        const s = this.scale;
        const vw = BASE_W / s;
        const vh = BASE_H / s;
        const vx = (BASE_W / 2) * (s - 1) / s - (BASE_W / (s * RW)) * this.tx;
        const vy = (BASE_H / 2) * (s - 1) / s - (BASE_H / (s * RH)) * this.ty;
        svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
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
       зум-фактор = BASE_W / viewBox.width = this.scale;  порог зума > 1.001.
       пан-смещение viewBox ↔ this.tx/ty (экранные px); порог |·| > 0.5. */
    _shouldCompact() {
        const zoomed = this.scale > 1.001;
        const panned = Math.abs(this.tx) > 0.5 || Math.abs(this.ty) > 0.5;
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
        this._animateTo(1, 0, 0);
    }

    zoomBy(delta) {
        cancelAnimationFrame(this._raf);
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale + delta));
        this._animateTo(next, this.tx, this.ty);
    }

    /* Мгновенный зум (без твина) — для QA-проверок */
    zoomTo(s) {
        cancelAnimationFrame(this._raf);
        this._apply(Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)), this.tx, this.ty);
    }

    /* Мгновенный пан (с клампом) на текущем зуме — для QA-проверок */
    panTo(tx, ty) {
        cancelAnimationFrame(this._raf);
        this._apply(this.scale, tx, ty);
    }

    /* ---- pointer (мышь): drag-пан ---- */
    _onPointerDown = (e) => {
        if (e.pointerType === 'touch') return; // тач — отдельно
        e.preventDefault();
        cancelAnimationFrame(this._raf);
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
    };

    /* ---- wheel: зум ---- */
    _onWheel = (e) => {
        e.preventDefault();
        cancelAnimationFrame(this._raf);
        const delta = -e.deltaY * 0.003;
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale + delta));
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
            const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.pinch.baseScale * ratio));
            this._apply(next, this.tx, this.ty);
        } else if (this.touchPan.active && e.touches.length === 1) {
            e.preventDefault();
            const t = e.touches[0];
            const dx = t.clientX - this.touchPan.startX;
            const dy = t.clientY - this.touchPan.startY;
            this._apply(this.scale, this.touchPan.baseTx + dx, this.touchPan.baseTy + dy);
        }
    };
    _onTouchEnd = () => {
        this.pinch.active = false;
        this.touchPan.active = false;
        this.vp.classList.remove('grabbing');
    };
}

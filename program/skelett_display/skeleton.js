// skeleton.js — frame interpolation, video overlay, and black-area figure

import { state } from './state.js';
import { getLayout } from './layout.js';

export const CONNECTIONS = [
    ["nose", "left_ear"], ["nose", "right_ear"],
    ["left_shoulder", "right_shoulder"],
    ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"], ["left_wrist", "left_index"],
    ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"], ["right_wrist", "right_index"],
    ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"], ["left_hip", "right_hip"],
    ["left_hip", "left_knee"], ["left_knee", "left_ankle"], ["left_ankle", "left_heel"], ["left_ankle", "left_foot_index"],
    ["right_hip", "right_knee"], ["right_knee", "right_ankle"], ["right_ankle", "right_heel"], ["right_ankle", "right_foot_index"],
];

const FAST_KPS = new Set([
    "left_wrist", "right_wrist", "left_index", "right_index",
    "left_ankle", "right_ankle", "left_foot_index", "right_foot_index",
    "left_heel", "right_heel",
]);

// ── Frame interpolation ───────────────────────────────────────

export function getFrame(t) {
    const frames = state.frames;
    if (!frames.length) return null;

    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].time_s < t) lo = mid + 1; else hi = mid;
    }

    const i1 = Math.min(lo, frames.length - 1);
    const i0 = Math.max(i1 - 1, 0);
    const f0 = frames[i0], f1 = frames[i1];

    const baseAlpha = (f1.time_s === f0.time_s)
        ? 0
        : Math.max(0, Math.min(1, (t - f0.time_s) / (f1.time_s - f0.time_s)));

    function lerpKps(kps0, kps1, alpha) {
        const kps = {};
        for (const key of Object.keys(kps0)) {
            const k0 = kps0[key], k1 = kps1?.[key];
            if (!k0) continue;
            if (!k1) { kps[key] = k0; continue; }
            const d          = Math.hypot(k1.px - k0.px, k1.py - k0.py);
            const speedBoost = FAST_KPS.has(key) ? 1.6 : 1.0;
            const distBoost  = Math.min(2.0, 1.0 + d / 80);
            const a          = Math.min(1, alpha * speedBoost * distBoost);
            kps[key] = {
                px: k0.px + (k1.px - k0.px) * a,
                py: k0.py + (k1.py - k0.py) * a,
                v:  k0.v  + (k1.v  - k0.v)  * a,
            };
        }
        return kps;
    }

    function findNearest(fromIdx, pi, direction, limit = 12) {
        const step = direction > 0 ? 1 : -1;
        for (let i = fromIdx + step; Math.abs(i - fromIdx) <= limit; i += step) {
            if (i < 0 || i >= frames.length) break;
            const p = (frames[i].persons || [])[pi];
            if (p) return { person: p, gap: Math.abs(i - fromIdx), idx: i };
        }
        return null;
    }

    function extrapolate(pi, anchorIdx, forward) {
        const anchor = (frames[anchorIdx]?.persons || [])[pi];
        if (!anchor) return null;
        const ref = findNearest(anchorIdx, pi, forward ? -1 : 1, 6);
        if (!ref) return anchor;
        const dt = anchorIdx - ref.idx;
        const kps = {};
        for (const key of Object.keys(anchor.kps)) {
            const ka = anchor.kps[key], kr = ref.person.kps[key];
            if (!ka || !kr) { kps[key] = ka; continue; }
            const vx = Math.max(-40, Math.min(40, (ka.px - kr.px) / Math.abs(dt)));
            const vy = Math.max(-40, Math.min(40, (ka.py - kr.py) / Math.abs(dt)));
            const stepFrames = forward
                ? (t - frames[anchorIdx].time_s) * (state.fps || 30)
                : (frames[anchorIdx].time_s - t) * (state.fps || 30);
            const decay = Math.max(0, 1 - stepFrames / 10);
            kps[key] = {
                px: ka.px + vx * stepFrames * (forward ? 1 : -1),
                py: ka.py + vy * stepFrames * (forward ? 1 : -1),
                v:  (ka.v ?? 1) * decay,
            };
        }
        return { ...anchor, kps, _ghost: true };
    }

    const maxP    = Math.max((f0.persons || []).length, (f1.persons || []).length);
    const persons = [];

    for (let pi = 0; pi < maxP; pi++) {
        const p0 = (f0.persons || [])[pi];
        const p1 = (f1.persons || [])[pi];

        if (p0 && p1) {
            persons.push({ ...p0, kps: lerpKps(p0.kps, p1.kps, baseAlpha) });
        } else if (p0 && !p1) {
            const next = findNearest(i1, pi, 1, 12);
            if (next && next.gap <= 6) {
                persons.push({ ...p0, kps: lerpKps(p0.kps, next.person.kps, baseAlpha / next.gap) });
            } else {
                const ghost = extrapolate(pi, i0, true);
                if (ghost) persons.push(ghost);
            }
        } else if (!p0 && p1) {
            const prev = findNearest(i0, pi, -1, 12);
            if (prev && prev.gap <= 6) {
                persons.push({ ...p1, kps: lerpKps(prev.person.kps, p1.kps, baseAlpha + (1 - baseAlpha) / prev.gap) });
            } else {
                const ghost = extrapolate(pi, i1, false);
                if (ghost) persons.push(ghost);
            }
        }
    }

    return { ...f0, time_s: t, persons };
}

// ── Shared person drawing primitive ──────────────────────────
// Draws one person's kps using a transform already set on ctx.
function drawPerson(ctx, kps, { ghost = false, lineWidth = 3, dotRadius = 4, strokeColor = '#0df', hipMarker = false, vw = 0, vh = 0 } = {}) {
    const baseAlpha = ghost ? 0.35 : 1.0;

    ctx.lineWidth = lineWidth;
    ctx.lineCap   = 'round';

    CONNECTIONS.forEach(([a, b]) => {
        const pa = kps[a], pb = kps[b];
        if (!pa || !pb) return;
        const vis = Math.min(pa.v ?? 1, pb.v ?? 1);
        ctx.globalAlpha  = baseAlpha * (vis > 0.5 ? 0.9 : 0.15);
        ctx.strokeStyle  = ghost ? '#777' : strokeColor;
        ctx.beginPath();
        ctx.moveTo(pa.px, pa.py);
        ctx.lineTo(pb.px, pb.py);
        ctx.stroke();
    });

    Object.values(kps).forEach(p => {
        ctx.globalAlpha = baseAlpha * ((p.v ?? 1) > 0.5 ? 1 : 0.2);
        ctx.fillStyle   = '#fff';
        ctx.beginPath();
        ctx.arc(p.px, p.py, dotRadius, 0, Math.PI * 2);
        ctx.fill();
    });

    if (!ghost && hipMarker) {
        const lh = kps['left_hip'], rh = kps['right_hip'];
        if (lh && rh && (lh.v ?? 1) > 0.5 && (rh.v ?? 1) > 0.5) {
            const hx = (lh.px + rh.px) / 2;
            const hy = (lh.py + rh.py) / 2;
            const cs = 6;

            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = '#ff0';
            ctx.lineWidth   = 1;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.moveTo(hx, hy); ctx.lineTo(hx, vh);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#ff0';
            ctx.fillStyle   = 'rgba(255,220,0,0.18)';
            ctx.lineWidth   = 2;
            ctx.beginPath();
            ctx.arc(hx, hy, 14, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();

            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#ff0';
            ctx.lineWidth   = 1.5;
            ctx.beginPath();
            ctx.moveTo(hx - cs, hy); ctx.lineTo(hx + cs, hy);
            ctx.moveTo(hx, hy - cs); ctx.lineTo(hx, hy + cs);
            ctx.stroke();
        }
    }
}

// ── Video overlay ─────────────────────────────────────────────
export function drawFrame(ctx, video, t) {
    if (!state.showSkeleton || !video.videoWidth || !video.videoHeight) return;

    const { videoArea, vw, vh } = getLayout(video);
    const scale = Math.min(videoArea.w / vw, videoArea.h / vh);

    const frame = getFrame(t);
    if (!frame?.persons) return;

    ctx.save();
    ctx.translate(videoArea.x, videoArea.y);
    ctx.scale(scale, scale);

    frame.persons.forEach(person => {
        if (!person.kps) return;
        drawPerson(ctx, person.kps, {
            ghost:      person._ghost,
            lineWidth:  3,
            dotRadius:  4,
            hipMarker:  true,
            vw, vh,
        });
    });

    ctx.restore();
}

// ── Black-area stick figure ───────────────────────────────────
// Draws a clean, fitted stick figure in the skelArea.
export function drawSkeletonPanel(ctx, video, t) {
    if (!state.showSkeleton) return;

    const { skelArea, vw, vh } = getLayout(video);
    if (skelArea.w < 20 || skelArea.h < 20) return;

    const frame = getFrame(t);
    if (!frame?.persons?.length) return;

    const PAD = 12;
    const areaW = skelArea.w - PAD * 2;
    const areaH = skelArea.h - PAD * 2;

    // Per-person colours (cycle through a small palette)
    const COLORS = ['#0df', '#f80', '#0f8', '#f4f', '#ff0', '#4af'];

    frame.persons.forEach((person, pi) => {
        if (!person.kps) return;

        // Compute the bounding box of visible keypoints in video space
        const pts = Object.values(person.kps).filter(p => (p.v ?? 1) > 0.2);
        if (!pts.length) return;

        const xs = pts.map(p => p.px), ys = pts.map(p => p.py);
        const bx = Math.min(...xs), bx2 = Math.max(...xs);
        const by = Math.min(...ys), by2 = Math.max(...ys);
        const bw = bx2 - bx || 1, bh = by2 - by || 1;

        // Fit scale (uniform) so the figure fills the area
        // For multi-person, subdivide horizontally
        const cols       = frame.persons.length;
        const colW       = areaW / cols;
        const fitScale   = Math.min(colW / bw, areaH / bh) * 0.88;

        // Target centre for this person's column
        const targetCx   = skelArea.x + PAD + colW * pi + colW / 2;
        const targetCy   = skelArea.y + PAD + areaH / 2;

        // Source centre of the bounding box
        const srcCx = (bx + bx2) / 2;
        const srcCy = (by + by2) / 2;

        // Build a transformed copy of kps
        const mapped = {};
        for (const [name, kp] of Object.entries(person.kps)) {
            mapped[name] = {
                px: targetCx + (kp.px - srcCx) * fitScale,
                py: targetCy + (kp.py - srcCy) * fitScale,
                v:  kp.v,
            };
        }

        ctx.save();
        drawPerson(ctx, mapped, {
            ghost:      person._ghost,
            lineWidth:  Math.max(1.5, fitScale * 2.5),
            dotRadius:  Math.max(2,   fitScale * 3),
            strokeColor: person._ghost ? '#555' : COLORS[pi % COLORS.length],
            hipMarker:  false,
        });
        ctx.restore();
    });

    ctx.globalAlpha = 1;
}
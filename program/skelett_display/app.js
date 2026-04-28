// app.js — Motion Viewer

const state = {
    showSkeleton: true,
    showBeats: true,
    beats: [],
    melodic: [],
    frames: [],
    duration: 0,
    lastBeatIdx: -1,
    raf: null,
    origin: null,
    bpm: 120,
    firstBeatTime: 0,
    nextBounceIdx: 0,
};

setInterval(() => fetch('/ping').catch(() => { }), 2000);

// DOM
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const tlCanvas = document.getElementById('tl');
const tlCtx = tlCanvas.getContext('2d');
const playhead = document.getElementById('playhead');
const timeEl = document.getElementById('time');
const beatList = document.getElementById('beat-list');

// ── MediaPipe 33-point connections ───────────────────────────
const CONNECTIONS = [
    ["nose", "left_ear"], ["nose", "right_ear"],
    ["left_shoulder", "right_shoulder"],
    ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"], ["left_wrist", "left_index"],
    ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"], ["right_wrist", "right_index"],
    ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"], ["left_hip", "right_hip"],
    ["left_hip", "left_knee"], ["left_knee", "left_ankle"], ["left_ankle", "left_heel"], ["left_ankle", "left_foot_index"],
    ["right_hip", "right_knee"], ["right_knee", "right_ankle"], ["right_ankle", "right_heel"], ["right_ankle", "right_foot_index"]
];

// ── Tab switching ─────────────────────────────────────────────
function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
        b.classList.toggle('active', ['beats', 'vars'][i] === name);
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
}

// ── Auto-load from URL params ─────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    const p = new URLSearchParams(location.search);
    const name = p.get('name');
    if (!name) { document.getElementById('info').textContent = 'No name param'; return; }

    const videoUrl = p.get('video') || `/data/raw_videos/${name}.mp4`;
    const beatsUrl = p.get('beats') || `/data/beats_out/${name}_beats.json`;
    const skeletonUrl = p.get('skeleton') || `/data/skelett_out/${name}_skelett.json`;

    document.getElementById('title').textContent = name;
    video.src = videoUrl;

    fetch(beatsUrl)
        .then(r => r.json())
        .then(loadBeats)
        .catch(e => console.warn('beats:', e));

    fetch(skeletonUrl)
        .then(r => r.json())
        .then(loadSkeleton)
        .catch(e => console.warn('skeleton:', e));

    loadVariables(name);
});

// ── Variables ─────────────────────────────────────────────────
function loadVariables(name) {
    fetch(`/api/variables/${encodeURIComponent(name)}`)
        .then(r => r.json())
        .then(data => renderVariables(data, name))
        .catch(e => {
            document.getElementById('var-panel').innerHTML =
                `<div id="var-error">Kunde inte ladda variabler:<br>${e}</div>`;
        });
}

function valClass(v, { invert = false, threshHigh = 0.7, threshMid = 0.4 } = {}) {
    if (v === null || v === undefined) return '';
    const n = invert ? (1 - v / 200) : v;
    if (n >= threshHigh) return 'good';
    if (n >= threshMid) return 'warn';
    return 'bad';
}

function bar(frac) {
    const pct = Math.min(100, Math.max(0, (frac ?? 0) * 100)).toFixed(1);
    return `<div class="var-bar-wrap"><div class="var-bar-bg"><div class="var-bar-fill" style="width:${pct}%"></div></div></div>`;
}

function section(title, rows) {
    const inner = rows.map(({ label, value, cls, showBar, barFrac }) => `
        <div class="var-row">
          <span class="var-name">${label}</span>
          <span class="var-value ${cls ?? ''}">${value ?? '–'}</span>
        </div>
        ${showBar ? bar(barFrac) : ''}
    `).join('');
    return `<div class="var-section"><div class="var-section-title">${title}</div>${inner}</div>`;
}

function renderVariables(data, name) {
    document.getElementById('debug-box').textContent = JSON.stringify(data, null, 2);

    const panel = document.getElementById('var-panel');
    const res = data[Object.keys(data).find(k => k !== 'summary')] ?? {};

    const orig = res.origin ?? {};
    if (orig.origin_px != null) state.origin = { px: orig.origin_px, py: orig.origin_py };

    if (res.error) {
        panel.innerHTML = `<div id="var-error">${res.error}</div>`;
        return;
    }

    const bt = res.beat_timing ?? {};
    const sc = res.spatial_coverage ?? {};
    const ah = res.arm_hip_sync ?? {};
    const vb = res.vertical_bounce ?? {};
    const sy = res.symmetry ?? {};

    const fmt = (v, decimals = 1) =>
        v !== null && v !== undefined ? Number(v).toFixed(decimals) : null;

    panel.innerHTML = [

        section('🥁 Beat Timing', [
            {
                label: 'Avg offset',
                value: bt.mean_offset_ms != null ? `${fmt(bt.mean_offset_ms)} ms` : null,
                showBar: bt.mean_offset_ms != null,
                barFrac: bt.mean_offset_ms != null ? Math.max(0, 1 - bt.mean_offset_ms / 300) : 0,
            },
            {
                label: 'Std offset',
                value: bt.std_offset_ms != null ? `${fmt(bt.std_offset_ms)} ms` : null,
            },
            {
                label: 'Hit rate (<80ms)',
                value: bt.hit_rate_pct != null ? `${fmt(bt.hit_rate_pct)} %` : null,
                showBar: bt.hit_rate_pct != null,
                barFrac: (bt.hit_rate_pct ?? 0) / 100,
            },
            { label: 'Fotsättningar', value: bt.n_landings },
        ]),

        section('📐 Yt-användning', [
            {
                label: 'Coverage',
                value: sc.coverage_pct != null ? `${fmt(sc.coverage_pct, 2)} %` : null,
                showBar: sc.coverage_pct != null,
                barFrac: Math.min(1, (sc.coverage_pct ?? 0) / 5),
            },
            { label: 'Total resa', value: sc.travel_px != null ? `${fmt(sc.travel_px, 0)} px` : null },
            { label: 'X-spann', value: sc.hip_x_range_px != null ? `${fmt(sc.hip_x_range_px, 0)} px` : null },
            { label: 'Y-spann', value: sc.hip_y_range_px != null ? `${fmt(sc.hip_y_range_px, 0)} px` : null },
        ]),

        section('🔗 Arm–Höft Synk', [
            {
                label: 'Pearson r',
                value: ah.pearson_r != null ? fmt(ah.pearson_r, 3) : null,
                showBar: ah.pearson_r != null,
                barFrac: ((ah.pearson_r ?? 0) + 1) / 2,
            },
        ]),

        section('↕️ Vertikal Bounce', [
            { label: 'Bounce BPM', value: vb.bounce_bpm != null ? fmt(vb.bounce_bpm) : null },
            { label: 'Musik BPM', value: vb.music_bpm != null ? fmt(vb.music_bpm) : null },
            {
                label: 'Match',
                value: vb.bpm_match_ratio != null ? fmt(vb.bpm_match_ratio, 3) : null,
                showBar: vb.bpm_match_ratio != null,
                barFrac: vb.bpm_match_ratio ?? 0,
            },
        ]),

        section('⚖️ Symmetri', [
            {
                label: 'Armar',
                value: sy.symmetry_arms != null ? fmt(sy.symmetry_arms, 3) : null,
                showBar: sy.symmetry_arms != null,
                barFrac: sy.symmetry_arms ?? 0,
            },
            {
                label: 'Ben',
                value: sy.symmetry_legs != null ? fmt(sy.symmetry_legs, 3) : null,
                showBar: sy.symmetry_legs != null,
                barFrac: sy.symmetry_legs ?? 0,
            },
        ]),

        orig.origin_px != null ? section('📍 Ursprung', [
            { label: 'Origin X', value: `${fmt(orig.origin_px, 1)} px` },
            { label: 'Origin Y', value: `${fmt(orig.origin_py, 1)} px` },
        ]) : '',

    ].join('');
}

// ── Beats + Ball setup (single definition) ───────────────────
function loadBeats(d) {
    state.beats = d.beats || [];
    state.melodic = d.melodic_changes || [];
    state.duration = d.duration_s || 0;
    state.bpm = d.bpm || 120;
    state.firstBeatTime = state.beats[0]?.time_s ?? 0;
    state.nextBounceIdx = 0;

    document.getElementById('info').innerHTML =
        `BPM: <b>${d.bpm}</b><br>` +
        `Beats: <b>${d.beat_count}</b><br>` +
        `Melodic Δ: <b>${state.melodic.length}</b><br>` +
        `Duration: <b>${d.duration_s}s</b>`;

    beatList.innerHTML = '';
    state.beats.forEach((b, i) => {
        const el = document.createElement('div');
        if (b.is_strong) el.classList.add('strong');
        el.dataset.idx = i;
        el.textContent = `${b.time_s.toFixed(3)}s  ${b.beat_in_bar}/4`;
        el.onclick = () => { video.currentTime = b.time_s; };
        beatList.appendChild(el);
    });

    const bpm = state.bpm;
    const height = 40;
    ballState.T = 60 / bpm;
    ballState.gravity = (8 * height) / (ballState.T * ballState.T);
    ballState.v0 = -(ballState.gravity * ballState.T) / 2;

    ballState.lastImpactTime = state.firstBeatTime;
    state.nextBounceIdx = 0;

    drawTimeline();
}

function loadSkeleton(d) {
    state.frames = d.frames || [];
}

// ── Skeleton drawing ──────────────────────────────────────────
function getFrame(t) {
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

    if (i0 === i1 || f1.time_s === f0.time_s) return f0;

    const alpha = 0.96;

    function lerpKps(kps0, kps1, a) {
        const kps = {};
        for (const key of Object.keys(kps0)) {
            const k0 = kps0[key], k1 = kps1?.[key];
            if (!k0 || !k1) { kps[key] = k0; continue; }
            kps[key] = {
                px: k0.px + (k1.px - k0.px) * a,
                py: k0.py + (k1.py - k0.py) * a,
                v: k0.v + (k1.v - k0.v) * a,
            };
        }
        return kps;
    }

    function findNext(fromIdx, pi, limit = 8) {
        for (let i = fromIdx + 1; i < Math.min(fromIdx + limit, frames.length); i++) {
            const p = (frames[i].persons || [])[pi];
            if (p) return { person: p, gap: i - fromIdx };
        }
        return null;
    }

    function findPrev(fromIdx, pi, limit = 8) {
        for (let i = fromIdx - 1; i >= Math.max(fromIdx - limit, 0); i--) {
            const p = (frames[i].persons || [])[pi];
            if (p) return { person: p, gap: fromIdx - i };
        }
        return null;
    }

    const maxP = Math.max((f0.persons || []).length, (f1.persons || []).length);
    const persons = [];

    for (let pi = 0; pi < maxP; pi++) {
        const p0 = (f0.persons || [])[pi];
        const p1 = (f1.persons || [])[pi];

        if (p0 && p1) {
            persons.push({ ...p0, kps: lerpKps(p0.kps, p1.kps, alpha) });
        } else if (p0 && !p1) {
            const next = findNext(i1, pi);
            if (next) {
                const a = next.gap === 1 ? alpha : 1 / 3;
                persons.push({ ...p0, kps: lerpKps(p0.kps, next.person.kps, a) });
            } else {
                persons.push(p0);
            }
        } else if (!p0 && p1) {
            const prev = findPrev(i0, pi);
            if (prev) {
                const a = prev.gap === 1 ? alpha : 2 / 3;
                persons.push({ ...p1, kps: lerpKps(prev.person.kps, p1.kps, a) });
            } else {
                persons.push(p1);
            }
        }
    }

    return { ...f0, time_s: t, persons };
}

// ── Shared redraw ─────────────────────────────────────────────
function redraw() {
    const viewerEl = document.getElementById('viewer');
    const vr = viewerEl.getBoundingClientRect();
    if (overlay.width !== vr.width || overlay.height !== vr.height) {
        overlay.width = vr.width;
        overlay.height = vr.height;
    } else {
        ctx.clearRect(0, 0, vr.width, vr.height);
    }
    drawBeatFlash();
    drawFrame(video.currentTime);
    updatePlayhead();
}

function drawFrame(t) {
    if (!state.showSkeleton || !video.videoWidth || !video.videoHeight) return;

    const viewerEl = document.getElementById('viewer');
    const viewerRect = viewerEl.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(videoRect.width / vw, videoRect.height / vh);
    const ox = (videoRect.left - viewerRect.left) + (videoRect.width - vw * scale) / 2;
    const oy = (videoRect.top - viewerRect.top) + (videoRect.height - vh * scale) / 2;

    const frame = getFrame(t);
    if (!frame || !frame.persons) return;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    frame.persons.forEach(person => {
        const kps = person.kps;
        if (!kps) return;

        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        CONNECTIONS.forEach(([a, b]) => {
            const pa = kps[a], pb = kps[b];
            if (!pa || !pb) return;
            const vis = Math.min(pa.v ?? 1, pb.v ?? 1);
            ctx.globalAlpha = vis > 0.5 ? 0.9 : 0.2;
            ctx.strokeStyle = '#0df';
            ctx.beginPath();
            ctx.moveTo(pa.px, pa.py);
            ctx.lineTo(pb.px, pb.py);
            ctx.stroke();
        });

        Object.values(kps).forEach(p => {
            ctx.globalAlpha = (p.v ?? 1) > 0.5 ? 1 : 0.3;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(p.px, p.py, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        const lh = kps['left_hip'], rh = kps['right_hip'];
        if (lh && rh && (lh.v ?? 1) > 0.5 && (rh.v ?? 1) > 0.5) {
            const hx = (lh.px + rh.px) / 2;
            const hy = (lh.py + rh.py) / 2;
            const cs = 6;

            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = '#ff0';
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.moveTo(hx, hy);
            ctx.lineTo(hx, vh);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#ff0';
            ctx.fillStyle = 'rgba(255,220,0,0.18)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(hx, hy, 14, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#ff0';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(hx - cs, hy); ctx.lineTo(hx + cs, hy);
            ctx.moveTo(hx, hy - cs); ctx.lineTo(hx, hy + cs);
            ctx.stroke();
        }
    });

    ctx.restore();
}

// ── Timeline ──────────────────────────────────────────────────
function drawTimeline() {
    const W = tlCanvas.clientWidth;
    const H = tlCanvas.clientHeight;
    tlCanvas.width = W; tlCanvas.height = H;
    const dur = state.duration || video.duration || 1;

    tlCtx.clearRect(0, 0, W, H);

    state.melodic.forEach(m => {
        const x = (m.time_s / dur) * W;
        tlCtx.strokeStyle = 'rgba(255,80,80,0.6)';
        tlCtx.lineWidth = 1;
        tlCtx.setLineDash([2, 4]);
        tlCtx.beginPath(); tlCtx.moveTo(x, 0); tlCtx.lineTo(x, H); tlCtx.stroke();
    });
    tlCtx.setLineDash([]);

    state.beats.forEach(b => {
        const x = (b.time_s / dur) * W;
        tlCtx.fillStyle = b.is_strong ? 'rgba(255,220,50,0.8)' : 'rgba(0,220,255,0.4)';
        const h = b.is_strong ? H * 0.7 : H * 0.35;
        tlCtx.fillRect(x, (H - h) / 2, 1.5, h);
    });
}

function updatePlayhead() {
    const dur = video.duration || 1;
    const pct = Math.min(video.currentTime / dur, 1);
    const W = tlCanvas.offsetWidth;
    playhead.style.left = Math.min(pct * W, W) + 'px';
    timeEl.textContent = `${video.currentTime.toFixed(2)} / ${(video.duration || 0).toFixed(2)}`;
}

document.getElementById('timeline').addEventListener('click', e => {
    if (!video.duration) return;
    const rect = tlCanvas.getBoundingClientRect();
    video.currentTime = ((e.clientX - rect.left) / rect.width) * video.duration;
});

// ── Ball state ────────────────────────────────────────────────
const ballState = {
    gravity: 0,
    v0: 0,
    T: 0,
    floorY: 100,
    posX: 50,
    lastImpactTime: 0,  // in video time (seconds)
    particles: [],
    wallLastFrame: 0,   // performance.now() of last RAF tick, for particle dt
};

function triggerFlash(beat) {
    // Anchor to the exact beat timestamp, not the observed video.currentTime.
    // This keeps the arc perfectly timed even if the RAF fired a few ms late.
    ballState.lastImpactTime = beat.time_s;
    ballState.particles = []; // clear stale particles from previous beat

    for (let i = 0; i < 6; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        ballState.particles.push({
            x: ballState.posX,
            y: ballState.floorY,
            vx: side * (Math.random() * 1.5 + 0.5),
            vy: -(Math.random() * 1.2 + 0.3),
            life: 1.0,
        });
    }
}

function drawBouncingBall() {
    // Ball position is pure video-time physics — no framerate dependency here.
    const elapsed = video.currentTime - ballState.lastImpactTime;
    const y = (ballState.v0 * elapsed) + (0.5 * ballState.gravity * elapsed * elapsed);
    const drawY = ballState.floorY + y;

    // Particles use wall-clock dt so they animate at a consistent speed
    // regardless of whether video.currentTime is advancing or not.
    const wall = performance.now() / 1000;
    const dt = ballState.wallLastFrame > 0
        ? Math.min(wall - ballState.wallLastFrame, 0.1) // clamp to avoid jumps after tab blur
        : 1 / 60;
    ballState.wallLastFrame = wall;

    for (let i = ballState.particles.length - 1; i >= 0; i--) {
        const p = ballState.particles[i];
        p.x  += p.vx * dt * 60;
        p.y  += p.vy * dt * 60;
        p.vy += 0.08 * dt * 60;
        p.life -= 0.06 * dt * 60;
        if (p.life <= 0) { ballState.particles.splice(i, 1); continue; }
        ctx.fillStyle = `rgba(255,255,255,${(p.life * 0.6).toFixed(2)})`;
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }

    ctx.save();
    ctx.fillStyle = '#708090';
    ctx.beginPath();
    ctx.arc(ballState.posX, drawY, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ballState.posX - 15, ballState.floorY + 11);
    ctx.lineTo(ballState.posX + 15, ballState.floorY + 11);
    ctx.stroke();
    ctx.restore();
}

// ── Beat detection ────────────────────────────────────────────
// Instead of a proximity window, find the index of the most recent beat
// that has passed and fire if it's new. This never misses or double-fires,
// and handles seeking in both directions cleanly.
function checkBounce(t) {
    if (!state.showBeats || !state.bpm || state.firstBeatTime == null) return;
    if (t < state.firstBeatTime) return;

    const period = 60 / state.bpm;
    const idx = Math.floor((t - state.firstBeatTime) / period);

    if (idx === state.nextBounceIdx) return;
    if (idx < 0) return;

    state.nextBounceIdx = idx;
    const bounceTime = state.firstBeatTime + idx * period;
    ballState.lastImpactTime = bounceTime;
    ballState.particles = [];

    for (let i = 0; i < 6; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        ballState.particles.push({
            x: ballState.posX,
            y: ballState.floorY,
            vx: side * (Math.random() * 1.5 + 0.5),
            vy: -(Math.random() * 1.2 + 0.3),
            life: 1.0,
        });
    }
}

// ── Render loop ───────────────────────────────────────────────
function loop() {
    const t = video.currentTime;

    const viewerEl = document.getElementById('viewer');
    const vr = viewerEl.getBoundingClientRect();
    if (overlay.width !== vr.width || overlay.height !== vr.height) {
        overlay.width = vr.width;
        overlay.height = vr.height;
    } else {
        ctx.clearRect(0, 0, vr.width, vr.height);
    }

    checkBounce(t);
    drawBouncingBall();
    drawFrame(t);
    updatePlayhead();

    if (!video.paused && !video.ended) {
        state.raf = requestAnimationFrame(loop);
    } else {
        state.raf = null;
    }
}

function startLoop() {
    if (!state.raf) state.raf = requestAnimationFrame(loop);
}

// ── Video events ──────────────────────────────────────────────
video.addEventListener('loadedmetadata', () => {
    if (!state.duration) state.duration = video.duration;
    drawTimeline();
    redraw();
});

video.addEventListener('seeking', () => {
    // Reset wall time so particles don't get a massive dt after a seek jump
    ballState.wallLastFrame = 0;
    redraw();
});

video.addEventListener('seeked', () => {
    ballState.wallLastFrame = 0;

    if (!state.bpm || state.firstBeatTime == null) {
        redraw();
        return;
    }

    const t = video.currentTime;
    const period = 60 / state.bpm;

    if (t < state.firstBeatTime) {
        state.nextBounceIdx = 0;
        ballState.lastImpactTime = state.firstBeatTime;
    } else {
        const idx = Math.floor((t - state.firstBeatTime) / period);
        state.nextBounceIdx = idx;
        ballState.lastImpactTime = state.firstBeatTime + idx * period;
    }

    redraw();
});

video.addEventListener('timeupdate', () => { if (video.paused) redraw(); });

// ── Controls ──────────────────────────────────────────────────
function togglePlay() { video.paused ? video.play() : video.pause(); startLoop(); }
function toggleSkeleton() { state.showSkeleton = !state.showSkeleton; }

window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowRight') video.currentTime += e.shiftKey ? 5 : 1 / 30;
    if (e.code === 'ArrowLeft')  video.currentTime -= e.shiftKey ? 5 : 1 / 30;
    if (e.key === 's') toggleSkeleton();
});

window.addEventListener('resize', drawTimeline);
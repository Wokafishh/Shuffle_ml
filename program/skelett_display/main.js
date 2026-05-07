// main.js — init, render loop, video events, controls

import { state } from './state.js';
import { drawFrame } from './skeleton.js';
import { ballState, initBall, checkBounce, syncBallToTime, drawBouncingBall, freezeBall, thawBall } from './ball.js';
import { drawTimeline, updatePlayhead, initTimelineClick } from './timeline.js';
import { loadVariables } from './variables.js';
import { exportData } from './export.js';

// ── DOM ───────────────────────────────────────────────────────
const video    = document.getElementById('video');
const overlay  = document.getElementById('overlay');
const ctx      = overlay.getContext('2d');
const beatList = document.getElementById('beat-list');

// ── Expose globals for inline handlers ────────────────────────
window.state      = state;
window.exportData = exportData;

// ── Keep-alive ────────────────────────────────────────────────
setInterval(() => fetch('/ping').catch(() => {}), 2000);

// ── Volume ────────────────────────────────────────────────────
const VOL_KEY = 'motionviewer_volume';

window.setVolume = function(v) {
    const vol = Number(v);
    video.volume = vol / 100;
    document.getElementById('vol-label').textContent = vol + '%';
    localStorage.setItem(VOL_KEY, vol);
};

function initVolume() {
    const saved = localStorage.getItem(VOL_KEY);
    const v     = saved !== null ? Number(saved) : 50;

    document.getElementById('vol-slider').value = v;
    document.getElementById('vol-label').textContent = v + '%';

    const apply = () => { video.volume = v / 100; };
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
}

// ── Tab switching ─────────────────────────────────────────────
window.switchTab = function(name) {
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
        b.classList.toggle('active', ['beats', 'vars'][i] === name);
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
};

// ── Data loading ──────────────────────────────────────────────
function loadBeats(d) {
    state.beats         = da.beats || [];
    state.melodic       = d.melodic_changes || [];
    state.duration      = d.duration_s || 0;
    state.bpm           = d.bpm || 120;
    state.drops         = d.drops || [];
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

    initBall(state.bpm, state.firstBeatTime);
    drawTimeline(video);
}

function loadSkeleton(d) {
    state.frames = d.frames || [];
    state.fps    = d.fps    || 30;
    drawTimeline(video);
}

// ── Render ────────────────────────────────────────────────────
function resizeOverlay() {
    const vr = document.getElementById('viewer').getBoundingClientRect();
    if (overlay.width !== vr.width || overlay.height !== vr.height) {
        overlay.width  = vr.width;
        overlay.height = vr.height;
    } else {
        ctx.clearRect(0, 0, vr.width, vr.height);
    }
}

function redraw() {
    resizeOverlay();
    drawFrame(ctx, video, video.currentTime);
    drawBouncingBall(ctx, video);
    updatePlayhead(video);
}

function loop() {
    resizeOverlay();
    checkBounce(video.currentTime);
    drawFrame(ctx, video, video.currentTime);
    drawBouncingBall(ctx, video);
    updatePlayhead(video);

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
    drawTimeline(video);
    redraw();
});

video.addEventListener('seeking', () => {
    ballState.wallLastFrame = 0;
    redraw();
});

video.addEventListener('seeked', () => {
    syncBallToTime(video.currentTime);
    redraw();
});

video.addEventListener('timeupdate', () => {
    if (video.paused) redraw();
});

video.addEventListener('pause', () => {
    freezeBall();
    cancelAnimationFrame(state.raf);
    state.raf = null;
    redraw();
});

video.addEventListener('play', () => {
    thawBall();
    startLoop();
});

// ── Controls ──────────────────────────────────────────────────
window.togglePlay = function() {
    video.paused ? video.play() : video.pause();
};

window.toggleSkeleton = function() {
    state.showSkeleton = !state.showSkeleton;
};

window.addEventListener('keydown', e => {
    if (e.code === 'Space')      { e.preventDefault(); window.togglePlay(); }
    if (e.code === 'ArrowRight') video.currentTime += e.shiftKey ? 5 : 1 / 30;
    if (e.code === 'ArrowLeft')  video.currentTime -= e.shiftKey ? 5 : 1 / 30;
    if (e.key  === 's')          window.toggleSkeleton();
});

window.addEventListener('resize', () => drawTimeline(video));

// ── Boot ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    initVolume();

    const p    = new URLSearchParams(location.search);
    const name = p.get('name');
    if (!name) { document.getElementById('info').textContent = 'No name param'; return; }

    const videoUrl    = p.get('video')    || `/data/raw_videos/${name}.mp4`;
    const beatsUrl    = p.get('beats')    || `/data/beats_out/${name}_beats.json`;
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
    initTimelineClick(video);
});
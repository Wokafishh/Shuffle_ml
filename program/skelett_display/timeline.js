// timeline.js — timeline canvas and playhead

import { state } from './state.js';

const tlCanvas = document.getElementById('tl');
const tlCtx = tlCanvas.getContext('2d');
const playhead = document.getElementById('playhead');
const timeEl = document.getElementById('time');

export function drawTimeline(video) {
    const W = tlCanvas.clientWidth;
    const H = tlCanvas.clientHeight;
    tlCanvas.width = W;
    tlCanvas.height = H;
    const dur = state.duration || video.duration || 1;

    tlCtx.clearRect(0, 0, W, H);

    // ── Skeleton coverage strip (top 5px) ─────────────────────
    tlCtx.fillStyle = '#1a1a1a';
    tlCtx.fillRect(0, 0, W, 5);
    state.frames.forEach(f => {
        const x = Math.round((f.time_s / dur) * W);
        tlCtx.fillStyle = (f.persons && f.persons.length > 0) ? '#50ff80' : '#ff5050';
        tlCtx.fillRect(x, 0, 2, 5);
    });

    // ── Melodic change markers ────────────────────────────────
    state.melodic.forEach(m => {
        const x = (m.time_s / dur) * W;
        tlCtx.strokeStyle = 'rgba(255,80,80,0.6)';
        tlCtx.lineWidth = 1;
        tlCtx.setLineDash([2, 4]);
        tlCtx.beginPath(); tlCtx.moveTo(x, 0); tlCtx.lineTo(x, H); tlCtx.stroke();
    });
    tlCtx.setLineDash([]);

    // ── Beat ticks ────────────────────────────────────────────
    state.beats.forEach(b => {
        const x = (b.time_s / dur) * W;
        tlCtx.fillStyle = b.is_strong ? 'rgba(255,220,50,0.8)' : 'rgba(0,220,255,0.4)';
        const h = b.is_strong ? H * 0.7 : H * 0.35;
        tlCtx.fillRect(x, (H - h) / 2, 1.5, h);
    });
    
    (state.drops || []).forEach(drop => {
    const x = (drop.time_s / dur) * W;

    // Bright vertical line full height
    tlCtx.strokeStyle = 'rgba(255, 60, 60, 0.9)';
    tlCtx.lineWidth = 2;
    tlCtx.setLineDash([]);
    tlCtx.beginPath();
    tlCtx.moveTo(x, 0);
    tlCtx.lineTo(x, H);
    tlCtx.stroke();

    // Label
    tlCtx.fillStyle = 'rgba(255, 60, 60, 0.9)';
    tlCtx.font = 'bold 9px monospace';
    tlCtx.fillText('DROP', x + 3, 9);
});
}

export function updatePlayhead(video) {
    const dur = video.duration || 1;
    const pct = Math.min(video.currentTime / dur, 1);
    const W = tlCanvas.offsetWidth;
    playhead.style.left = Math.min(pct * W, W) + 'px';
    timeEl.textContent = `${video.currentTime.toFixed(2)} / ${(video.duration || 0).toFixed(2)}`;
}

export function initTimelineClick(video) {
    document.getElementById('timeline').addEventListener('click', e => {
        if (!video.duration) return;
        const rect = tlCanvas.getBoundingClientRect();
        video.currentTime = ((e.clientX - rect.left) / rect.width) * video.duration;
    });
}
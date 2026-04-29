// ball.js — bouncing ball physics and rendering

import { state } from './state.js';
import { getLayout } from './layout.js';

export const ballState = {
    gravity: 0,
    v0: 0,
    T: 0,
    particles: [],
    wallLastFrame: 0,
    lastImpactTime: 0,
    _triggerParticles: false,
};

export function initBall(bpm, firstBeatTime) {
    ballState.T = 60 / bpm;
    // Normalized gravity for a snappier, cleaner bounce
    ballState.gravity = 8 * 0.7 / (ballState.T * ballState.T);
    ballState.v0 = -(ballState.gravity * ballState.T) / 2;
    ballState.lastImpactTime = firstBeatTime;
    ballState.particles = [];
}

function spawnParticles(px, py) {
    ballState.particles = [];
    for (let i = 0; i < 4; i++) {
        ballState.particles.push({
            x: px, y: py,
            vx: (Math.random() - 0.5) * 2,
            vy: -Math.random() * 2,
            life: 1.0,
        });
    }
}

export function checkBounce(t) {
    if (!state.showBeats || !state.bpm || state.firstBeatTime == null) return;
    const period = 60 / state.bpm;
    const idx = Math.floor((t - state.firstBeatTime) / period);
    if (idx === state.nextBounceIdx || idx < 0) return;
    state.nextBounceIdx = idx;
    ballState.lastImpactTime = state.firstBeatTime + idx * period;
    ballState._triggerParticles = true;
}

export function syncBallToTime(t) {
    if (!state.bpm || state.firstBeatTime == null) return;
    const period = 60 / state.bpm;
    const idx = t < state.firstBeatTime ? 0 : Math.floor((t - state.firstBeatTime) / period);
    state.nextBounceIdx = idx;
    ballState.lastImpactTime = state.firstBeatTime + idx * period;
    ballState.wallLastFrame = 0;
}

export function drawBouncingBall(ctx, video) {
    if (!state.bpm || !ballState.T) return;

    const { ballArea } = getLayout(video);
    
    // --- FIX 1: Smaller Radius ---
    // Reduced from 0.22 to 0.12 of the area height
    const RADIUS = Math.min(ballArea.w, ballArea.h) * 0.06; 
    
    const cx = ballArea.x + ballArea.w / 2;

    // --- FIX 2: Lifting the Floor ---
    // We subtract an extra 60px to clear the timeline/playbar at the bottom
    const floorY = ballArea.y + ballArea.h - RADIUS - 60;
    
    // travel is the total distance the ball moves vertically
    const travel = floorY - (ballArea.y + RADIUS + 200);

    const elapsed = video.currentTime - ballState.lastImpactTime;
    const normY = (ballState.v0 * elapsed) + (0.5 * ballState.gravity * elapsed * elapsed);
    const drawY = floorY + normY * travel;

    const wall = performance.now() / 1000;
    const dt = ballState.wallLastFrame > 0 ? Math.min(wall - ballState.wallLastFrame, 0.1) : 1/60;
    ballState.wallLastFrame = wall;

    if (ballState._triggerParticles) {
        spawnParticles(cx, floorY);
        ballState._triggerParticles = false;
    }

    // Clean Particles
    for (let i = ballState.particles.length - 1; i >= 0; i--) {
        const p = ballState.particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life -= 0.04;
        if (p.life <= 0) { ballState.particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life * 0.5;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill();
    }

    // Minimal Shadow
    const closeness = Math.max(0, 1 - (floorY - drawY) / travel);
    ctx.globalAlpha = closeness * 0.15;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, floorY + RADIUS * 0.5, RADIUS * (0.4 + closeness * 0.4), RADIUS * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Minimal White Ball
    ctx.save();
    ctx.translate(cx, drawY);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, RADIUS, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Minimal floor dash (only visible near the ball)
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - RADIUS * 2, floorY + RADIUS * 0.5);
    ctx.lineTo(cx + RADIUS * 2, floorY + RADIUS * 0.5);
    ctx.stroke();
    ctx.restore();
}
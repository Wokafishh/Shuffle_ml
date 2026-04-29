// variables.js — sidebar variables panel

import { state } from './state.js';

/**
 * Reference thresholds and targets for dance metrics.
 * Centralizing these makes it easier to tune the "difficulty" or benchmarks.
 */
const REFERENCES = {
    beat_timing: {
        max_offset_limit: 300,   // ms (beyond this is 0% progress)
        hit_rate_target: 100,    // %
        good_threshold: 0.7,
        warn_threshold: 0.4
    },
    spatial_coverage: {
        target_pct: 5.0,         // % coverage considered "full" for the bar
    },
    sync: {
        pearson_min: -1,
        pearson_max: 1
    },
    symmetry: {
        perfect: 1.0
    }
};

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

function renderVariables(data) {
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
                barFrac: bt.mean_offset_ms != null 
                    ? Math.max(0, 1 - bt.mean_offset_ms / REFERENCES.beat_timing.max_offset_limit) 
                    : 0,
            },
            { label: 'Std offset', value: bt.std_offset_ms != null ? `${fmt(bt.std_offset_ms)} ms` : null },
            {
                label: 'Hit rate (<80ms)',
                value: bt.hit_rate_pct != null ? `${fmt(bt.hit_rate_pct)} %` : null,
                showBar: bt.hit_rate_pct != null,
                barFrac: (bt.hit_rate_pct ?? 0) / REFERENCES.beat_timing.hit_rate_target,
            },
            { label: 'Fotsättningar', value: bt.n_landings },
        ]),

        section('📐 Yt-användning', [
            {
                label: 'Coverage',
                value: sc.coverage_pct != null ? `${fmt(sc.coverage_pct, 2)} %` : null,
                showBar: sc.coverage_pct != null,
                barFrac: Math.min(1, (sc.coverage_pct ?? 0) / REFERENCES.spatial_coverage.target_pct),
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
                // Scale -1 to 1 into a 0 to 1 fraction
                barFrac: ((ah.pearson_r ?? 0) - REFERENCES.sync.pearson_min) / (REFERENCES.sync.pearson_max - REFERENCES.sync.pearson_min),
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
                barFrac: (sy.symmetry_arms ?? 0) / REFERENCES.symmetry.perfect,
            },
            {
                label: 'Ben',
                value: sy.symmetry_legs != null ? fmt(sy.symmetry_legs, 3) : null,
                showBar: sy.symmetry_legs != null,
                barFrac: (sy.symmetry_legs ?? 0) / REFERENCES.symmetry.perfect,
            },
        ]),

        orig.origin_px != null ? section('📍 Ursprung', [
            { label: 'Origin X', value: `${fmt(orig.origin_px, 1)} px` },
            { label: 'Origin Y', value: `${fmt(orig.origin_py, 1)} px` },
        ]) : '',

    ].join('');
}

export function loadVariables(name) {
    fetch(`/api/variables/${encodeURIComponent(name)}`)
        .then(r => r.json())
        .then(renderVariables)
        .catch(e => {
            document.getElementById('var-panel').innerHTML =
                `<div id="var-error">Kunde inte ladda variabler:<br>${e}</div>`;
        });
}
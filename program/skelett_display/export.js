// export.js — exports all loaded session data as a JSON file

import { state } from './state.js';

/**
 * Builds a structured export object from the data that main.js loads:
 *   beats / melodic_changes / drops  ← from beats JSON
 *   frames / fps                     ← from skeleton JSON
 *   bpm / duration                   ← derived fields on state
 *
 * The export includes a snapshot of the current video position so the
 * file can be used to resume or replay analysis at the same point.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeFrames=false]  Skeleton frames are large;
 *   opt-in to include them. Omitted by default to keep the file small.
 * @param {string}  [opts.filename]             Override the default filename.
 */
export function exportData(opts = {}) {
    const {
        includeFrames = false,
        filename,
    } = opts;

    const video = document.getElementById('video');
    const name  = new URLSearchParams(location.search).get('name') ?? 'export';

    // ── Assemble payload ──────────────────────────────────────
    const payload = {
        meta: {
            name,
            exportedAt:      new Date().toISOString(),
            currentTime_s:   video?.currentTime ?? 0,
            duration_s:      state.duration      ?? 0,
            bpm:             state.bpm           ?? 0,
        },

        beats: {
            beat_count:       state.beats?.length   ?? 0,
            items:            state.beats            ?? [],
        },

        melodic_changes:      state.melodic          ?? [],

        drops:                state.drops            ?? [],

        skeleton: {
            fps:              state.fps              ?? 30,
            frame_count:      state.frames?.length   ?? 0,
            ...(includeFrames ? { frames: state.frames ?? [] } : {}),
        },
    };

    // ── Serialise & trigger download ──────────────────────────
    const blob = new Blob(
        [JSON.stringify(payload, null, 2)],
        { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');

    a.href     = url;
    a.download = filename ?? `${name}_export.json`;
    a.click();

    // Clean up the object URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    return payload; // Return for programmatic use / debugging
}
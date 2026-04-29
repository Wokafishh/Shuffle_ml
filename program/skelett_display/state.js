// state.js — shared application state

export const state = {
    showSkeleton: true,
    showBeats: true,
    beats: [],
    melodic: [],
    frames: [],
    fps: 30,
    duration: 0,
    lastBeatIdx: -1,
    raf: null,
    origin: null,
    bpm: 120,
    firstBeatTime: 0,
    nextBounceIdx: 0,
};
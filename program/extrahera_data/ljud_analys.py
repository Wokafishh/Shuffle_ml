import librosa
import numpy as np
from pathlib import Path
import json
import warnings
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

warnings.filterwarnings("ignore")
console = Console(highlight=False)


def hitta_drop(y: np.ndarray, sr: int, duration_s: float) -> list[dict]:
    frame_len = 2048
    hop = 512

    # RMS energy envelope
    rms = librosa.feature.rms(y=y, frame_length=frame_len, hop_length=hop)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)

    # Smooth with a ~1 s window so individual transients don't dominate
    smooth_win = int(sr / hop)  # ~1 s worth of frames
    rms_smooth = np.convolve(rms, np.ones(smooth_win) / smooth_win, mode="same")

    # Normalise 0-1
    rms_norm = rms_smooth / (rms_smooth.max() + 1e-9)

    # Delta: how much energy rose compared to 2 s ago
    lookback = int(2 * sr / hop)
    delta = np.zeros_like(rms_norm)
    for i in range(lookback, len(rms_norm)):
        delta[i] = rms_norm[i] - rms_norm[i - lookback]

    # Candidate drops: big positive jump AND preceded by a quiet section
    energy_threshold   = 0.35   # current energy must be above this (it's loud now)
    delta_threshold    = 0.20   # energy must have risen by at least this much
    breakdown_ceiling  = 0.55   # the "before" window must have been below this

    candidates = []
    min_gap_s  = 10.0           # ignore drops within 10 s of each other
    last_drop  = -min_gap_s

    for i in range(lookback, len(rms_norm)):
        t = float(rms_times[i])
        if (
            rms_norm[i]          >= energy_threshold
            and delta[i]         >= delta_threshold
            and rms_norm[i - lookback] <= breakdown_ceiling
            and t - last_drop    >= min_gap_s
            # skip the first 5 % and last 5 % of the track (intros/outros)
            and t > 0.05 * duration_s
            and t < 0.95 * duration_s
        ):
            candidates.append(t)
            last_drop = t

    return candidates


def analysera_ljud(video_path: Path, output_dir: Path) -> Path:
    with Progress(
        SpinnerColumn(),
        TextColumn("[bold cyan]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
        transient=True,
    ) as progress:
        task = progress.add_task(f"Analyserar {video_path.name}…", total=5)

        # Step 1 – Load audio
        progress.update(task, description="Extracting audio...")
        y, sr = librosa.load(video_path, sr=None, mono=True, res_type="kaiser_fast")
        duration_s = round(float(librosa.get_duration(y=y, sr=sr)), 2)
        progress.advance(task)

        # Step 2 – Beat tracking
        progress.update(task, description="Tracking beats...")
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        tempo = float(np.squeeze(tempo))
        progress.advance(task)

        # Step 3 – Build beat list
        progress.update(task, description="Compiling beats...")
        beats = []
        for i, t in enumerate(beat_times):
            beat_in_bar = (i % 4) + 1
            beats.append({
                "index":       i,
                "time_s":      round(t, 4),
                "time_ms":     round(t * 1000, 1),
                "beat_in_bar": beat_in_bar,
                "is_strong":   beat_in_bar in (1, 3),
            })
        progress.advance(task)

        # Step 4 – Drop detection
        progress.update(task, description="Hunting for the drop...")
        raw_drops = hitta_drop(y, sr, duration_s)

        # Snap each drop candidate to the nearest beat for clean alignment
        drops = []
        for t in raw_drops:
            if beat_times:
                nearest_beat_t = min(beat_times, key=lambda b: abs(b - t))
                snap_t = nearest_beat_t if abs(nearest_beat_t - t) < 0.5 else t
            else:
                snap_t = t
            drops.append({
                "time_s":  round(snap_t, 4),
                "time_ms": round(snap_t * 1000, 1),
            })
        progress.advance(task)

        # Step 5 – Save JSON
        progress.update(task, description="Saving...")
        beats_duration_s  = round((len(beats) / tempo) * 60, 2)
        duration_diff_s   = round(abs(duration_s - beats_duration_s), 2)

        result = {
            "video":      video_path.name,
            "duration_s": duration_s,
            "bpm":        round(tempo, 2),
            "beat_count": len(beats),
            "beats":      beats,
            "drops":      drops,           # ← replaces melodic_changes
        }

        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / f"{video_path.stem}_beats.json"
        out_path.write_text(json.dumps(result, indent=2))
        progress.advance(task)

    # Summary
    diff_color = "green" if duration_diff_s < 1 else "yellow" if duration_diff_s < 3 else "red"
    drop_times = ", ".join(f"{d['time_s']}s" for d in drops) or "none detected"

    console.print(f"  [dim]Beats:[/]    {len(beats)} @ {result['bpm']} BPM")
    console.print(f"  [dim]Duration:[/] {duration_s}s (audio) vs {beats_duration_s}s (beats) — [{diff_color}]diff {duration_diff_s}s[/]")
    console.print(f"  [dim]Drops:[/]    {len(drops)} → {drop_times}")
    console.print(f"  [dim]Saved →[/]   [cyan]{out_path}[/]")

    return out_path
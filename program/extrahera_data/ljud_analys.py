import librosa
import numpy as np
from pathlib import Path
import json
import warnings
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

warnings.filterwarnings("ignore")
console = Console(highlight=False)

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
        progress.update(task, description="Extracting sound... ")
        y, sr = librosa.load(video_path, sr=None, mono=True, res_type='kaiser_fast')
        progress.advance(task)

        # Step 2 – Beat tracking
        progress.update(task, description="Tracking beats...")
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        tempo = float(np.squeeze(tempo))
        progress.advance(task)

        # Step 3 – Build beat list
        progress.update(task, description="Compiling list...")
        beats = []
        for i, t in enumerate(beat_times):
            beat_in_bar = (i % 4) + 1
            beats.append({
                "index": i,
                "time_s": round(t, 4),
                "time_ms": round(t * 1000, 1),
                "beat_in_bar": beat_in_bar,
                "is_strong": beat_in_bar in (1, 3)
            })
        progress.advance(task)

        # Step 4 – Onset / melodic changes
        progress.update(task, description="Find melodic changes...")
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        onset_frames = librosa.onset.onset_detect(
            onset_envelope=onset_env, sr=sr, units="frames",
            delta=0.5,
            wait=10
        )
        onset_times = librosa.frames_to_time(onset_frames, sr=sr).tolist()
        melodic_changes = [
            {"time_s": round(t, 4), "time_ms": round(t * 1000, 1)}
            for t in onset_times
            if all(abs(t - b) > 0.05 for b in beat_times)
        ]
        progress.advance(task)

        # Step 5 – Save JSON
        progress.update(task, description="Saving...")
        duration_s = round(float(librosa.get_duration(y=y, sr=sr)), 2)
        beats_duration_s = round((len(beats) / tempo) * 60, 2)
        duration_diff_s = round(abs(duration_s - beats_duration_s), 2)

        result = {
            "video": video_path.name,
            "duration_s": duration_s,
            "bpm": round(tempo, 2),
            "beat_count": len(beats),
            "beats": beats,
            "melodic_changes": melodic_changes
        }

        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / f"{video_path.stem}_beats.json"
        out_path.write_text(json.dumps(result, indent=2))
        progress.advance(task)

    # Summary printed after the bar disappears (transient=True)
    diff_color = "green" if duration_diff_s < 1 else "yellow" if duration_diff_s < 3 else "red"
    console.print(f"  [dim]Beats:[/] {len(beats)} @ {result['bpm']} BPM")
    console.print(f"  [dim]Längd:[/] {duration_s}s (audio) vs {beats_duration_s}s (beats) — [{diff_color}]diff {duration_diff_s}s[/]")
    console.print(f"  [dim]Melodiska förändringar:[/] {len(melodic_changes)}")
    console.print(f"  [dim]Sparad →[/] [cyan]{out_path}[/]")

    return out_path
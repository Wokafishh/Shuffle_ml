from pathlib import Path
from ljud_analys import analysera_ljud
from pose_analys import analysera_skelett
from variabel_analys import variabel_analys
from rich.console import Console
from rich.prompt import Prompt
from rich.panel import Panel
from rich.table import Table
import sys
import subprocess
import json

console = Console()

BASE = Path(__file__).parent.parent.parent
RAW_VIDEOS_PATH = BASE / "data" / "raw_videos"
BEATS_OUT       = BASE / "data" / "beats_out"
SKELETT_OUT     = BASE / "data" / "skelett_out"
VIEWER_PATH     = BASE / "program" / "skelett_display" / "run.py"

console.print(
    Panel(
        "[bold cyan]Shuffle ML[/][dim]— Extrahera data[/]",
        subtitle=f"[dim]{RAW_VIDEOS_PATH.resolve()}[/]",
    )
)

videos_input = Prompt.ask(
    "\n[yellow]Vilken video ska analyseras?[/] [dim]('all' / 'no_skip')[/]",
)

parts = videos_input.strip().lower().split()
skip_existing = "no_skip" not in parts
name_part = next((p for p in parts if p != "no_skip"), None)

if not name_part or name_part == "all":
    videos = list(RAW_VIDEOS_PATH.glob("*.mp4"))
    console.print(f"\n[cyan]Hittade {len(videos)} videor[/]")
else:
    name = name_part if name_part.endswith(".mp4") else name_part + ".mp4"
    path = RAW_VIDEOS_PATH / name
    if not path.exists():
        console.print(f"\n[red]Hittade inte '{name}'[/]")
        table = Table(title="Tillgängliga videor", show_header=False)
        table.add_column(style="dim")
        for f in RAW_VIDEOS_PATH.glob("*.mp4"):
            table.add_row(f.name)
        console.print(table)
        exit()
    videos = [path]


def files_exist(video: Path) -> bool:
    beats = (BEATS_OUT / f"{video.stem}_beats.json").exists()
    skelett = (SKELETT_OUT / f"{video.stem}_skelett.json").exists()
    return beats and skelett


for i, video in enumerate(videos, 1):
    console.rule(f"[cyan]Video {i}/{len(videos)} — {video.name}[/]")

    if skip_existing and files_exist(video):
        console.print("  [dim]Hoppar över — filer finns redan[/]")
    else:
        console.print("  [bold]Del 1/2[/] Ljudanalys")
        analysera_ljud(video, BEATS_OUT)

        console.print("  [bold]Del 2/2[/] Skelettanalys")
        analysera_skelett(video, SKELETT_OUT)

    console.print("  [bold]Variabelanalys[/]")
    resultat = variabel_analys(
        videos=[str(video)],
        namn=video.stem,
        skeleton_suffix="_skelett.json",
        beats_suffix="_beats.json",
    )

    result_path = BASE / "data" / "variabel_out" / f"{video.stem}_variabler.json"
    result_path.parent.mkdir(exist_ok=True)
    result_path.write_text(json.dumps(resultat, ensure_ascii=False, indent=2))

    console.print("  [bold]Öppnar skelettvisaren...[/]")
    subprocess.Popen(["python", str(VIEWER_PATH), video.stem])

console.print(
    Panel(f"[bold green]Shuffle ML - Klar! {len(videos)} video(r) analyserade[/]")
)
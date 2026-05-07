from pathlib import Path
from rich.console import Console
from rich.prompt import Prompt
from rich.table import Table
from rich.panel import Panel

console = Console()

BASE            = Path(__file__).parent.parent
RAW_VIDEOS_PATH = BASE / "data" / "raw_videos"
SKELETT_OUT     = BASE / "data" / "skelett_out"


# ── Placeholder ────────────────────────────────────────────────────────────────

def process_skelett(video: Path, skelett_path: Path) -> None:
    console.print(f"  [dim]TODO: bearbeta {skelett_path.name}[/]")


# ── Hjälpfunktioner ────────────────────────────────────────────────────────────

def get_skelett_path(video: Path) -> Path | None:
    path = SKELETT_OUT / f"{video.stem}_skelett.json"
    return path if path.exists() else None


def resolve_videos(videos_input: str) -> list[Path]:
    parts     = videos_input.strip().lower().split()
    name_part = next((p for p in parts if p != "no_skip"), None)

    if not name_part or name_part == "all":
        videos = sorted(RAW_VIDEOS_PATH.glob("*.mp4"))
        console.print(f"\n[cyan]Hittade {len(videos)} videor[/]\n")
        return videos

    name = name_part if name_part.endswith(".mp4") else name_part + ".mp4"
    path = RAW_VIDEOS_PATH / name

    if not path.exists():
        console.print(f"\n[red]Hittade inte '{name}'[/]")
        table = Table(title="Tillgängliga videor", show_header=False)
        table.add_column(style="dim")
        for f in sorted(RAW_VIDEOS_PATH.glob("*.mp4")):
            table.add_row(f.name)
        console.print(table)
        raise SystemExit(1)

    return [path]


# ── Main ───────────────────────────────────────────────────────────────────────

console.print(
    Panel(
        "[bold cyan]Shuffle ML[/] [dim]— Bearbeta skelett-filer[/]",
        subtitle=f"[dim]{SKELETT_OUT.resolve()}[/]",
    )
)

videos_input = Prompt.ask(
    "\n[yellow]Vilken video ska bearbetas?[/] [dim]('all' / videonamn)[/]"
)

videos  = resolve_videos(videos_input) # Returns PATH
ok, missing = [], []

for video_path in videos:
    skelett = get_skelett_path(video_path)
    if skelett:
        size_kb = round(skelett.stat().st_size / 1024, 1)
        console.print(f"  [green]✓[/] {video_path.name} [dim]({size_kb} KB)[/]")
        ok.append((video_path, skelett))
    else:
        console.print(f"  [red]✗[/] {video_path.name} [dim]ingen skelett-fil[/]")
        missing.append(video_path)

console.print()

for i, (video_path, skelett_path) in enumerate(ok, 1):
    console.rule(f"[cyan]{i}/{len(ok)} — {video_path.name}[/]")
    process_skelett(video_path, skelett_path)

console.print(
    Panel(
        f"[green]{len(ok)} bearbetade[/]  [red]{len(missing)} saknas[/]  [dim]av {len(videos)} total[/]",
        title="Resultat",
    )
)
"""
──────────────────
Multi-person skelett-extraktion för dansvideor.
Sparar bara relevanta landmärken: huvud, axlar, armar, händer, höfter, ben, fötter.

Två lager av filtrering:
  1. Anatomisk validering per frame  – helkroppsposen måste vara rimlig
  2. Temporal hastighetsbegränsning  – enskilda punkter som teleporterar
     rensas bort (sätts till v=0) utan att kassera hela personen

Anropas från handler:
    from mocap_mediapipe import analysera_skelett
    analysera_skelett(video_path, output_dir)

Beroenden:
    pip install mediapipe opencv-python-headless rich
"""

import json
import math
import warnings
import os
from pathlib import Path
from typing import Optional

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("GLOG_minloglevel", "3")

import cv2
from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

warnings.filterwarnings("ignore")
console = Console(highlight=False)

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from mediapipe.tasks.python.vision import PoseLandmarkerOptions, RunningMode


# ── Landmärken ─────────────────────────────────────────────────────────────────
KEYPOINTS: dict[str, int] = {
    "nose":             0,
    "left_ear":         7,
    "right_ear":        8,
    "left_shoulder":    11,
    "right_shoulder":   12,
    "left_elbow":       13,
    "right_elbow":      14,
    "left_wrist":       15,
    "right_wrist":      16,
    "left_index":       19,
    "right_index":      20,
    "left_hip":         23,
    "right_hip":        24,
    "left_knee":        25,
    "right_knee":       26,
    "left_ankle":       27,
    "right_ankle":      28,
    "left_heel":        29,
    "right_heel":       30,
    "left_foot_index":  31,
    "right_foot_index": 32,
}

# Max pixel-rörelse per frame (vid 30 fps) innan punkten kasseras.
# Armar/händer tillåts röra sig snabbare än höfter/huvud.
_FAST_KPS  = {"left_wrist", "right_wrist", "left_index", "right_index",
              "left_ankle", "right_ankle", "left_foot_index", "right_foot_index",
              "left_heel", "right_heel"}
_SPEED_LIMIT_FAST  = 280   # px / frame  – händer & fötter
_SPEED_LIMIT_SLOW  = 180   # px / frame  – huvud, axlar, höfter, knän

# Skalas med skip_frames i runtime
# (om skip_frames=2 är 2 frames borta → dubbel tillåten förflyttning)


# ── Hjälpfunktioner ────────────────────────────────────────────────────────────

def _dist(a: dict, b: dict) -> float:
    return math.hypot(a["px"] - b["px"], a["py"] - b["py"])


def _lm_to_dict(lm, width: int, height: int) -> dict:
    return {
        "x":  round(float(lm.x), 4),
        "y":  round(float(lm.y), 4),
        "z":  round(float(lm.z), 4),
        "v":  round(float(getattr(lm, "visibility", 0.0)), 3),
        "px": round(float(lm.x) * width,  1),
        "py": round(float(lm.y) * height, 1),
    }


def _build_person(pose_landmarks, width: int, height: int) -> dict:
    kps = {
        name: _lm_to_dict(pose_landmarks[idx], width, height)
        for name, idx in KEYPOINTS.items()
    }
    xs = [kp["px"] for kp in kps.values()]
    ys = [kp["py"] for kp in kps.values()]
    return {
        "person_id": None,
        "bbox": {
            "x_min": round(min(xs), 1), "y_min": round(min(ys), 1),
            "x_max": round(max(xs), 1), "y_max": round(max(ys), 1),
            "cx":    round((min(xs) + max(xs)) / 2, 1),
            "cy":    round((min(ys) + max(ys)) / 2, 1),
        },
        "kps": kps,
    }


# ── Anatomisk validering ───────────────────────────────────────────────────────

def _is_valid_pose(person: dict) -> bool:
    """
    Kastar bort hela detektionen om grundläggande anatomi är bruten.
    Kontrollerar bara punkter med tillräcklig visibility (≥0.3).
    Trösklarna är generösa för att klara dansposes: crouching, splits,
    backflips, djup squat, floor-work, kraftig framåtlutning.
    """
    kps = person["kps"]

    def get(name) -> Optional[dict]:
        k = kps.get(name)
        return k if k and k.get("v", 0) >= 0.3 else None

    ls, rs = get("left_shoulder"),  get("right_shoulder")
    lh, rh = get("left_hip"),       get("right_hip")
    lk, rk = get("left_knee"),      get("right_knee")
    la, ra = get("left_ankle"),      get("right_ankle")
    nose   = get("nose")

    # Axlar ovanför höfter — tillåt extrem böjning/hopp (t.ex. backflip-posen)
    if ls and lh and ls["py"] > lh["py"] + 250:
        return False
    if rs and rh and rs["py"] > rh["py"] + 250:
        return False

    # Höfter ovanför knän — tillåt djup squat/splits
    if lh and lk and lh["py"] > lk["py"] + 200:
        return False
    if rh and rk and rh["py"] > rk["py"] + 200:
        return False

    # Knän ovanför anklar — tillåt knäböj och sparkar
    if lk and la and lk["py"] > la["py"] + 200:
        return False
    if rk and ra and rk["py"] > ra["py"] + 200:
        return False

    # Näsa ovanför axlar — tillåt kraftig framåtlutning
    if nose and ls and rs:
        shoulder_y = (ls["py"] + rs["py"]) / 2
        if nose["py"] > shoulder_y + 300:
            return False

    # Överarm/underarm-proportioner — utsträckta armar i 2D-projektion
    # kan se konstiga ut, tillåt upp till 5× skillnad
    lel = get("left_elbow");  lwr = get("left_wrist")
    rel = get("right_elbow"); rwr = get("right_wrist")
    if ls and lel and lwr:
        u, l = _dist(ls, lel), _dist(lel, lwr)
        if u > 0 and l > 0 and (u / l > 5.0 or l / u > 5.0):
            return False
    if rs and rel and rwr:
        u, l = _dist(rs, rel), _dist(rel, rwr)
        if u > 0 and l > 0 and (u / l > 5.0 or l / u > 5.0):
            return False

    # Bounding-box-aspekt — tillåt horisontella poser (golvet) och
    # smala croppade frames
    bbox = person.get("bbox", {})
    w = bbox.get("x_max", 0) - bbox.get("x_min", 0)
    h = bbox.get("y_max", 0) - bbox.get("y_min", 0)
    if h > 0 and (w / h < 0.04 or w / h > 6.0):
        return False

    return True


def _is_camera_motion(current: dict, previous: Optional[dict], threshold: float = 0.75) -> bool:
    """
    Returns True if it looks like the camera moved rather than the person.
    Heuristic: if >75% of visible keypoints all move in the same direction
    by more than 30px, it's probably camera shake, not body motion.
    """
    if previous is None:
        return False

    curr_kps = current["kps"]
    prev_kps = previous["kps"]

    deltas = []
    for name in curr_kps:
        kc, kp = curr_kps[name], prev_kps.get(name)
        if not kp or kc.get("v", 0) < 0.3 or kp.get("v", 0) < 0.3:
            continue
        dx = kc["px"] - kp["px"]
        dy = kc["py"] - kp["py"]
        if math.hypot(dx, dy) > 30:
            deltas.append((dx, dy))

    if len(deltas) < 6:  # not enough visible points to judge
        return False

    # Check if all deltas point in roughly the same direction
    avg_dx = sum(d[0] for d in deltas) / len(deltas)
    avg_dy = sum(d[1] for d in deltas) / len(deltas)

    # Count how many agree with the average direction (dot product > 0)
    agreeing = sum(
        1 for dx, dy in deltas
        if (dx * avg_dx + dy * avg_dy) > 0
    )

    return (agreeing / len(deltas)) >= threshold


# ── Temporal hastighetsbegränsning ─────────────────────────────────────────────

def _apply_velocity_filter(
    current: dict,
    previous: Optional[dict],
    speed_scale: float,          # skip_frames – skalar hastighetsgränsen
) -> dict:
    """
    Jämför varje keypoint med föregående frame.
    Om en punkt rör sig för snabbt sätts v=0 och koordinaterna behålls
    (renderaren ignorerar punkter med låg v, interpolationen hoppar över dem).
    Returnerar en modifierad kopia av current.
    """
    if previous is None:
        return current

    prev_kps = previous["kps"]
    curr_kps = current["kps"]

    # Hur många keypoints som rensades — för att avgöra om vi ska logga
    zeroed: list[str] = []

    new_kps = {}
    for name, kp in curr_kps.items():
        prev = prev_kps.get(name)
        if prev is None or prev.get("v", 0) < 0.3 or kp.get("v", 0) < 0.3:
            new_kps[name] = kp
            continue

        limit = (_SPEED_LIMIT_FAST if name in _FAST_KPS else _SPEED_LIMIT_SLOW) * speed_scale
        d = _dist(kp, prev)

        if d > limit:
            # Nolla bara den här punkten, bevara koordinaterna ifall nästa frame
            # är normal (interpolation kan bridga en nollad punkt)
            new_kps[name] = {**kp, "v": 0.0}
            zeroed.append(f"{name}({d:.0f}px)")
        else:
            new_kps[name] = kp

    if zeroed:
        # Mutera inte originalet
        current = {**current, "kps": new_kps}

    return current


def _match_person(person: dict, prev_persons: list[dict]) -> Optional[dict]:
    """
    Hitta närmaste person i föregående frame baserat på bbox-centroid.
    Returnerar None om ingen rimlig match hittas (> 300px bort).
    """
    if not prev_persons:
        return None
    cx = person["bbox"]["cx"]
    cy = person["bbox"]["cy"]
    best, best_d = None, float("inf")
    for pp in prev_persons:
        d = math.hypot(pp["bbox"]["cx"] - cx, pp["bbox"]["cy"] - cy)
        if d < best_d:
            best_d, best = d, pp
    return best if best_d < 300 else None


# ── Hjälpfunktioner för modell ─────────────────────────────────────────────────

def _ensure_model(model_dir: Path) -> Path:
    model_path = model_dir / "pose_landmarker_heavy.task"
    if not model_path.exists():
        import urllib.request
        model_dir.mkdir(parents=True, exist_ok=True)
        url = (
            "https://storage.googleapis.com/mediapipe-models/"
            "pose_landmarker/pose_landmarker_full/float16/latest/"
            "pose_landmarker_heavy.task"
        )
        console.print(f"  [dim]Laddar ner modell → {model_path.name} …[/]")
        urllib.request.urlretrieve(url, model_path)
        console.print("  [green]Modell klar[/]")
    return model_path


def _make_landmarker(num_poses: int, model_path: Path):
    opts = PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=RunningMode.VIDEO,
        num_poses=num_poses,
        min_pose_detection_confidence=0.2,
        min_pose_presence_confidence=0.2,
        min_tracking_confidence=0.2,
        output_segmentation_masks=False,
    )
    return mp_vision.PoseLandmarker.create_from_options(opts)


# ── Huvud-API ──────────────────────────────────────────────────────────────────

def analysera_skelett(
    video_path:       Path,
    output_dir:       Path,
    num_poses:        int  = 1,
    skip_frames:      int  = 1,
    model_dir:        Path = None,
    save_debug_video: bool = False,
) -> Path:
    if model_dir is None:
        model_dir = Path(__file__).parent / "models"

    model_path = _ensure_model(model_dir)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise IOError(f"Kunde inte öppna video: {video_path}")

    fps         = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width       = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height      = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Hastighetsgränsen skalas med skip_frames och justera för FPS
    # (30 fps-gränserna ovan × faktiska frame-gap × 30/fps)
    speed_scale = skip_frames * (30.0 / fps)

    frames_data:   list[dict]        = []
    prev_persons:  list[dict]        = []
    debug_writer                     = None

    # Räknare för statistik
    n_anatomy_rejected  = 0
    n_velocity_zeroed   = 0

    if save_debug_video:
        output_dir.mkdir(parents=True, exist_ok=True)
        fourcc = cv2.VideoWriter.fourcc(*"mp4v")  # type: ignore[attr-defined]
        debug_writer = cv2.VideoWriter(
            str(output_dir / f"{video_path.stem}_debug.mp4"),
            fourcc, fps, (width, height),
        )

    with Progress(
        SpinnerColumn(),
        TextColumn("[bold cyan]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TextColumn("[dim]{task.completed}/{task.total} frames[/]"),
        console=console,
        transient=True,
    ) as progress:
        task = progress.add_task(
            f"Skelett · {video_path.name[:40]}",
            total=max(frame_count // skip_frames, 1),
        )

        with _make_landmarker(num_poses, model_path) as landmarker:
            frame_idx = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_idx % skip_frames != 0:
                    frame_idx += 1
                    continue

                time_ms = int(frame_idx / fps * 1000)
                rgb     = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result  = landmarker.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), time_ms
                )

                persons = []
                for lms in (result.pose_landmarks or []):
                    candidate = _build_person(lms, width, height)

                    # Lager 1: anatomisk validering
                    if not _is_valid_pose(candidate):
                        n_anatomy_rejected += 1
                        continue

                    # Lager 2: temporal hastighetsbegränsning
                    prev = _match_person(candidate, prev_persons)

                    # Camera motion check — suppress entire frame if camera is shaking
                    if prev and _is_camera_motion(candidate, prev):
                        n_anatomy_rejected += 1
                        continue

                    filtered = _apply_velocity_filter(candidate, prev, speed_scale)

                    # Räkna nollade punkter
                    if filtered is not candidate:
                        n_velocity_zeroed += sum(
                            1 for name, kp in filtered["kps"].items()
                            if kp.get("v", 1) == 0.0
                            and candidate["kps"][name].get("v", 0) > 0.3
                        )

                    persons.append(filtered)

                frames_data.append({
                    "frame":   frame_idx,
                    "time_s":  round(frame_idx / fps, 4),
                    "time_ms": round(time_ms, 1),
                    "persons": persons,
                })

                prev_persons = persons

                if debug_writer and persons:
                    _draw_debug(frame, persons, debug_writer)

                frame_idx += 1
                progress.advance(task)

    cap.release()
    if debug_writer:
        debug_writer.release()

    # ── Statistik & spara ──────────────────────────────────────────────────────
    n          = len(frames_data)
    med_pers   = sum(1 for f in frames_data if f["persons"])
    max_pers   = max((len(f["persons"]) for f in frames_data), default=0)
    snitt_pers = round(sum(len(f["persons"]) for f in frames_data) / max(n, 1), 2)

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{video_path.stem}_skelett.json"
    out_path.write_text(json.dumps({
        "video":          video_path.name,
        "fps":            round(fps, 3),
        "width":          width,
        "height":         height,
        "duration_s":     round(frame_count / fps, 3),
        "skip_frames":    skip_frames,
        "num_poses":      num_poses,
        "keypoint_names": list(KEYPOINTS.keys()),
        "stats": {
            "processed_frames":         n,
            "frames_with_detections":   med_pers,
            "max_persons_in_frame":     max_pers,
            "avg_persons_per_frame":    snitt_pers,
            "anatomy_rejected":         n_anatomy_rejected,
            "velocity_zeroed_keypoints": n_velocity_zeroed,
        },
        "frames": frames_data,
    }, indent=2, ensure_ascii=False))

    console.print(f"  [dim]Frames:[/] {n} (var {skip_frames}:e)")
    console.print(
        f"  [dim]Personer:[/] max [cyan]{max_pers}[/]/frame · "
        f"snitt [cyan]{snitt_pers}[/] · {med_pers}/{n} frames"
    )
    console.print(
        f"  [dim]Filter:[/] "
        f"[yellow]{n_anatomy_rejected}[/] poser kasserade · "
        f"[yellow]{n_velocity_zeroed}[/] punkter nollade (hastighet)"
    )
    console.print(f"  [dim]Sparad →[/] [cyan]{out_path}[/]")
    return out_path


# ── Debug-ritning ──────────────────────────────────────────────────────────────

_CONNECTIONS = [
    ("left_ear", "nose"), ("right_ear", "nose"),
    ("left_shoulder", "right_shoulder"),
    ("left_shoulder", "left_elbow"),   ("left_elbow", "left_wrist"),
    ("left_wrist", "left_index"),
    ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"),
    ("right_wrist", "right_index"),
    ("left_shoulder", "left_hip"),     ("right_shoulder", "right_hip"),
    ("left_hip", "right_hip"),
    ("left_hip", "left_knee"),         ("left_knee", "left_ankle"),
    ("left_ankle", "left_heel"),       ("left_ankle", "left_foot_index"),
    ("right_hip", "right_knee"),       ("right_knee", "right_ankle"),
    ("right_ankle", "right_heel"),     ("right_ankle", "right_foot_index"),
]

_COLORS = [
    (0, 255, 180), (255, 100, 0), (0, 180, 255),
    (255, 0, 180), (180, 255, 0), (100, 100, 255),
]


def _draw_debug(frame, persons: list[dict], writer) -> None:
    annotated = frame.copy()
    for i, person in enumerate(persons):
        color = _COLORS[i % len(_COLORS)]
        kps   = person["kps"]

        for a, b in _CONNECTIONS:
            ka, kb = kps.get(a), kps.get(b)
            if not ka or not kb:
                continue
            # Grå ut nollade punkter i debug-videon
            c = (80, 80, 80) if ka.get("v", 1) < 0.1 or kb.get("v", 1) < 0.1 else color
            cv2.line(annotated,
                     (int(ka["px"]), int(ka["py"])),
                     (int(kb["px"]), int(kb["py"])),
                     c, 2, cv2.LINE_AA)

        for name, kp in kps.items():
            c = (60, 60, 60) if kp.get("v", 1) < 0.1 else color
            cv2.circle(annotated, (int(kp["px"]), int(kp["py"])), 4, c, -1, cv2.LINE_AA)

    writer.write(annotated)
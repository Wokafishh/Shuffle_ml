"""
shuffle_analysis.py
===================
Variabelanalys för shuffledans – tar skelettdata (MediaPipe-format) och beat-data (JSON)
och beräknar kvalitetsvariabler som beskriver hur "fint" en dansare dansar.

Användning:
    from shuffle_analysis import variabel_analys
    results = variabel_analys(videos=["min_video.mp4"], namn="lisa")

Beat-JSON-format (t.ex. "lisa_beats.json"):
    {"bpm": 128, "beats": [0.234, 0.703, 1.172, ...]}   ← tider i sekunder

Skelett-JSON-format (t.ex. "lisa_skelett.json"):
    {"frames": [{"frame": 0, "time_s": 0.0, "persons": [{"kps": {...}}]}, ...]}
"""

from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path
from typing import Any

# ──────────────────────────────────────────────
# Hjälpfunktioner
# ──────────────────────────────────────────────

def _load_json(path: str | Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _kp(frame_person: dict, name: str) -> tuple[float, float] | None:
    """Returnerar (px, py) för ett keypoint, eller None om visibility < 0.5."""
    kps = frame_person.get("kps", {})
    kp = kps.get(name)
    if kp is None or kp.get("v", 0) < 0.5:
        return None
    return kp["px"], kp["py"]


def _dist(a: tuple, b: tuple) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _midpoint(a: tuple, b: tuple) -> tuple[float, float]:
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


# ──────────────────────────────────────────────
# Variabel 1 – Beat Timing Accuracy (ms)
# ──────────────────────────────────────────────

def _beat_timing_accuracy(frames: list[dict], beats_s: list[float]) -> dict:
    """
    Hur nära en takt sker varje tydlig fotsättning.

    Fotsättning detekteras som lokal hastighetsnolla för fotindexet:
    foten rör sig, stannar, rör sig igen → stoppögonblicket = fotsättning.

    Returnerar:
        mean_offset_ms  – genomsnittlig absolut avvikelse från närmaste takt
        std_offset_ms   – standardavvikelse
        hit_rate_pct    – andel fotsättningar inom ±80 ms från en takt
    """
    # Samla fotpositioner per bildruta
    foot_positions: list[dict] = []
    for fr in frames:
        persons = fr.get("persons", [])
        if not persons:
            continue
        p = persons[0]
        t = fr["time_s"]
        lf = _kp(p, "left_foot_index")
        rf = _kp(p, "right_foot_index")
        foot_positions.append({"t": t, "lf": lf, "rf": rf})

    if len(foot_positions) < 3:
        return {"error": "för få frames"}

    # Hitta fotsättningsmoment (lokal hastighetsnolla)
    landings: list[float] = []
    for side in ("lf", "rf"):
        speeds = []
        for i in range(1, len(foot_positions)):
            a = foot_positions[i - 1][side]
            b = foot_positions[i][side]
            dt = foot_positions[i]["t"] - foot_positions[i - 1]["t"]
            if a and b and dt > 0:
                speeds.append((foot_positions[i]["t"], _dist(a, b) / dt))
            else:
                speeds.append((foot_positions[i]["t"], None))

        for i in range(1, len(speeds) - 1):
            t_now, s_now = speeds[i]
            _, s_prev = speeds[i - 1]
            _, s_next = speeds[i + 1]
            if s_now is not None and s_prev is not None and s_next is not None:
                if s_now < s_prev * 0.4 and s_now < s_next * 0.4:
                    landings.append(t_now)

    if not landings or not beats_s:
        return {"mean_offset_ms": None, "std_offset_ms": None, "hit_rate_pct": None,
                "n_landings": len(landings)}

    offsets = []
    for lt in landings:
        closest = min(beats_s, key=lambda b: abs(b - lt))
        offsets.append(abs(closest - lt) * 1000)

    hit_rate = sum(1 for o in offsets if o < 80) / len(offsets) * 100

    return {
        "mean_offset_ms": round(statistics.mean(offsets), 1),
        "std_offset_ms": round(statistics.stdev(offsets) if len(offsets) > 1 else 0, 1),
        "hit_rate_pct": round(hit_rate, 1),
        "n_landings": len(landings),
    }


# ──────────────────────────────────────────────
# Variabel 2 – Spatial Coverage (yt-användning)
# ──────────────────────────────────────────────

def _spatial_coverage(frames: list[dict], frame_w: int = 1080, frame_h: int = 1920) -> dict:
    """
    Hur stor del av scenen dansaren täcker.

    Mäts via höftmittpunktens rörelsebana, normaliserad mot bildstorlek.
    coverage_pct  – % av scenytan som täcks (konvex hull / total area)
    travel_px     – total distans höften rör sig (px)
    """
    hip_positions: list[tuple[float, float]] = []
    for fr in frames:
        persons = fr.get("persons", [])
        if not persons:
            continue
        p = persons[0]
        lh = _kp(p, "left_hip")
        rh = _kp(p, "right_hip")
        if lh and rh:
            hip_positions.append(_midpoint(lh, rh))

    if len(hip_positions) < 2:
        return {"error": "för få höftpunkter"}

    # Total resa
    travel = sum(_dist(hip_positions[i], hip_positions[i - 1])
                 for i in range(1, len(hip_positions)))

    # Enkel bounding-box coverage (konvex hull kräver scipy)
    xs = [p[0] for p in hip_positions]
    ys = [p[1] for p in hip_positions]
    bbox_area = (max(xs) - min(xs)) * (max(ys) - min(ys))
    total_area = frame_w * frame_h
    coverage_pct = round(bbox_area / total_area * 100, 2)

    return {
        "coverage_pct": coverage_pct,
        "travel_px": round(travel, 1),
        "hip_x_range_px": round(max(xs) - min(xs), 1),
        "hip_y_range_px": round(max(ys) - min(ys), 1),
    }


# ──────────────────────────────────────────────
# Variabel 3 – Arm–Höft Synkronisering
# ──────────────────────────────────────────────

def _arm_hip_sync(frames: list[dict]) -> dict:
    """
    Korrelation mellan armrörelsernas och höftrörelsernas amplitud per beat-period.

    Höga värden → armar och höfter rör sig i takt med varandra (koordination).
    Returnerar Pearson-r (−1..1).
    """
    arm_speeds: list[float] = []
    hip_speeds: list[float] = []

    prev = None
    for fr in frames:
        persons = fr.get("persons", [])
        if not persons:
            prev = None
            continue
        p = persons[0]
        t = fr["time_s"]

        lw = _kp(p, "left_wrist")
        rw = _kp(p, "right_wrist")
        lh = _kp(p, "left_hip")
        rh = _kp(p, "right_hip")

        if prev and all([lw, rw, lh, rh, prev["lw"], prev["rw"], prev["lh"], prev["rh"]]):
            dt = t - prev["t"]
            if dt <= 0:
                prev = {"t": t, "lw": lw, "rw": rw, "lh": lh, "rh": rh}
                continue
            arm_v = (_dist(lw, prev["lw"]) + _dist(rw, prev["rw"])) / (2 * dt)
            hip_v = (_dist(_midpoint(lh, rh), _midpoint(prev["lh"], prev["rh"]))) / dt
            arm_speeds.append(arm_v)
            hip_speeds.append(hip_v)

        prev = {"t": t, "lw": lw, "rw": rw, "lh": lh, "rh": rh}

    if len(arm_speeds) < 10:
        return {"pearson_r": None, "n_frames": len(arm_speeds)}

    # Pearson utan numpy
    n = len(arm_speeds)
    mean_a = statistics.mean(arm_speeds)
    mean_h = statistics.mean(hip_speeds)
    cov = sum((arm_speeds[i] - mean_a) * (hip_speeds[i] - mean_h) for i in range(n)) / n
    std_a = statistics.stdev(arm_speeds)
    std_h = statistics.stdev(hip_speeds)
    r = cov / (std_a * std_h) if std_a > 0 and std_h > 0 else 0.0

    return {"pearson_r": round(r, 3), "n_frames": n}


# ──────────────────────────────────────────────
# Variabel 4 – Kroppens vertikala rytm (bounce)
# ──────────────────────────────────────────────

def _vertical_bounce(frames: list[dict], beats_s: list[float]) -> dict:
    """
    Shuffledans har ett karakteristiskt upp-ner-bounce i takt med musiken.
    Mäter höftmittpunktens vertikala oscillationsfrekvens och jämför med BPM.

    bounce_bpm      – detekterad studsfrekvens i BPM
    bpm_match_ratio – hur nära dansarens bounce är musikens BPM (1.0 = perfekt)
    """
    y_series: list[tuple[float, float]] = []
    for fr in frames:
        persons = fr.get("persons", [])
        if not persons:
            continue
        p = persons[0]
        lh = _kp(p, "left_hip")
        rh = _kp(p, "right_hip")
        if lh and rh:
            y_series.append((fr["time_s"], _midpoint(lh, rh)[1]))

    if len(y_series) < 8:
        return {"bounce_bpm": None, "bpm_match_ratio": None}

    # Räkna toppar (lokala minimum i y = högt uppe i bild)
    ys = [v for _, v in y_series]
    mean_y = statistics.mean(ys)
    peaks = 0
    for i in range(1, len(ys) - 1):
        if ys[i] < ys[i - 1] and ys[i] < ys[i + 1] and ys[i] < mean_y:
            peaks += 1

    duration = y_series[-1][0] - y_series[0][0]
    bounce_bpm = round((peaks / duration) * 60, 1) if duration > 0 else None

    music_bpm = None
    if len(beats_s) > 1:
        intervals = [beats_s[i] - beats_s[i - 1] for i in range(1, len(beats_s))]
        avg_interval = statistics.mean(intervals)
        music_bpm = 60 / avg_interval if avg_interval > 0 else None

    ratio = None
    if bounce_bpm and music_bpm:
        # Tillåt halvtakt (0.5×) och heltakt (1×) och dubbeltakt (2×)
        candidates = [abs(bounce_bpm / music_bpm - r) for r in (0.5, 1.0, 2.0)]
        best_r = [0.5, 1.0, 2.0][candidates.index(min(candidates))]
        ratio = round(1 - min(candidates) / best_r, 3) if best_r > 0 else None

    return {
        "bounce_bpm": bounce_bpm,
        "music_bpm": round(music_bpm, 1) if music_bpm else None,
        "bpm_match_ratio": ratio,
    }


# ──────────────────────────────────────────────
# Variabel 5 – Symmetri (vänster/höger)
# ──────────────────────────────────────────────

def _symmetry_score(frames: list[dict]) -> dict:
    """
    Mäter hur symmetriskt rörelserna är mellan vänster och höger sida.
    Baserat på skillnaden i hastighet mellan vänster/höger arm och ben.

    symmetry_arms   – 0..1, 1 = perfekt symmetri
    symmetry_legs   – 0..1
    """
    arm_diffs: list[float] = []
    leg_diffs: list[float] = []
    prev = None

    for fr in frames:
        persons = fr.get("persons", [])
        if not persons:
            prev = None
            continue
        p = persons[0]
        t = fr["time_s"]
        lw = _kp(p, "left_wrist")
        rw = _kp(p, "right_wrist")
        la = _kp(p, "left_ankle")
        ra = _kp(p, "right_ankle")

        if prev:
            dt = t - prev["t"]
            if dt > 0:
                if lw and rw and prev["lw"] and prev["rw"]:
                    vl = _dist(lw, prev["lw"]) / dt
                    vr = _dist(rw, prev["rw"]) / dt
                    arm_diffs.append(abs(vl - vr) / (vl + vr + 1e-9))
                if la and ra and prev["la"] and prev["ra"]:
                    vl = _dist(la, prev["la"]) / dt
                    vr = _dist(ra, prev["ra"]) / dt
                    leg_diffs.append(abs(vl - vr) / (vl + vr + 1e-9))

        prev = {"t": t, "lw": lw, "rw": rw, "la": la, "ra": ra}

    sym_arms = round(1 - statistics.mean(arm_diffs), 3) if arm_diffs else None
    sym_legs = round(1 - statistics.mean(leg_diffs), 3) if leg_diffs else None

    return {"symmetry_arms": sym_arms, "symmetry_legs": sym_legs}


def _origin_point(frames: list[dict]) -> dict:
    """
    Dansarens 'ursprung' – genomsnittlig höftposition över hela klippet.
    Används som rörelseursprung i visualiseringen.
    """
    hip_positions: list[tuple[float, float]] = []
    for fr in frames:
        persons = fr.get("persons", [])
        if not persons:
            continue
        p = persons[0]
        lh = _kp(p, "left_hip")
        rh = _kp(p, "right_hip")
        if lh and rh:
            hip_positions.append(_midpoint(lh, rh))

    if not hip_positions:
        return {"origin_px": None, "origin_py": None}

    return {
        "origin_px": round(statistics.mean(p[0] for p in hip_positions), 1),
        "origin_py": round(statistics.mean(p[1] for p in hip_positions), 1),
    }

# ──────────────────────────────────────────────
# Huvud-API
# ──────────────────────────────────────────────

def variabel_analys(
    videos: list[str],
    namn: str | None = None,
    skeleton_suffix: str = "_skelett.json",
    beats_suffix: str = "_beats.json",
) -> dict[str, Any]:
    """
    Kör alla variabelanalyser för angivna videor.

    Args:
        videos:          Lista med videostigar (används för att hitta JSON-filer).
        namn:            Om angett, letar efter {namn}_skeleton.json och {namn}_beats.json
                         i samma mapp som videon. Annars används videons stemnamn.
        skeleton_suffix: Suffix för skelettfil  (default: _skelett.json)
        beats_suffix:    Suffix för beatfil     (default: _beats.json)

    Returns:
        Dict med resultat per video + ett aggregerat "summary"-block.
    """
    all_results: dict[str, Any] = {}

    # data/ ligger tre nivåer upp från filen (program/extrahera_data/variabel_analys.py)
    _data_dir = Path(__file__).parent.parent.parent / "data"

    for video_path in videos:
        vp = Path(video_path)
        base_name = namn if namn else vp.stem

        skel_path = _data_dir / "skelett_out" / f"{base_name}{skeleton_suffix}"
        beat_path = _data_dir / "beats_out"   / f"{base_name}{beats_suffix}"


        print(f"Video : {vp.name}")
        print(f"Skelett: {'Found' if skel_path else 'Missing'}")
        print(f"Beats  : {'Found' if beat_path else 'Missing'}")

        # Ladda skelettdata
        if not skel_path.exists():
            print(f"  [!] Hittade inte skelettfil: {skel_path}")
            all_results[str(vp)] = {"error": f"skelettfil saknas: {skel_path}"}
            continue

        skel_data = _load_json(skel_path)
        frames = skel_data.get("frames", skel_data) if isinstance(skel_data, dict) else skel_data

        # Ladda beatdata
        beats_s: list[float] = []
        if beat_path.exists():
            beat_data = _load_json(beat_path)
            raw_beats = beat_data.get("beats", [])
            # Beats kan vara antingen floats eller dicts med "time_s"-nyckel
            beats_s = [
                b["time_s"] if isinstance(b, dict) else float(b)
                for b in raw_beats
            ]
            print(f"  Beats inladdade: {len(beats_s)} st, BPM ≈ {beat_data.get('bpm', '?')}")
        else:
            print(f"  [!] Ingen beatfil – tidsvariabler kan bli begränsade.")

        print(f"  Frames: {len(frames)}")

        # ── Kör variabelanalyserna ──
        results: dict[str, Any] = {}

        results["beat_timing"] = _beat_timing_accuracy(frames, beats_s)
        results["spatial_coverage"] = _spatial_coverage(frames)
        results["arm_hip_sync"] = _arm_hip_sync(frames)
        results["vertical_bounce"] = _vertical_bounce(frames, beats_s)
        results["symmetry"] = _symmetry_score(frames)
        results["origin"] = _origin_point(frames)

        all_results[str(vp)] = results

    # ── Aggregerat summary ──
    summary = _aggregate_summary(all_results)
    all_results["summary"] = summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    _print_result(summary)

    return all_results


def _print_result(d: dict) -> None:
    for k, v in d.items():
        print(f"    {k:30s}: {v}")


def _aggregate_summary(results: dict) -> dict:
    """Aggregerar nyckeltal över alla videos."""
    timing_offsets, coverages, sync_rs, bounce_ratios, sym_arms, sym_legs = [], [], [], [], [], []

    for key, res in results.items():
        if key == "summary" or "error" in res:
            continue
        bt = res.get("beat_timing", {})
        if bt.get("mean_offset_ms") is not None:
            timing_offsets.append(bt["mean_offset_ms"])
        sc = res.get("spatial_coverage", {})
        if sc.get("coverage_pct") is not None:
            coverages.append(sc["coverage_pct"])
        ah = res.get("arm_hip_sync", {})
        if ah.get("pearson_r") is not None:
            sync_rs.append(ah["pearson_r"])
        vb = res.get("vertical_bounce", {})
        if vb.get("bpm_match_ratio") is not None:
            bounce_ratios.append(vb["bpm_match_ratio"])
        sy = res.get("symmetry", {})
        if sy.get("symmetry_arms") is not None:
            sym_arms.append(sy["symmetry_arms"])
        if sy.get("symmetry_legs") is not None:
            sym_legs.append(sy["symmetry_legs"])

    def _avg(lst):
        return round(statistics.mean(lst), 3) if lst else None

    return {
        "avg_beat_offset_ms":   _avg(timing_offsets),
        "avg_coverage_pct":     _avg(coverages),
        "avg_arm_hip_sync_r":   _avg(sync_rs),
        "avg_bounce_match":     _avg(bounce_ratios),
        "avg_symmetry_arms":    _avg(sym_arms),
        "avg_symmetry_legs":    _avg(sym_legs),
        "n_videos":             len(timing_offsets),
    }


# ──────────────────────────────────────────────
# CLI-snabbtest
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Användning: python shuffle_analysis.py video1.mp4 [video2.mp4 ...]")
        print("           (kräver {videonamn}_skeleton.json och {videonamn}_beats.json)")
        sys.exit(0)

    variabel_analys(videos=sys.argv[1:])
"""Where a run reads and writes. The engine holds no project path; every one comes in as an argument.

    --prosjekt  the project config (the krav.yaml shape, template mal/prosjekt.yaml). Relative
                paths in the round config (`kilde`) resolve against the directory it sits in.
    --runde     the round config, one JSON per round (the project's runder/<dato>.json)
    --cache     the measurement cache: bep/<dato>/, struktur/<dato>/, blokker/<dato>/
    --ut        the output directory of the step

What ships with the engine is found next to this file: the standard layer in standard/, the report
treatment in rapport/.
"""
from __future__ import annotations

import argparse
from pathlib import Path

HER = Path(__file__).resolve().parent
STANDARD = HER / "standard"
RAPPORT = HER / "rapport"


def argumenter(ap: argparse.ArgumentParser, ut: bool = True) -> None:
    ap.add_argument("--prosjekt", required=True, type=Path, metavar="KRAV.yaml",
                    help="project config (the krav.yaml shape)")
    ap.add_argument("--runde", required=True, type=Path, metavar="RUNDE.json",
                    help="round config")
    ap.add_argument("--cache", required=True, type=Path, metavar="DIR",
                    help="measurement cache: bep/<dato>/, struktur/<dato>/, blokker/<dato>/")
    if ut:
        ap.add_argument("--ut", required=True, type=Path, metavar="DIR", help="output directory")


def finnes(*stier: Path) -> None:
    for p in stier:
        if not p.exists():
            raise SystemExit(f"FEIL: mangler {p}")


def tabell_sti(navn: str, rot: Path | None) -> Path:
    """A code table named in the config. Absolute: as given. A bare file name that exists in
    standard/: the standard layer's table. Any other relative path: against `rot`, the project
    config's directory. A bare name present in both places is an error, not a choice."""
    p = Path(navn)
    if p.is_absolute():
        return p
    std = STANDARD / p
    if len(p.parts) == 1 and std.exists():
        if rot is not None and (rot / p).exists() and (rot / p).resolve() != std.resolve():
            raise SystemExit(f"FEIL: tabell {navn} finnes både i {STANDARD} og i {rot}")
        return std
    if rot is None:
        raise SystemExit(f"FEIL: tabell {navn} finnes ikke i {STANDARD}")
    return (rot / p).resolve()


def ifc_sti(m: dict, kilde: str, rot: Path, ifc: Path | None = None) -> Path:
    """Where a round model's file lies: in `ifc` when given (the whole round in one folder), else
    in the model's own `kilde` or the round's, relative to `rot` (the project config's directory)."""
    if ifc is not None:
        return ifc / m["fil"]
    return (rot / (m.get("kilde") or kilde)).resolve() / m["fil"]

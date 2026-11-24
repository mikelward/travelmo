#!/usr/bin/env python3
"""Writes the flight changes channel's sound, res/raw/flight_chime.wav.

An original two-note falling chime in the manner of an airport announcement
tone, synthesized here so the app ships nothing it would need a license
for. The output is deterministic: run it again after changing a note and
commit both files.

    python3 apps/android/scripts/flight-chime.py
"""

import math
import pathlib
import struct
import sys
import wave

RATE = 22050
LENGTH = 1.5  # seconds
# Two bell-like notes a major third apart, falling: E6, then C6.
NOTES = [(0.0, 1318.51), (0.42, 1046.50)]
# A bell's partials (multiple of the note, loudness) and how fast it fades.
PARTIALS = [(1.0, 1.0), (2.0, 0.35), (3.0, 0.12), (4.2, 0.05)]
DECAY = 3.2  # per second
ATTACK = 0.006  # seconds, so a note starts without a click
PEAK = 0.7  # of full scale, leaving headroom where the notes overlap

OUT = pathlib.Path(__file__).resolve().parent.parent / "app/src/main/res/raw/flight_chime.wav"


def sample(t: float) -> float:
    total = 0.0
    for start, frequency in NOTES:
        age = t - start
        if age < 0:
            continue
        envelope = min(1.0, age / ATTACK) * math.exp(-DECAY * age)
        for multiple, loudness in PARTIALS:
            total += loudness * envelope * math.sin(2 * math.pi * frequency * multiple * age)
    return total


def main() -> int:
    raw = [sample(i / RATE) for i in range(int(RATE * LENGTH))]
    # Fade the last 50 ms to silence so the end makes no click either.
    fade = int(RATE * 0.05)
    for i in range(fade):
        raw[-1 - i] *= i / fade
    scale = PEAK / max(abs(s) for s in raw)
    frames = b"".join(struct.pack("<h", round(s * scale * 32767)) for s in raw)
    with wave.open(str(OUT), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(frames)
    print(f"Wrote {OUT.name}: {LENGTH} s, {len(frames)} bytes of samples", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

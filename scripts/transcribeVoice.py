"""Read audio from stdin; return a JSON transcript. Never send audio to an API."""
import io
import json
import os
import sys


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    from faster_whisper import WhisperModel

    model = WhisperModel(
        os.environ.get("WHISPER_MODEL", "small"),
        device="cpu",
        compute_type="int8",
        cpu_threads=4,
    )
    if "--prepare" in sys.argv:
        print(json.dumps({"ready": True}))
        return
    audio = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if not audio or len(audio) > 8 * 1024 * 1024:
        raise ValueError("Invalid audio size")
    segments, _ = model.transcribe(
        io.BytesIO(audio),
        language=os.environ.get("WHISPER_LANGUAGE") or None,
        vad_filter=True,
        beam_size=5,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    print(json.dumps({"text": text}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except ImportError:
        print("Install requirements-voice.txt in the selected Python environment", file=sys.stderr)
        sys.exit(2)
    except Exception:
        # No raw errors/audio/URLs in the protocol or logs.
        print("Local transcription failed; check model installation and audio", file=sys.stderr)
        sys.exit(1)

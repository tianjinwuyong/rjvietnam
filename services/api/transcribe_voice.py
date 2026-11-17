"""WMS voice transcription helper: audio file -> text via local faster-whisper (small, CPU int8). No network calls."""
import sys
import json

from faster_whisper import WhisperModel


def main():
    audio_path = sys.argv[1]
    language = sys.argv[2].strip().lower() if len(sys.argv) > 2 else "auto"
    model = WhisperModel("small", device="cpu", compute_type="int8")
    kwargs = {} if language in ("", "auto") else {"language": language}
    segments, info = model.transcribe(audio_path, **kwargs)
    text = "".join(s.text for s in segments).strip()
    print(json.dumps(
        {"text": text, "language": info.language, "duration": round(info.duration, 1)},
        ensure_ascii=False,
    ))


if __name__ == "__main__":
    main()

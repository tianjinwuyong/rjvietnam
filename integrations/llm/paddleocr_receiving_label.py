import json
import os
import sys
import cv2

os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from paddleocr import PaddleOCR

image = cv2.imread(sys.argv[1])
qr_values = []
rotations = []
if image is not None:
    height, width = image.shape[:2]
    scale = min(1.0, 1600.0 / max(height, width))
    if scale < 1.0:
        image = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
    rotations = [
        (0, image),
        (90, cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)),
        (180, cv2.rotate(image, cv2.ROTATE_180)),
        (270, cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)),
    ]
    detector = cv2.QRCodeDetector()
    for _, candidate in rotations:
        try:
            ok, decoded, _, _ = detector.detectAndDecodeMulti(candidate)
            if ok:
                qr_values.extend(str(value).strip() for value in decoded if str(value).strip())
        except Exception:
            pass
        if not qr_values:
            value, _, _ = detector.detectAndDecode(candidate)
            if value.strip():
                qr_values.append(value.strip())

ocr = PaddleOCR(
    lang="ch",
    ocr_version="PP-OCRv5",
    text_detection_model_name="PP-OCRv5_mobile_det",
    text_recognition_model_name="PP-OCRv5_mobile_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=True,
    enable_mkldnn=False,
)

best_lines = []
best_orientation = 0
best_score = -1.0
# CameraX supplies an orientation-correct image. Run the OCR network once;
# four full inference passes made PDA receiving unacceptably slow.
for angle, candidate in [(0, image)]:
    candidate_lines = []
    for result in ocr.predict(candidate):
        data = result.json.get("res", result.json)
        texts = data.get("rec_texts", [])
        scores = data.get("rec_scores", [])
        boxes = data.get("rec_boxes", [])
        for index, text in enumerate(texts):
            value = str(text).strip()
            score = float(scores[index]) if index < len(scores) else 0.0
            if value and score >= 0.45:
                candidate_lines.append({"text": value, "score": score, "box": boxes[index] if index < len(boxes) else None})
    # Prefer the direction that produces the most high-confidence readable text.
    candidate_score = sum(line["score"] for line in candidate_lines) + len(candidate_lines) * 0.5
    if candidate_score > best_score:
        best_score = candidate_score
        best_lines = candidate_lines
        best_orientation = angle

print(json.dumps({"lines": best_lines, "qrValues": list(dict.fromkeys(qr_values)), "orientation": best_orientation}, ensure_ascii=False))

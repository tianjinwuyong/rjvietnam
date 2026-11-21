import sys
import cv2
from rapidocr_onnxruntime import RapidOCR

image = cv2.imread(sys.argv[1])
if image is None:
    raise RuntimeError("unable to read label image")
height, width = image.shape[:2]
scale = min(1.0, 1800.0 / max(height, width))
if scale < 1.0:
    image = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
detector = cv2.QRCodeDetector()
for candidate in (
    image,
    cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE),
    cv2.rotate(image, cv2.ROTATE_180),
    cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE),
):
    value, _, _ = detector.detectAndDecode(candidate)
    if value.strip():
        print("QR_VALUE:" + value.strip())
        break
result, _ = RapidOCR()(image)
for item in result or []:
    text = str(item[1]).strip()
    if text:
        print(text)

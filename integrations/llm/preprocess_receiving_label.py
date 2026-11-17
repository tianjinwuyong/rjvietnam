import sys
import cv2


source, target = sys.argv[1], sys.argv[2]
image = cv2.imread(source)
if image is None:
    raise SystemExit("unable to decode receiving label image")

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
longest = max(gray.shape[:2])
scale = max(1.0, min(4.0, 2800.0 / longest))
gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
gray = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
gray = cv2.GaussianBlur(gray, (0, 0), 0.8)
gray = cv2.addWeighted(gray, 1.8, cv2.GaussianBlur(gray, (0, 0), 2.0), -0.8, 0)
cv2.imwrite(target, gray, [cv2.IMWRITE_PNG_COMPRESSION, 2])

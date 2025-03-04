from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from picamera2 import Picamera2
import time
import cv2
import numpy as np

app = FastAPI()

picam2 = Picamera2()

def initialize_camera():
    config = picam2.create_video_configuration(
        main={"size": (640, 360), "format": "XBGR8888"},
        controls={"FrameDurationLimits": (50000, 50000), "AwbEnable": True, "AeEnable": True, "AfMode": 1}
    )
    picam2.configure(config)
    picam2.start()
    time.sleep(0.3)

initialize_camera()

def generate_frames():
    while True:
        rgb = picam2.capture_array("main")
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
        _, jpeg = cv2.imencode('.jpg', bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 70, int(cv2.IMWRITE_JPEG_OPTIMIZE), 1])
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')

@app.get("/video_feed")
def video_feed():
    return StreamingResponse(generate_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)  # Allows access from other devices


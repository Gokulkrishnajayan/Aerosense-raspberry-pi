from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from picamera2 import Picamera2
import time
import cv2
import numpy as np

app = FastAPI()

# Global camera objects
picam2 = None

def initialize_camera():
    global picam2
    try:
        picam2 = Picamera2()
        print("Camera initialized successfully.")

        # Lower resolution configuration
        config = picam2.create_video_configuration(
            main={
                "size": (640, 360),  # Lower resolution for smoother WiFi streaming
                "format": "XBGR8888"
            },
            controls={
                "FrameDurationLimits": (50000, 50000),  # Limit FPS to ~20
                "AwbEnable": True,
                "AeEnable": True,
                "AfMode": 1
            }
        )
        picam2.configure(config)
        print("Camera configured successfully.")
        
        picam2.start()
        print("Camera started successfully.")
        time.sleep(0.3)
    except Exception as e:
        print(f"Error initializing camera: {e}")
        raise

def generate_frames():
    while True:
        try:
            # Capture frame
            rgb = picam2.capture_array("main")
            
            # Convert to BGR and encode
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
            _, jpeg = cv2.imencode('.jpg', bgr, 
                                  [int(cv2.IMWRITE_JPEG_QUALITY), 70,  # Reduce JPEG quality to 70
                                   int(cv2.IMWRITE_JPEG_OPTIMIZE), 1])
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
        except Exception as e:
            print(f"Frame error: {e}")
            break

@app.get("/video_feed")
def video_feed():
    return StreamingResponse(
        generate_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store, max-age=0",
            "X-Accel-Buffering": "no"
        }
    )

@app.get("/")
def index():
    return """
    <html>
      <head>
        <title>Camera Feed</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
            body {
                margin: 0;
                overflow: hidden;
                background: black;
                height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            #video-feed {
                width: 100vw;
                height: 100vh;
                object-fit: contain;
            }
        </style>
      </head>
      <body>
        <img id="video-feed" src="/video_feed">
      </body>
    </html>
    """

def cleanup():
    global picam2
    if picam2:
        picam2.stop()
        picam2.close()
        print("Camera released")

if __name__ == '__main__':
    try:
        initialize_camera()
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=5000)
    finally:
        cleanup()

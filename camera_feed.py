from flask import Flask, Response
from picamera2 import Picamera2
import time
import io
import threading

app = Flask(__name__)

# Global variables for the camera and a lock
picam2 = None
camera_lock = threading.Lock()

def initialize_camera():
    global picam2
    with camera_lock:
        if picam2 is None:
            picam2 = Picamera2()
            picam2.configure(picam2.create_video_configuration(main={"size": (640, 480)}))
            picam2.start()
            time.sleep(2)  # Camera warm-up time

def generate_frames():
    global picam2
    initialize_camera()

    while True:
        with camera_lock:
            stream = io.BytesIO()
            picam2.capture_file(stream, format='jpeg')
            stream.seek(0)
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + stream.read() + b'\r\n')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/')
def index():
    return """
    <html>
      <head>
        <title>Raspberry Pi Camera Feed</title>
      </head>
      <body>
        <h1>Raspberry Pi Camera Feed</h1>
        <img src="/video_feed" width="640" height="480">
      </body>
    </html>
    """

import atexit

def cleanup():
    global picam2
    if picam2 is not None:
        picam2.stop()
        picam2.close()

atexit.register(cleanup)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
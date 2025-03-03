from flask import Flask, Response
from picamera2 import Picamera2
import time
import io

app = Flask(__name__)

# Global variable for the camera
picam2 = None

def initialize_camera():
    global picam2
    try:
        picam2 = Picamera2()
        print("Camera initialized successfully.")

        # Configure the camera for low latency
        config = picam2.create_video_configuration(
            main={"size": (320, 240)},  # Smaller resolution
            controls={"FrameRate": 15}  # Lower frame rate
        )
        picam2.configure(config)
        print("Camera configured successfully.")

        # Disable auto-focus to reduce latency
        picam2.set_controls({"AfMode": 0})  # AfMode: Manual
        print("Auto-focus disabled.")

        picam2.start()
        print("Camera started successfully.")
        time.sleep(2)  # Camera warm-up time
    except Exception as e:
        print(f"Error initializing camera: {e}")
        raise

def capture_frame():
    global picam2
    try:
        stream = io.BytesIO()
        picam2.capture_file(stream, format='jpeg')  # Use JPEG encoding
        stream.seek(0)
        return stream.read()
    except Exception as e:
        print(f"Error capturing frame: {e}")
        return None

def generate_frames():
    while True:
        frame = capture_frame()
        if frame is not None:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame',
                    headers={"X-Accel-Buffering": "no"})  # Disable buffering

@app.route('/')
def index():
    return """
    <html>
      <head>
        <title>Raspberry Pi Camera Feed</title>
      </head>
      <body>
        <h1>Raspberry Pi Camera Feed</h1>
        <img src="/video_feed" width="320" height="240">
      </body>
    </html>
    """

def cleanup():
    global picam2
    if picam2 is not None:
        print("Stopping and closing the camera.")
        picam2.stop()
        picam2.close()

if __name__ == '__main__':
    try:
        # Initialize the camera
        initialize_camera()

        # Run the Flask app
        app.run(host='0.0.0.0', port=5000, debug=False)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        cleanup()
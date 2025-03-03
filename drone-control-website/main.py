from flask import Flask, Response
import cv2
import time
from picamera2 import Picamera2

import cv2
import mediapipe as mp
import math
import numpy as np
import logging
from collections import deque
from picamera2 import Picamera2

# Initialize Flask app
app = Flask(__name__)

# Initialize Picamera2
picam2 = Picamera2()
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "RGB888"})
picam2.configure(config)
picam2.start()
time.sleep(2)  # Give the camera time to warm up

# Function to Capture Frames and Stream
def generate_frames():
    while True:
        try:
            frame = picam2.capture_array()
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)  # Convert RGB to BGR for OpenCV
            _, buffer = cv2.imencode('.jpg', frame)  # Encode frame as JPEG
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        except Exception as e:
            print(f"Error capturing frame: {e}")
            break

# Route for Video Streaming
@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

# Release Camera on Exit
def release_camera():
    print("\nShutting down...")
    picam2.stop()
    print("Camera released.")

if __name__ == '__main__':
    try:
        print("Server running! Access the video stream at: http://192.168.43.9:5000/video_feed")
        app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
    except KeyboardInterrupt:
        release_camera()

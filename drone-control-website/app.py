from flask import Flask, render_template, Response
from flask_socketio import SocketIO
import asyncio
import random
import cv2
from picamera2 import Picamera2

app = Flask(__name__)
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")

# Simulated drone telemetry
simulated_drone = {
    "lat": 51.5074,
    "lon": -0.1278,
    "alt": 10.0,
    "armed": False
}

# Initialize Pi Camera
picam2 = Picamera2()
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "RGB888"})
picam2.configure(config)
picam2.start()

# Function to generate video frames
def generate_frames():
    while True:
        frame = picam2.capture_array()
        buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()
        
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

# Video feed route
@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

async def telemetry_task():
    while True:
        await asyncio.sleep(0.1)
        simulated_drone["lat"] += random.uniform(-0.0001, 0.0001)
        simulated_drone["lon"] += random.uniform(-0.0001, 0.0001)
        simulated_drone["alt"] += random.uniform(-0.1, 0.1)
        
        socketio.emit('telemetry', {
            'lat': simulated_drone["lat"],
            'lon': simulated_drone["lon"],
            'alt': simulated_drone["alt"],
            'armed': simulated_drone["armed"]
        })

@app.route('/')
def login():
    return render_template('login.html')

@app.route('/controls')
def controls():
    return render_template('controls.html')

@socketio.on('connect')
def handle_connect():
    print("Client connected")
    socketio.start_background_task(telemetry_task)
    socketio.emit('arm', simulated_drone["armed"])

@socketio.on('control')
def handle_control(data):
    print(f"Received control: {data}")
    
    if isinstance(data, dict):
        if data.get('type') == 'keyboard':
            if data.get('code') == 'arm':
                simulated_drone["armed"] = True
                socketio.emit('arm', True)
            elif data.get('code') == 'disarm':
                simulated_drone["armed"] = False
                socketio.emit('arm', False)
                
        elif data.get('type') in ['left-joystick', 'right-joystick']:
            if simulated_drone["armed"]:
                x = data.get('x', 0)
                y = data.get('y', 0)
                print(f"Processing joystick: {data['type']} X:{x} Y:{y}")

    elif isinstance(data, str):
        if data == 'arm':
            simulated_drone["armed"] = True
            socketio.emit('arm', True)
        elif data == 'disarm':
            simulated_drone["armed"] = False
            socketio.emit('arm', False)

if __name__ == '__main__':
    print("Server running! Video feed at: http://<YOUR_PI_IP>:5000/video_feed")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)

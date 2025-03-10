from flask import Flask, render_template, Response, request
from flask_socketio import SocketIO
import asyncio
import random
import cv2
import threading
import time
import logging
import os
from picamera2 import Picamera2
import numpy as np

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")

# Simulated drone telemetry
simulated_drone = {
    "lat": 51.5074,
    "lon": -0.1278,
    "alt": 10.0,
    "armed": False,
    "battery": 85,
    "signal": 98
}

# Get the host IP address for use in templates
def get_host_ip():
    # For development use the local IP, in production this should be the public/LAN IP
    import socket
    hostname = socket.gethostname()
    ip_address = socket.gethostbyname(hostname)
    return ip_address

# Initialize Pi Camera and frame handling
frame = None
lock = threading.Lock()
picam2 = None

def initialize_camera():
    global picam2, frame
    try:
        picam2 = Picamera2()
        config = picam2.create_video_configuration(
            main={"size": (640, 360), "format": "XRGB8888"},
            lores={"size": (320, 180), "format": "YUV420"},
            controls={"FrameDurationLimits": (33333, 33333), "AwbEnable": True, "AeEnable": True}
        )
        picam2.configure(config)
        picam2.start()
        logger.info("Camera initialized successfully")
        
        # Wait for camera to warm up
        time.sleep(2)
        
        # Capture an initial frame to avoid NoneType issues
        rgb = picam2.capture_array("main")
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
        _, jpeg = cv2.imencode('.jpg', bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        
        with lock:
            frame = jpeg.tobytes()  # Set an initial frame
            
        logger.info("Initial frame captured")
        return True
    except Exception as e:
        logger.error(f"Camera initialization failed: {e}", exc_info=True)
        return False

# Capture frames in a background thread
def capture_frames():
    global frame, picam2
    logger.info("Frame capture thread started")
    
    frame_count = 0
    start_time = time.time()
    
    while True:
        try:
            rgb = picam2.capture_array("main")
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
            
            # Add timestamp to frame
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            cv2.putText(bgr, timestamp, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 
                        0.7, (255, 255, 255), 2, cv2.LINE_AA)
            
            # Add telemetry overlay
            cv2.putText(bgr, f"Alt: {simulated_drone['alt']:.1f}m", (10, bgr.shape[0] - 10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1, cv2.LINE_AA)
            
            _, jpeg = cv2.imencode('.jpg', bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 70])

            with lock:
                frame = jpeg.tobytes()
            
            # Calculate FPS every 100 frames
            frame_count += 1
            if frame_count % 100 == 0:
                end_time = time.time()
                fps = 100 / (end_time - start_time)
                logger.info(f"Current FPS: {fps:.2f}")
                start_time = time.time()
                
            time.sleep(0.033)  # ~30 FPS
        except Exception as e:
            logger.error(f"Error capturing frame: {e}", exc_info=True)
            time.sleep(0.5)  # Pause briefly before retrying

# Generate frames for streaming
def generate_frames():
    global frame
    while True:
        with lock:
            current_frame = frame
            
        if current_frame:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + current_frame + b'\r\n')
        else:
            # If no frame is available, send a blank black frame
            blank = np.zeros((360, 640, 3), dtype=np.uint8)
            _, jpeg = cv2.imencode('.jpg', blank)
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
                   
        time.sleep(0.033)  # ~30 FPS

# Video feed route
@app.route('/video_feed')
def video_feed():
    return Response(
        generate_frames(), 
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )

# Debug route for video feed
@app.route('/debug_video')
def debug_video():
    global frame
    with lock:
        current_frame = frame
    
    if current_frame:
        return f"""
        <html>
        <head>
            <title>Video Feed Debug</title>
            <style>
                body {{ font-family: Arial, sans-serif; text-align: center; }}
            </style>
        </head>
        <body>
            <h1>Video Feed Debug</h1>
            <p>The video feed is working. You should see the image below:</p>
            <img src="/video_feed" alt="Video Feed">
            <p>Frame size: {len(current_frame)} bytes</p>
        </body>
        </html>
        """
    else:
        return f"""
        <html>
        <head>
            <title>Video Feed Debug</title>
            <style>
                body {{ font-family: Arial, sans-serif; text-align: center; }}
            </style>
        </head>
        <body>
            <h1>Video Feed Debug</h1>
            <p style="color: red">NO FRAMES AVAILABLE!</p>
            <p>Camera may not be initialized correctly.</p>
        </body>
        </html>
        """

async def telemetry_task():
    while True:
        await asyncio.sleep(0.1)
        simulated_drone["lat"] += random.uniform(-0.0001, 0.0001)
        simulated_drone["lon"] += random.uniform(-0.0001, 0.0001)
        simulated_drone["alt"] += random.uniform(-0.1, 0.1)
        simulated_drone["battery"] = max(0, min(100, simulated_drone["battery"] + random.uniform(-0.05, 0.01)))
        simulated_drone["signal"] = max(0, min(100, simulated_drone["signal"] + random.uniform(-0.5, 0.5)))
        
        socketio.emit('telemetry', {
            'lat': simulated_drone["lat"],
            'lon': simulated_drone["lon"],
            'alt': simulated_drone["alt"],
            'armed': simulated_drone["armed"],
            'battery': simulated_drone["battery"],
            'signal': simulated_drone["signal"]
        })

@app.route('/')
def login():
    return render_template('login.html')

@app.route('/controls')
def controls():
    # Pass the host IP to the template for video feed URL
    host_ip = get_host_ip()
    port = request.host.split(':')[1] if ':' in request.host else '5000'
    return render_template('controls.html', host_ip=host_ip, port=port)

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
            elif data.get('code') == 'takeoff' and simulated_drone["armed"]:
                # Implement takeoff logic here
                print("Takeoff command received")
                socketio.emit('status', "Taking off...")
            elif data.get('code') == 'land' and simulated_drone["armed"]:
                # Implement landing logic here
                print("Land command received")
                socketio.emit('status', "Landing...")
                
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
        elif data == 'takeoff' and simulated_drone["armed"]:
            socketio.emit('status', "Taking off...")
        elif data == 'land' and simulated_drone["armed"]:
            socketio.emit('status', "Landing...")

@app.route('/healthcheck')
def healthcheck():
    camera_ok = frame is not None
    uptime = time.time() - startup_time if 'startup_time' in globals() else 0
    return {
        "status": "healthy" if camera_ok else "unhealthy",
        "camera": "connected" if camera_ok else "disconnected",
        "uptime": uptime,
        "frame_available": camera_ok
    }

if __name__ == '__main__':
    print("Initializing system...")
    
    # Record startup time
    startup_time = time.time()
    
    # Try to initialize camera
    camera_ready = initialize_camera()
    
    if camera_ready:
        # Start frame capture thread
        camera_thread = threading.Thread(target=capture_frames, daemon=True)
        camera_thread.start()
        print("Camera initialized successfully")
    else:
        print("WARNING: Camera initialization failed - continuing without camera")
    
    host_ip = get_host_ip()
    print(f"Server running! Access the web interface at: http://{host_ip}:5000")
    print(f"Video feed will be available at: http://{host_ip}:5000/video_feed")
    print(f"Debug video page available at: http://{host_ip}:5000/debug_video")
    
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
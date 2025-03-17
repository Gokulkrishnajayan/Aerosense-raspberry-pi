import subprocess
from flask import Flask, render_template, Response, request
from flask_socketio import SocketIO
import random
import time
import logging
import threading
import os
import eventlet
import atexit

# Global variable to store the AI process
ai_process = None

# SSL Certificate Paths
ssl_key = "/home/GokulDragon/ssl/key.pem"
ssl_cert = "/home/GokulDragon/ssl/cert.pem"

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
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Connect to a public IP to get the correct interface
        s.connect(("8.8.8.8", 80))
        ip_address = s.getsockname()[0]
    except:
        ip_address = socket.gethostbyname(socket.gethostname())
    finally:
        s.close()
    return ip_address

# Synchronous telemetry task
def telemetry_task():
    while True:
        time.sleep(0.1)  # Simulate a delay
        simulated_drone["lat"] += random.uniform(-0.0001, 0.0001)
        simulated_drone["lon"] += random.uniform(-0.0001, 0.0001)
        simulated_drone["alt"] += random.uniform(-0.1, 0.1)
        simulated_drone["battery"] = max(0, min(100, simulated_drone["battery"] + random.uniform(-0.05, 0.01)))
        simulated_drone["signal"] = max(0, min(100, simulated_drone["signal"] + random.uniform(-0.5, 0.5)))
        
        # Emit telemetry data to all clients
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
    # Pass the FastAPI server URL to the template
    host_ip = get_host_ip()
    return render_template('controls.html', fastapi_url=f"https://{host_ip}:8000")

@socketio.on('connect')
def handle_connect():
    print("Client connected")
    # Start the telemetry task in a background thread
    threading.Thread(target=telemetry_task, daemon=True).start()
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
                print("Takeoff command received")
                socketio.emit('status', "Taking off...")
            elif data.get('code') == 'land' and simulated_drone["armed"]:
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


@socketio.on('mode')
def handle_mode_change(mode):
    global ai_process

    if mode == "ai":
        if ai_process is None:
            print("Starting AI Control...")
            ai_process = subprocess.Popen(["python3", "drone.py"])
    else:
        if ai_process is not None:
            print("Stopping AI Control...")
            socketio.emit('stop_ai')  # Send stop signal to drone.py
            ai_process.terminate()
            ai_process = None

def cleanup():
    global ai_process
    if ai_process and ai_process.poll() is None:  # Ensure it's running before killing
        ai_process.terminate()
        ai_process.wait()
        ai_process = None

atexit.register(cleanup)


if __name__ == '__main__':
    print("Initializing system...")

    # Check if SSL files exist before starting the server
    if not os.path.exists(ssl_key) or not os.path.exists(ssl_cert):
        print("❌ ERROR: SSL certificate or key file not found!")
        exit(1)

    host_ip = get_host_ip()
    print(f"🔹 Server running! Access it at: **https://{host_ip}:5000**")

    # Run Flask with SSL using eventlet (supports WebSockets)
    eventlet.wsgi.server(
        eventlet.wrap_ssl(eventlet.listen(('0.0.0.0', 5000)),
                          certfile=ssl_cert,
                          keyfile=ssl_key,
                          server_side=True),app
    )
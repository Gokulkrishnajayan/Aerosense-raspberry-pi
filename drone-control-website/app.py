from flask import Flask, render_template, Response, request
from flask_socketio import SocketIO
import random
import time
import logging
import threading

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
    hostname = socket.gethostname()
    ip_address = socket.gethostbyname(hostname)
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
    return render_template('controls.html', fastapi_url=f"http://{host_ip}:8000")

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

if __name__ == '__main__':
    print("Initializing system...")
    
    host_ip = get_host_ip()
    print(f"Server running! Access the web interface at: http://{host_ip}:5000")
    
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
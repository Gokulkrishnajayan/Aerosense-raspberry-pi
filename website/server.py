from flask import Flask, render_template
from flask_socketio import SocketIO
import ssl
import eventlet

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('gesture_command')
def handle_gesture_command(data):
    print(f"Received Gesture Command: {data['command']}")  # Show gesture output in Raspberry Pi terminal

if __name__ == '__main__':
    # SSL Certificate Paths
    ssl_key = "/home/GokulDragon/ssl/key.pem"
    ssl_cert = "/home/GokulDragon/ssl/cert.pem"
    # Run Flask with SSL using eventlet (supports WebSockets)
    eventlet.wsgi.server(eventlet.wrap_ssl(eventlet.listen(('0.0.0.0', 5000)),
    certfile=ssl_cert,keyfile=ssl_key,server_side=True),app)
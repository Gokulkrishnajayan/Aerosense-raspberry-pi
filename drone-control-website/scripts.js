// Login Page
document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    // Hardcoded credentials for demo
    if (username === 'admin' && password === 'password') {
        window.location.href = 'main.html';
    } else {
        document.getElementById('errorMessage').textContent = 'Invalid username or password';
    }
});

// Main Page
if (window.location.pathname.endsWith('main.html')) {
    const connectButton = document.getElementById('connectButton');
    const connectionStatus = document.getElementById('connectionStatus');

    connectButton.addEventListener('click', function () {
        // Simulate connection to drone
        connectionStatus.textContent = 'Status: Connected';
        connectButton.disabled = true;
    });
}

// Control Interface
if (window.location.pathname.endsWith('control.html')) {
    const videoFeed = document.getElementById('videoFeed');
    const takeoffButton = document.getElementById('takeoffButton');
    const landButton = document.getElementById('landButton');
    const emergencyButton = document.getElementById('emergencyButton');

    // WebSocket connection to Raspberry Pi
    const socket = new WebSocket('ws://YOUR_PI_IP:5000');

    socket.onopen = function () {
        console.log('WebSocket connection established');
    };

    socket.onmessage = function (event) {
        console.log('Message from server:', event.data);
    };

    // Video Streaming (WebRTC)
    const pc = new RTCPeerConnection();

    pc.ontrack = function (event) {
        videoFeed.srcObject = event.streams[0];
    };

    fetch('http://YOUR_PI_IP:8080/offer', {
        method: 'POST',
        body: JSON.stringify({
            sdp: pc.localDescription.sdp,
            type: pc.localDescription.type
        })
    });

    // Drone Controls
    takeoffButton.addEventListener('click', function () {
        socket.send(JSON.stringify({ cmd: 'takeoff', params: { altitude: 5 } }));
    });

    landButton.addEventListener('click', function () {
        socket.send(JSON.stringify({ cmd: 'land' }));
    });

    emergencyButton.addEventListener('click', function () {
        socket.send(JSON.stringify({ cmd: 'emergency' }));
    });

    // Keyboard Controls
    document.addEventListener('keydown', function (event) {
        switch (event.key) {
            case 'ArrowUp':
                socket.send(JSON.stringify({ cmd: 'move', params: { direction: 'forward', speed: 1 } }));
                break;
            case 'ArrowDown':
                socket.send(JSON.stringify({ cmd: 'move', params: { direction: 'backward', speed: 1 } }));
                break;
            case 'ArrowLeft':
                socket.send(JSON.stringify({ cmd: 'move', params: { direction: 'left', speed: 1 } }));
                break;
            case 'ArrowRight':
                socket.send(JSON.stringify({ cmd: 'move', params: { direction: 'right', speed: 1 } }));
                break;
        }
    });
}

document.addEventListener("DOMContentLoaded", function () {
    const video = document.getElementById("videoStream");
    video.src = "http://192.168.5.198:8000/video_feed"; // Replace with Pi IP
});

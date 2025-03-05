// // Login Page
// document.getElementById('loginForm').addEventListener('submit', function (e) {
//     e.preventDefault();
//     const username = document.getElementById('username').value;
//     const password = document.getElementById('password').value;

//     // Hardcoded credentials for demo
//     if (username === 'admin' && password === 'password') {
//         window.location.href = 'main.html';
//     } else {
//         document.getElementById('errorMessage').textContent = 'Invalid username or password';
//     }
// });

// // Main Page
// if (window.location.pathname.endsWith('main.html')) {
//     const connectButton = document.getElementById('connectButton');
//     const connectionStatus = document.getElementById('connectionStatus');

//     connectButton.addEventListener('click', function () {
//         // Simulate connection to drone
//         connectionStatus.textContent = 'Status: Connected';
//         connectButton.disabled = true;
//     });
// }

// // Control Interface
// if (window.location.pathname.endsWith('control.html')) {
//     const videoFeed = document.getElementById('videoFeed');
//     const takeoffButton = document.getElementById('takeoffButton');
//     const landButton = document.getElementById('landButton');
//     const emergencyButton = document.getElementById('emergencyButton');

//     // WebSocket connection to Raspberry Pi
//     const socket = new WebSocket('ws://192.168.5.198:5000');

//     socket.onopen = function () {
//         console.log('WebSocket connection established');
//     };

//     socket.onmessage = function (event) {
//         console.log('Message from server:', event.data);
//     };

//     // Video Streaming (WebRTC)
//     const pc = new RTCPeerConnection();

//     pc.ontrack = function (event) {
//         videoFeed.srcObject = event.streams[0];
//     };

//     fetch('http://192.168.5.198:8080/offer', {
//         method: 'POST',
//         body: JSON.stringify({
//             sdp: pc.localDescription.sdp,
//             type: pc.localDescription.type
//         })
//     });

//     // Drone Controls
//     takeoffButton.addEventListener('click', function () {
//         socket.send(JSON.stringify({ cmd: 'takeoff', params: { altitude: 5 } }));
//     });

//     landButton.addEventListener('click', function () {
//         socket.send(JSON.stringify({ cmd: 'land' }));
//     });

//     emergencyButton.addEventListener('click', function () {
//         socket.send(JSON.stringify({ cmd: 'emergency' }));
//     });

//     // Keyboard Controls
//     document.addEventListener('keydown', function (event) {
//         switch (event.key) {
//             case 'ArrowUp':
//                 socket.send(JSON.stringify({ cmd: 'move', params: { direction: 'forward', speed: 1 } }));
//                 break;
//             case 'ArrowDown':
//                 socket.send(JSON.stringify({ cmd: 'move', params: { direction: 'backward', speed: 1 } }));
//                 break;
//             case 'ArrowLeft':
//                 socket.send(JSON.stringify({ cmd: 'move', params: { direction: 'left', speed: 1 } }));
//                 break;
//             case 'ArrowRight':
//                 socket.send(JSON.stringify({ cmd: 'move', params: { direction: 'right', speed: 1 } }));
//                 break;
//         }
//     });
// }

const socket = io();
let lastCommand = Date.now();
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const activeCommands = new Set();
const commandDisplay = document.getElementById('command-display');
const activeCommandsSpan = document.getElementById('active-commands');
const armStatus = document.getElementById('arm-status');

function init() {
    // Add touch-device class to body if it's a touch device
    if (isTouchDevice) {
        document.body.classList.add('touch-device');
    }

    // Request fullscreen on user interaction
    document.addEventListener('click', requestFullscreen);
    document.addEventListener('touchstart', requestFullscreen);

    // Lock orientation (works on some browsers)
    lockOrientation();

    // Initialize controls based on device type
    if (isTouchDevice) {
        // Initialize joysticks for touch devices
        setupJoystick('left-joystick', (x, y) => {
            socket.emit('control', { type: 'left-joystick', x, y });
        }, { selfCenterX: true, selfCenterY: false });

        setupJoystick('right-joystick', (x, y) => {
            socket.emit('control', { type: 'right-joystick', x, y });
        }, { selfCenterX: true, selfCenterY: true });
    } else {
        // Initialize keyboard controls for non-touch devices
        setupKeyboardControls();
    }

    // Initialize telemetry
    socket.on('telemetry', updateTelemetry);
}

function setupKeyboardControls() {
    document.addEventListener('keydown', handleKeyboardControls);
    document.addEventListener('keyup', stopControls);
}

function updateCommandDisplay() {
    const commands = Array.from(activeCommands);
    activeCommandsSpan.innerHTML = commands.map(cmd =>
        `<span class="active-command">${cmd}</span>`
    ).join('');
    commandDisplay.style.display = commands.length ? 'block' : 'none';
}

function handleKeyboardControls(e) {
    if (Date.now() - lastCommand < 50) return;
    lastCommand = Date.now();

    const commandMap = {
        87: { cmd: '↑ Throttle Up', code: 'up' },
        83: { cmd: '↓ Throttle Down', code: 'down' },
        65: { cmd: '← Left', code: 'left' },
        68: { cmd: '→ Right', code: 'right' },
        38: { cmd: '↑ Pitch Forward', code: 'forward' },
        40: { cmd: '↓ Pitch Backward', code: 'backward' },
        32: { cmd: 'Arm', code: 'arm' },
        27: { cmd: 'Disarm', code: 'disarm' }
    };

    const commandInfo = commandMap[e.keyCode];
    if (commandInfo) {
        activeCommands.add(commandInfo.cmd);
        updateCommandDisplay();

        if (typeof commandInfo === 'object') {
            socket.emit('control', { type: 'keyboard', ...commandInfo });
        }
        e.preventDefault();
    }
}

function stopControls() {
    activeCommands.clear();
    updateCommandDisplay();
    socket.emit('control', { type: 'keyboard', x: 0, y: 0 });
}

function setupJoystick(id, callback, options = { selfCenterX: true, selfCenterY: true }) {
    const joystick = document.getElementById(id);
    const handle = joystick.querySelector('.joystick-handle');
    const maxDistance = 30;
    let touchId = null;
    let lastX = 0;
    let lastY = 0;

    // Scale factor to convert [-1, 1] to [-10, 10]
    const scaleFactor = -10;

    function getCenter() {
        const rect = joystick.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }

    function handleMove(touch) {
        const center = getCenter();
        const rawX = touch.clientX - center.x;
        const rawY = touch.clientY - center.y;
        const distance = Math.sqrt(rawX * rawX + rawY * rawY);

        // Calculate actual position without capping
        const angle = Math.atan2(rawY, rawX);
        const effectiveDistance = Math.min(distance, maxDistance);

        // Store actual normalized values (even beyond max)
        const normalizedX = rawX / maxDistance;
        const normalizedY = rawY / maxDistance;

        // Visual position (capped at max distance)
        handle.style.transform = `translate(
                    ${Math.cos(angle) * effectiveDistance}px, 
                    ${Math.sin(angle) * effectiveDistance}px
                )`;

        // Store actual values (may be >1 or <-1)
        lastX = normalizedX;
        lastY = normalizedY;

        // Scale values to [-10, 10] range
        const scaledX = Math.min(Math.max(normalizedX, -1), 1) * scaleFactor;
        const scaledY = Math.min(Math.max(normalizedY, -1), 1) * scaleFactor;

        callback(scaledX, scaledY);
    }

    function resetHandle() {
        // Cap values to [-1, 1] range
        const cappedX = Math.min(Math.max(lastX, -1), 1);
        const cappedY = Math.min(Math.max(lastY, -1), 1);

        if (options.selfCenterX) lastX = 0;
        if (options.selfCenterY) lastY = 0;

        const effectiveX = options.selfCenterX ? 0 : cappedX;
        const effectiveY = options.selfCenterY ? 0 : cappedY;

        const angle = Math.atan2(effectiveY, effectiveX);
        const distance = Math.sqrt(effectiveX * effectiveX + effectiveY * effectiveY);

        handle.style.transform = `translate(
                    ${Math.cos(angle) * distance * maxDistance}px, 
                    ${Math.sin(angle) * distance * maxDistance}px
                )`;

        // Scale values to [-10, 10] range
        const scaledX = effectiveX * scaleFactor;
        const scaledY = effectiveY * scaleFactor;

        callback(scaledX, scaledY);
    }

    joystick.addEventListener('touchstart', e => {
        if (!touchId) {
            touchId = e.changedTouches[0].identifier;
            handleMove(e.changedTouches[0]);
        }
    }, { passive: false });

    joystick.addEventListener('touchmove', e => {
        if (touchId !== null) {
            const touch = Array.from(e.touches).find(t => t.identifier === touchId);
            if (touch) {
                handleMove(touch);
                e.preventDefault();
            }
        }
    }, { passive: false });

    joystick.addEventListener('touchend', e => {
        if (touchId !== null) {
            resetHandle();
            touchId = null;
        }
    });
}

function requestFullscreen() {
    try {
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.mozRequestFullScreen) { /* Firefox */
            elem.mozRequestFullScreen();
        } else if (elem.webkitRequestFullscreen) { /* Chrome, Safari & Opera */
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) { /* IE/Edge */
            elem.msRequestFullscreen();
        }
    } catch (e) {
        console.log("Fullscreen failed:", e);
    }
}

function lockOrientation() {
    try {
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape');
        } else if (window.screen.lockOrientation) {
            window.screen.lockOrientation('landscape');
        }
    } catch (e) {
        console.log("Orientation lock failed:", e);
    }
}

function updateTelemetry(data) {
    document.getElementById('telemetry').innerHTML =
        `Lat: ${data.lat.toFixed(6)} | Lon: ${data.lon.toFixed(6)} | Alt: ${data.alt.toFixed(1)}m | `;

    if (data.armed) {
        armStatus.textContent = 'Arm';
        armStatus.classList.add('armed');
    } else {
        armStatus.textContent = 'Disarm';
        armStatus.classList.remove('armed');
    }
}

// Listen for arm/disarm responses
socket.on('arm', (armed) => {
    if (armed) {
        armStatus.textContent = 'Arm';
        armStatus.classList.add('armed');
    } else {
        armStatus.textContent = 'Disarm';
        armStatus.classList.remove('armed');
    }
});


document.addEventListener("DOMContentLoaded", function () {
    const videoStream = document.getElementById("videoStream");
    // Reload the image every second to ensure smooth updates
    setInterval(() => {
        videoStream.src = "http://192.168.5.198:8000/video_feed?t=" + new Date().getTime();
    }, 1000); // Refresh every second
});

document.addEventListener("DOMContentLoaded", function () {
    const videoStream = document.getElementById("videoStream");
    const body = document.body;

    // Create a "No Video Feed" message
    const noVideoMessage = document.createElement("div");
    noVideoMessage.classList.add("no-video-message");
    noVideoMessage.textContent = "No Video Feed Available";
    document.body.appendChild(noVideoMessage);

    function checkVideoStatus() {
        fetch(videoStream.src, { method: "HEAD" })
            .then(response => {
                if (!response.ok) throw new Error("Video not available");

                // Video is working, remove no-video styles
                body.classList.remove("no-video");
                noVideoMessage.style.display = "none";
            })
            .catch(() => {
                // Video is not working, change background and show message
                body.classList.add("no-video");
                noVideoMessage.style.display = "block";
            });
    }

    // Check video status every 5 seconds
    setInterval(checkVideoStatus, 3000);
});

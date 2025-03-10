// Global variables
const socket = io();
let lastCommand = Date.now();
// Improved touch detection
const isTouchDevice = () => {
    return (
        ('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0) ||
        (navigator.msMaxTouchPoints > 0) ||
        (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))
    );
};

function init() {
    // Check if it's a touch device
    const touchDevice = isTouchDevice();
    setTimeout(updateDebugPanel, 2000);
    
    // Add touch-device class to body if it's a touch device
    if (touchDevice) {
        document.body.classList.add('touch-device');
        console.log("Touch device detected");
        
        // Initialize joysticks only for touch devices
        setupJoystick('left-joystick', (x, y) => {
            socket.emit('control', { type: 'left-joystick', x, y });
        }, { selfCenterX: true, selfCenterY: false });

        setupJoystick('right-joystick', (x, y) => {
            socket.emit('control', { type: 'right-joystick', x, y });
        }, { selfCenterX: true, selfCenterY: true });
        
        // Make joysticks visible explicitly
        document.getElementById('joystick-container').style.display = 'block';
    } else {
        // Hide joystick container explicitly
        document.getElementById('joystick-container').style.display = 'none';
        console.log("Desktop device detected");
        // Initialize keyboard controls for non-touch devices
        setupKeyboardControls();
        // Show keyboard info
        document.getElementById('keyboard-controls').style.display = 'block';
    }

    // Initialize button handlers
    setupButtonHandlers();

    // Initialize socket handlers
    setupSocketHandlers();
    
    // Start connection monitoring
    startConnectionMonitoring();
}

function setupButtonHandlers() {
    const takeoffButton = document.getElementById('takeoffButton');
    const landButton = document.getElementById('landButton');
    const emergencyButton = document.getElementById('emergencyButton');
    
    if (takeoffButton) {
        takeoffButton.addEventListener('click', () => {
            socket.emit('control', 'takeoff');
            showStatusMessage('Taking off...');
        });
    }
    
    if (landButton) {
        landButton.addEventListener('click', () => {
            socket.emit('control', 'land');
            showStatusMessage('Landing...');
        });
    }
    
    if (emergencyButton) {
        emergencyButton.addEventListener('click', () => {
            socket.emit('control', 'disarm');
            showStatusMessage('EMERGENCY STOP!');
        });
    }
}

function showStatusMessage(message) {
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
        statusMessage.textContent = message;
        statusMessage.style.opacity = 1;
        
        setTimeout(() => {
            statusMessage.style.opacity = 0;
        }, 3000);
    }
}

function setupKeyboardControls() {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
}

function handleKeyDown(e) {
    if (Date.now() - lastCommand < 50) return;
    lastCommand = Date.now();

    // Key mappings
    const keyActions = {
        // Arm/Disarm
        ' ': { cmd: 'Arm', code: 'arm' },
        'Escape': { cmd: 'Disarm', code: 'disarm' },
        // Takeoff/Land
        't': { cmd: 'Takeoff', code: 'takeoff' },
        'l': { cmd: 'Land', code: 'land' },
        // Throttle/Yaw (left joystick)
        'w': { cmd: '↑ Throttle Up', code: 'throttle_up' },
        's': { cmd: '↓ Throttle Down', code: 'throttle_down' },
        'a': { cmd: '← Yaw Left', code: 'yaw_left' },
        'd': { cmd: '→ Yaw Right', code: 'yaw_right' },
        // Pitch/Roll (right joystick)
        'ArrowUp': { cmd: '↑ Pitch Forward', code: 'pitch_forward' },
        'ArrowDown': { cmd: '↓ Pitch Backward', code: 'pitch_backward' },
        'ArrowLeft': { cmd: '← Roll Left', code: 'roll_left' },
        'ArrowRight': { cmd: '→ Roll Right', code: 'roll_right' }
    };

    const key = e.key;
    if (keyActions[key]) {
        activeCommands.add(keyActions[key].cmd);
        updateCommandDisplay();
        socket.emit('control', { type: 'keyboard', code: keyActions[key].code });
        e.preventDefault();
    }
}

function handleKeyUp(e) {
    // Key mappings - same as in handleKeyDown
    const keyActions = {
        ' ': { cmd: 'Arm', code: 'arm' },
        'Escape': { cmd: 'Disarm', code: 'disarm' },
        't': { cmd: 'Takeoff', code: 'takeoff' },
        'l': { cmd: 'Land', code: 'land' },
        'w': { cmd: '↑ Throttle Up', code: 'throttle_up' },
        's': { cmd: '↓ Throttle Down', code: 'throttle_down' },
        'a': { cmd: '← Yaw Left', code: 'yaw_left' },
        'd': { cmd: '→ Yaw Right', code: 'yaw_right' },
        'ArrowUp': { cmd: '↑ Pitch Forward', code: 'pitch_forward' },
        'ArrowDown': { cmd: '↓ Pitch Backward', code: 'pitch_backward' },
        'ArrowLeft': { cmd: '← Roll Left', code: 'roll_left' },
        'ArrowRight': { cmd: '→ Roll Right', code: 'roll_right' }
    };

    const key = e.key;
    if (keyActions[key]) {
        activeCommands.delete(keyActions[key].cmd);
        updateCommandDisplay();
        // Optionally send a 'stop' command for this control
        socket.emit('control', { type: 'keyboard', code: 'stop_' + keyActions[key].code });
    }
}

function updateCommandDisplay() {
    const commandDisplay = document.getElementById('command-display');
    const activeCommandsSpan = document.getElementById('active-commands');
    
    if (commandDisplay && activeCommandsSpan) {
        const commands = Array.from(activeCommands);
        activeCommandsSpan.innerHTML = commands.map(cmd =>
            `<span class="active-command">${cmd}</span>`
        ).join('');
        commandDisplay.style.display = commands.length ? 'block' : 'none';
    }
}

function setupJoystick(id, callback, options = { selfCenterX: true, selfCenterY: true }) {
    const joystick = document.getElementById(id);
    if (!joystick) return;
    
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

    function handleMove(clientX, clientY) {
        const center = getCenter();
        const rawX = clientX - center.x;
        const rawY = clientY - center.y;
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

    // Touch events
    joystick.addEventListener('touchstart', e => {
        e.preventDefault(); // Prevent scrolling
        if (!touchId) {
            touchId = e.changedTouches[0].identifier;
            handleMove(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        }
    }, { passive: false });

    joystick.addEventListener('touchmove', e => {
        e.preventDefault(); // Prevent scrolling
        if (touchId !== null) {
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === touchId) {
                    handleMove(e.touches[i].clientX, e.touches[i].clientY);
                    break;
                }
            }
        }
    }, { passive: false });

    joystick.addEventListener('touchend', e => {
        e.preventDefault(); // Prevent default behavior
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === touchId) {
                resetHandle();
                touchId = null;
                break;
            }
        }
    }, { passive: false });

    // Also add mouse events for testing on desktop
    let mouseDown = false;
    
    joystick.addEventListener('mousedown', e => {
        mouseDown = true;
        handleMove(e.clientX, e.clientY);
    });
    
    document.addEventListener('mousemove', e => {
        if (mouseDown) {
            handleMove(e.clientX, e.clientY);
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (mouseDown) {
            mouseDown = false;
            resetHandle();
        }
    });
}

function setupSocketHandlers() {
    // Listen for telemetry updates
    socket.on('telemetry', updateTelemetry);
    
    // Listen for arm/disarm status
    socket.on('arm', updateArmStatus);
    
    // Listen for status messages
    socket.on('status', showStatusMessage);
    
    // Handle connection events
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
}

function updateTelemetry(data) {
    // Update telemetry display with data from server
    document.getElementById('lat-value').textContent = data.lat.toFixed(6);
    document.getElementById('lon-value').textContent = data.lon.toFixed(6);
    document.getElementById('alt-value').textContent = data.alt.toFixed(1);
    document.getElementById('battery-value').textContent = Math.round(data.battery);
    document.getElementById('signal-value').textContent = Math.round(data.signal);
    
    // Update arm status
    updateArmStatus(data.armed);
}

function updateArmStatus(armed) {
    const armStatus = document.getElementById('arm-status');
    if (armStatus) {
        if (armed) {
            armStatus.textContent = 'Armed';
            armStatus.className = 'status-armed';
        } else {
            armStatus.textContent = 'Disarmed';
            armStatus.className = 'status-disarmed';
        }
    }
}

function handleConnect() {
    console.log('Connected to server');
    hideConnectionModal();
}

function handleDisconnect() {
    console.log('Disconnected from server');
    showConnectionModal();
}

function showConnectionModal() {
    const modal = document.getElementById('connection-modal');
    if (modal) modal.style.display = 'flex';
}

function hideConnectionModal() {
    const modal = document.getElementById('connection-modal');
    if (modal) modal.style.display = 'none';
}

function startConnectionMonitoring() {
    // Check video stream health periodically
    connectionCheckInterval = setInterval(() => {
        checkVideoFeed();
    }, 3000);
}

function checkVideoFeed() {
    const videoStream = document.getElementById('videoStream');
    const noVideoMessage = document.getElementById('no-video-message');
    
    // If on a mobile device, simply show the video and do not override it.
    if (isTouchDevice()) {
        noVideoMessage.style.display = 'none';
        videoStream.style.display = 'block';
        return;
    }
    
    const testImg = new Image();
    const timestamp = new Date().getTime();
    
    testImg.src = fastapiUrl + '/video_feed?t=' + timestamp;
    
    testImg.onload = function() {
        noVideoMessage.style.display = 'none';
        videoStream.style.display = 'block';
        // Optionally, you could update the src—but often doing so resets the MJPEG stream.
        // videoStream.src = testImg.src;
    };

    testImg.onerror = function() {
        noVideoMessage.style.display = 'block';
        videoStream.style.display = 'none';
        setTimeout(refreshVideoFeed, 3000);
    };
}


function refreshVideoFeed() {
    const videoStream = document.getElementById('videoStream');
    if (videoStream) {
        videoStream.src = fastapiUrl + '/video_feed?t=' + new Date().getTime();
    }
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
            screen.orientation.lock('landscape').catch((error) => {
                console.log("Orientation lock failed:", error);
            });
        } else if (window.screen.lockOrientation) {
            window.screen.lockOrientation('landscape');
        } else {
            console.log("Orientation lock not supported on this device.");
        }
    } catch (e) {
        console.log("Orientation lock failed:", e);
    }
}

function updateDebugPanel() {
    const videoElement = document.getElementById('videoStream');
    // For MJPEG streams, you might not rely on the 'complete' property.
    const videoStatus = isTouchDevice() ? 'Streaming' : (videoElement.complete ? 'Loaded' : 'Not loaded');
    
    document.getElementById('debug-video').textContent = videoStatus;
    document.getElementById('debug-device-type').textContent = isTouchDevice() ? 'Touch Device' : 'Desktop Device';
    document.getElementById('debug-socket').textContent = socket.connected ? 'Connected' : 'Disconnected';
    document.getElementById('debug-status').textContent = 'Running';
}


// Initialize when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", init);
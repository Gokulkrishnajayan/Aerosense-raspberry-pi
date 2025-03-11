// Global variables
const socket = io();
let lastCommand = Date.now();
// Improved touch detection
const isTouchDevice = (
    'ontouchstart' in window || 
    navigator.maxTouchPoints > 0 || 
    navigator.msMaxTouchPoints > 0
) && !window.matchMedia("(pointer: fine)").matches; // Exclude devices with precise pointers (e.g., desktops)
let activeCommands = new Set();
let connectionCheckInterval;
let videoCheckInterval;
let videoRetryCount = 0;
const MAX_VIDEO_RETRIES = 5;

function init() {
    // Add touch-device class to body if it's a touch device
    if (isTouchDevice) {
        document.body.classList.add('touch-device');
        // Initialize joysticks only for touch devices
        setupJoystick('left-joystick', (x, y) => {
            socket.emit('control', { type: 'left-joystick', x, y });
        }, { selfCenterX: true, selfCenterY: false });

        setupJoystick('right-joystick', (x, y) => {
            socket.emit('control', { type: 'right-joystick', x, y });
        }, { selfCenterX: true, selfCenterY: true });
    } else {
        // Hide joystick container explicitly
        document.getElementById('joystick-container').style.display = 'none';
        // Initialize keyboard controls for non-touch devices
        setupKeyboardControls();
    }

    // Initialize socket handlers
    setupSocketHandlers();
    
    // Initialize button handlers
    setupButtonHandlers();
    
    // Start connection monitoring
    startConnectionMonitoring();
    
    // Get current location and create a full URL for the FastAPI server
    setupVideoFeed();
}

function getFastAPIUrl() {
    // Try to get the fastapiUrl from the global scope if it exists
    if (typeof fastapiUrl !== 'undefined' && fastapiUrl) {
        return fastapiUrl;
    }
    
    // Otherwise, construct it from the current hostname
    const hostname = window.location.hostname;
    return `http://${hostname}:8000`;
}

function setupVideoFeed() {
    console.log("Setting up video feed");
    const videoStream = document.getElementById('videoStream');
    const noVideoMessage = document.getElementById('no-video-message');
    
    if (!videoStream || !noVideoMessage) {
        console.error("Video elements not found");
        return;
    }
    
    // Get the FastAPI URL
    const apiUrl = getFastAPIUrl();
    console.log("Using FastAPI URL:", apiUrl);
    
    // Set the initial video source with a timestamp to prevent caching
    videoStream.src = `${apiUrl}/video_feed?t=${new Date().getTime()}`;
    
    // Handle video load success
    videoStream.onload = function() {
        console.log("Video loaded successfully");
        videoStream.style.display = 'block';
        noVideoMessage.style.display = 'none';
        videoRetryCount = 0;  // Reset retry count on success
    };
    
    // Handle video load error
    videoStream.onerror = function() {
        console.error("Video failed to load");
        handleVideoError();
    };
    
    // Start periodic video checks
    videoCheckInterval = setInterval(checkVideoFeed, 5000);
}

function checkVideoFeed() {
    const healthcheckUrl = `${getFastAPIUrl()}/healthcheck`;
    
    fetch(healthcheckUrl)
        .then(response => response.json())
        .then(data => {
            console.log("Health check response:", data);
            if (data.status === "healthy") {
                document.getElementById('no-video-message').style.display = 'none';
                document.getElementById('videoStream').style.display = 'block';
                videoRetryCount = 0;  // Reset retry count on success
            } else {
                handleVideoError();
            }
        })
        .catch(error => {
            console.error("Health check failed:", error);
            handleVideoError();
        });
}

function handleVideoError() {
    const videoStream = document.getElementById('videoStream');
    const noVideoMessage = document.getElementById('no-video-message');
    
    videoRetryCount++;
    
    if (videoRetryCount <= MAX_VIDEO_RETRIES) {
        console.log(`Video error, retrying (${videoRetryCount}/${MAX_VIDEO_RETRIES})...`);
        refreshVideoFeed();
    } else {
        console.error("Max video retries reached, showing error message");
        videoStream.style.display = 'none';
        noVideoMessage.style.display = 'block';
        noVideoMessage.textContent = "No Video Feed Available - Check Camera Connection";
    }
}

function refreshVideoFeed() {
    const videoStream = document.getElementById('videoStream');
    if (videoStream) {
        const apiUrl = getFastAPIUrl();
        const timestamp = new Date().getTime();
        console.log("Refreshing video feed:", `${apiUrl}/video_feed?t=${timestamp}`);
        videoStream.src = `${apiUrl}/video_feed?t=${timestamp}`;
    }
}

function setupButtonHandlers() {
    const takeoffButton = document.getElementById('takeoffButton');
    const landButton = document.getElementById('landButton');
    const emergencyButton = document.getElementById('emergencyButton');
    const refreshVideoBtn = document.getElementById('refreshVideoBtn');
    
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
    
    if (refreshVideoBtn) {
        refreshVideoBtn.addEventListener('click', () => {
            refreshVideoFeed();
            showStatusMessage('Refreshing video...');
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
    }, 10000);
}

// Initialize when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", init);
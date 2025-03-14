// Global variables
let handDetectionRunning = false;
let cameraStream = null;

let isSelecting = false;
let startX, startY;
let selectionBox = document.getElementById('selection-box');
let selectedRegion = null;
let currentMode = 'manual'; // Default mode
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

// Call setupFullscreenListeners in the init function
function init() {
    console.log("Page loaded, initializing...");
    console.log("FastAPI URL: " + fastapiUrl);

    // Set initial video source
    const videoStream = document.getElementById('videoStream');
    if (videoStream) {
        videoStream.src = `${fastapiUrl}/video_feed?t=${new Date().getTime()}`;
        console.log("Video source set to: " + videoStream.src);
    }

    // Check if touch device
    const isTouchDevice = (
        'ontouchstart' in window || 
        navigator.maxTouchPoints > 0 || 
        navigator.msMaxTouchPoints > 0
    ) && !window.matchMedia("(pointer: fine)").matches;

    if (isTouchDevice) {
        document.body.classList.add('touch-device');
    }

    // Set up refresh button
    const refreshVideoBtn = document.getElementById('refreshVideoBtn');
    if (refreshVideoBtn) {
        refreshVideoBtn.addEventListener('click', function() {
            refreshVideoFeed();
            console.log("Video refresh requested");
        });
    }

    // Set up full-screen functionality
    setupFullscreen();

    // Set up mode switch
    setupModeSwitch();    

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
        // Remove this line to hide the keyboard control panel by default
        // document.getElementById('keyboard-controls').style.display = 'block';
    }

    // Initialize socket handlers
    setupSocketHandlers();
    
    // Initialize button handlers
    setupButtonHandlers();
    
    // Start connection monitoring
    startConnectionMonitoring();
    
    // Get current location and create a full URL for the FastAPI server
    setupVideoFeed();

    // Set up mode switch
    handleModeSwitch();
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

// Function to enter full-screen mode
function enterFullscreen() {
    const body = document.body;
    
    if (!document.fullscreenElement && 
        !document.mozFullScreenElement && 
        !document.webkitFullscreenElement && 
        !document.msFullscreenElement) {
        
        if (body.requestFullscreen) {
            body.requestFullscreen();
        } else if (body.mozRequestFullScreen) { // Firefox
            body.mozRequestFullScreen();
        } else if (body.webkitRequestFullscreen) { // Chrome, Safari, Opera
            body.webkitRequestFullscreen();
        } else if (body.msRequestFullscreen) { // IE/Edge
            body.msRequestFullscreen();
        }
        
        console.log("Entering fullscreen mode");
    }
}

// Function to exit full-screen mode
function exitFullscreen() {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.mozCancelFullScreen) { // Firefox
        document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) { // Chrome, Safari, Opera
        document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) { // IE/Edge
        document.msExitFullscreen();
    }
    
    console.log("Exiting fullscreen mode");
}

// Add touchstart and click event listeners to enter full-screen mode
function setupFullscreen() {
    const videoContainer = document.querySelector('.video-container');

    if (videoContainer) {
        // For touch devices
        videoContainer.addEventListener('touchstart', function() {
            enterFullscreen();
        });
        
        // For mouse clicks
        videoContainer.addEventListener('click', function() {
            enterFullscreen();
        });
        
        console.log("Full-screen event listeners set up");

    }
}

// Handle back button press on mobile devices
function handleBackButton() {
    if (document.fullscreenElement || 
        document.webkitFullscreenElement || 
        document.mozFullScreenElement || 
        document.msFullscreenElement) {
        exitFullscreen();
    }
}

// Handle Esc key press on desktop
function handleEscKey(event) {
    if (event.key === 'Escape') {
        exitFullscreen();
    }
}

// Add event listeners for fullscreen changes
function setupFullscreenListeners() {
    // Listen for fullscreen change events
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    // Listen for back button on mobile
    if (window.history && window.history.pushState) {
        window.addEventListener('popstate', handleBackButton);
    }
    
    console.log("Fullscreen change listeners set up");
}

function handleFullscreenChange() {
    const isFullScreen = !!(document.fullscreenElement || 
                           document.webkitFullscreenElement || 
                           document.mozFullScreenElement || 
                           document.msFullscreenElement);
    
    const videoContainer = document.querySelector('.video-container');
    if (videoContainer) {
        if (isFullScreen) {
            // Mobile-specific adjustments
            if (isTouchDevice) {
                videoContainer.style.paddingBottom = '0';
                videoContainer.style.height = '100%';
                videoContainer.style.width = '100%';
                document.getElementById('videoStream').style.objectFit = 'cover';
            }
        } else {
            // Reset to original values
            if (isTouchDevice) {
                videoContainer.style.paddingBottom = '56.25%';
                videoContainer.style.height = '';
                document.getElementById('videoStream').style.objectFit = 'contain';
            }
        }
    }
}

// Add mode switch functionality
function setupModeSwitch() {
    const modeSelect = document.getElementById('modeSelect');

    if (modeSelect) {
        modeSelect.addEventListener('change', (event) => {
            const selectedMode = event.target.value;
            console.log("Mode changed to:", selectedMode);
            socket.emit('mode', selectedMode); // Send mode to the server
        });
    }
}

// Add this function to toggle the keyboard control panel
function toggleKeyboardControls() {
    const keyboardControls = document.getElementById('keyboard-controls');
    if (keyboardControls) {
        if (keyboardControls.style.display === 'none' || keyboardControls.style.display === '') {
            keyboardControls.style.display = 'block'; // Show the panel
        } else {
            keyboardControls.style.display = 'none'; // Hide the panel
        }
    }
}

// Add this event listener for the 'h' key
document.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') { // Check if 'h' or 'H' is pressed
        toggleKeyboardControls(); // Toggle the keyboard control panel
    }
});


// Function to handle mode switch
function handleModeSwitch() {
    const modeSelect = document.getElementById('modeSelect');
    const followMeControls = document.getElementById('follow-me-controls');
    const joystickContainer = document.getElementById('joystick-container');
    const keyboardControls = document.getElementById('keyboard-controls');

    if (modeSelect) {
        modeSelect.addEventListener('change', (event) => {
            currentMode = event.target.value;
            console.log("Mode changed to:", currentMode);

            // Hide/show elements based on mode
            if (currentMode === 'manual') {
                joystickContainer.style.display = isTouchDevice ? 'flex' : 'none';
                keyboardControls.style.display = 'none';
                followMeControls.style.display = 'none';
                endSelection();
            } else if (currentMode === 'ai') {
                joystickContainer.style.display = 'none';
                keyboardControls.style.display = 'none';
                followMeControls.style.display = 'none';
                endSelection();
                startAIControl();
            } else if (currentMode === 'follow') {
                joystickContainer.style.display = 'none';
                keyboardControls.style.display = 'none';
                followMeControls.style.display = 'block';
                setupObjectSelection();
                startFollowMeMode();
            }
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const userVideo = document.getElementById("userCamera");
    const modeSelect = document.getElementById("modeSelect");
    let cameraStream = null;
    let handDetectionRunning = false;

    async function startAIControl() {
        console.log("Entering AI mode...");

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.error("getUserMedia is not supported in this browser.");
            return;
        }

        try {
            // Request access to the user's camera
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });

            userVideo.srcObject = cameraStream; // Assign stream to video element
            userVideo.style.display = "block"; // Show video feed

            console.log("User camera feed started in AI mode");

            // Start hand detection only if not already running
            if (!handDetectionRunning) {
                runHandDetection(userVideo);
                handDetectionRunning = true;
            }
        } catch (error) {
            console.error("Error accessing user camera:", error);
            alert("Camera access denied or unavailable.");
        }
    }

    function stopAIControl() {
        console.log("Exiting AI mode...");

        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop()); // Stop camera
            cameraStream = null;
        }

        userVideo.style.display = "none"; // Hide video feed
        handDetectionRunning = false;

        console.log("User camera feed stopped");
    }

    // Listen for mode selection change
    if (modeSelect) {
        modeSelect.addEventListener("change", (event) => {
            if (event.target.value === "ai") {
                startAIControl(); // Start camera when entering AI mode
            } else {
                stopAIControl(); // Stop camera when exiting AI mode
            }
        });
    }
});

// Placeholder for hand detection function
function runHandDetection(videoElement) {
    console.log("Running hand detection on client camera feed");
    // Your hand tracking ML model should go here
}










// Add new functions
function setupObjectSelection() {
    const videoContainer = document.getElementById('video-container');
    
    videoContainer.addEventListener('mousedown', startSelection);
    videoContainer.addEventListener('mousemove', resizeSelection);
    videoContainer.addEventListener('mouseup', endSelection);
    
    // Touch events for mobile
    videoContainer.addEventListener('touchstart', startSelection);
    videoContainer.addEventListener('touchmove', resizeSelection);
    videoContainer.addEventListener('touchend', endSelection);
}

function startSelection(e) {
    if (currentMode !== 'follow') return;
    
    isSelecting = true;
    const rect = e.target.getBoundingClientRect();
    const clientX = e.clientX || e.touches[0].clientX;
    const clientY = e.clientY || e.touches[0].clientY;
    
    startX = clientX - rect.left;
    startY = clientY - rect.top;
    
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0';
    selectionBox.style.height = '0';
    selectionBox.style.display = 'block';
}

function resizeSelection(e) {
    if (!isSelecting) return;
    
    const rect = e.target.getBoundingClientRect();
    const clientX = e.clientX || e.touches[0].clientX;
    const clientY = e.clientY || e.touches[0].clientY;
    
    const currentX = clientX - rect.left;
    const currentY = clientY - rect.top;
    
    const width = currentX - startX;
    const height = currentY - startY;
    
    selectionBox.style.width = Math.abs(width) + 'px';
    selectionBox.style.height = Math.abs(height) + 'px';
    selectionBox.style.left = (width > 0 ? startX : currentX) + 'px';
    selectionBox.style.top = (height > 0 ? startY : currentY) + 'px';
}

function endSelection() {
    if (!isSelecting) return;
    isSelecting = false;
    
    const rect = selectionBox.getBoundingClientRect();
    const videoRect = document.getElementById('videoStream').getBoundingClientRect();
    
    // Calculate relative coordinates (0-1)
    selectedRegion = {
        x: (rect.left - videoRect.left) / videoRect.width,
        y: (rect.top - videoRect.top) / videoRect.height,
        width: rect.width / videoRect.width,
        height: rect.height / videoRect.height
    };
}



    

    

    

function runHandDetection(videoElement) {
    // Your hand detection code goes here
    console.log("Running hand detection on client camera feed");
    // Example placeholder: Integrate your ML model here
}





// Initialize when the DOM is fully loaded
document.addEventListener("DOMContentLoaded", init);
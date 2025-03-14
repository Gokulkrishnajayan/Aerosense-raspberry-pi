from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from picamera2 import Picamera2
from fastapi import Request
import threading
import time
import cv2
import logging
import numpy as np  # Added missing numpy import

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()


# Add CORS middleware to allow requests from Flask app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (for development only)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared global frame buffer
frame = None
lock = threading.Lock()
camera_active = False

def initialize_camera():
    global picam2, frame, camera_active
    try:
        picam2 = Picamera2()
        config = picam2.create_video_configuration(
            main={"size": (640, 360), "format": "XRGB8888"},
            lores={"size": (320, 180), "format": "YUV420"},
            controls={
                "FrameDurationLimits": (33333, 33333),  # 30 FPS
                "AwbEnable": True,  # Auto white balance
                "AeEnable": True,   # Auto exposure
                "AfMode": 1,       # Enable autofocus (1 = Auto)
                "AfSpeed": 2,       # Autofocus speed (1 = Normal, 2 = Fast)
            }
        )
        picam2.configure(config)
        picam2.start()
        logger.info("Camera initialized successfully")
        
        # Wait for camera to warm up
        time.sleep(1)
        
        # Capture an initial frame to avoid NoneType issues
        rgb = picam2.capture_array("main")
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
        _, jpeg = cv2.imencode('.jpg', bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        
        with lock:
            frame = jpeg.tobytes()  # Set an initial frame
            camera_active = True
            
        logger.info("Initial frame captured")
        return True
    except Exception as e:
        logger.error(f"Camera initialization failed: {e}")
        
        # Create a fallback frame with error message
        blank_frame = 255 * np.ones((360, 640, 3), dtype=np.uint8)
        cv2.putText(blank_frame, "Camera Error: " + str(e)[:30], (50, 180), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        _, jpeg = cv2.imencode('.jpg', blank_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        
        with lock:
            frame = jpeg.tobytes()
            camera_active = False
            
        return False

# Capture frames in a background thread
def capture_frames():
    global frame, camera_active
    logger.info("Frame capture thread started")
    
    frame_count = 0
    start_time = time.time()
    
    while True:
        try:
            if not camera_active:
                logger.warning("Camera not active, attempting to reinitialize...")
                if initialize_camera():
                    logger.info("Camera reinitialized successfully")
                else:
                    logger.error("Failed to reinitialize camera")
                    time.sleep(5)  # Wait before trying again
                    continue

            rgb = picam2.capture_array("main")
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
            
            # Add timestamp to frame
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            cv2.putText(bgr, timestamp, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 
                        0.7, (255, 255, 255), 2, cv2.LINE_AA)
            
            # Add telemetry placeholder - in real app this would show actual drone data
            cv2.putText(bgr, "Camera Feed Active", (10, bgr.shape[0] - 10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1, cv2.LINE_AA)
            
            _, jpeg = cv2.imencode('.jpg', rgb, [int(cv2.IMWRITE_JPEG_QUALITY), 70])

            with lock:
                frame = jpeg.tobytes()
            
            # Calculate FPS every 100 frames
            frame_count += 1
            if frame_count % 100 == 0:
                end_time = time.time()
                fps = 100 / (end_time - start_time)
                logger.info(f"Current FPS: {fps:.2f}")
                start_time = time.time()
                
            time.sleep(0.01)  # ~30 FPS
        except Exception as e:
            logger.error(f"Error capturing frame: {e}")
            
            # Create an error frame
            blank_frame = 255 * np.ones((360, 640, 3), dtype=np.uint8)
            cv2.putText(blank_frame, "Camera Error", (50, 180), 
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            try:
                _, jpeg = cv2.imencode('.jpg', blank_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                with lock:
                    frame = jpeg.tobytes()
                    camera_active = False
            except Exception as inner_e:
                logger.error(f"Error creating error frame: {inner_e}")
                
            time.sleep(1)  # Pause briefly before retrying

# Generate frames for streaming
def generate_frames():
    global frame
    while True:
        try:
            with lock:
                current_frame = frame
                
            if current_frame:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + current_frame + b'\r\n')
            else:
                # If no frame is available, send a blank frame with error message
                blank = np.zeros((360, 640, 3), dtype=np.uint8)
                cv2.putText(blank, "No Video Signal", (180, 180), 
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
                _, encoded = cv2.imencode('.jpg', blank)
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + encoded.tobytes() + b'\r\n')
                      
            time.sleep(0.033)  # ~30 FPS
        except Exception as e:
            logger.error(f"Error in generate_frames: {e}")
            time.sleep(0.5)

@app.get("/")
def root():
    return {"message": "Video streaming server is running"}

@app.get("/video_feed")
def video_feed():
    return StreamingResponse(
        generate_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Access-Control-Allow-Origin": "*"}
    )

@app.get("/healthcheck")
def healthcheck():
    with lock:
        has_frame = frame is not None
        is_active = camera_active
        
    return {
        "status": "healthy" if has_frame and is_active else "unhealthy", 
        "camera": "connected" if is_active else "disconnected",
        "has_frame": has_frame
    }

@app.post("/select_object")
async def select_object(request: Request):
    data = await request.json()
    with lock:
        if frame is None:
            return {"success": False}
        
        # Convert frame to OpenCV image
        nparr = np.frombuffer(frame, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Extract selected region
        h, w = img.shape[:2]
        x = int(data['x'] * w)
        y = int(data['y'] * h)
        width = int(data['width'] * w)
        height = int(data['height'] * h)
        
        # Get template (selected object)
        template = img[y:y+height, x:x+width]
        
        # Save template for tracking
        # (You'll need to implement actual tracking logic here)
        cv2.imwrite("selected_object.jpg", template)
        
        return {
            "success": True,
            "object": {
                "x": x,
                "y": y,
                "width": width,
                "height": height
            }
        }

@app.get("/track_object")
def track_object():
    # Implement your actual object tracking logic here
    # This should return current object position
    return {
        "success": True,
        "position": {"x": 320, "y": 180}  # Example position
    }

tracker = None

def track_object(frame):
    global tracker
    # Initialize tracker on first frame
    if tracker is None:
        tracker = cv2.TrackerKCF_create()
        template = cv2.imread("selected_object.jpg")
        if template is None:
            return None
        bbox = (0, 0, template.shape[1], template.shape[0])
        tracker.init(frame, bbox)
    
    # Update tracker
    success, bbox = tracker.update(frame)
    return success, bbox

# Initialize everything
if __name__ == '__main__':
    import uvicorn
    
    # Try to initialize camera
    camera_ready = initialize_camera()
    
    # Start frame capture thread (always start it, it will try to reconnect if needed)
    thread = threading.Thread(target=capture_frames, daemon=True)
    thread.start()
    
    logger.info("Starting FastAPI server on port 8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
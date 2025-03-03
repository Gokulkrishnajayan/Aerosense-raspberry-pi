from picamera2 import Picamera2
import cv2

# Initialize Picamera2
picam2 = Picamera2()
config = picam2.create_preview_configuration()
picam2.configure(config)

# Start the camera
picam2.start()

while True:
    frame = picam2.capture_array()
    cv2.imshow("Camera Feed", frame)
    
    # Press 'q' to exit
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Cleanup
cv2.destroyAllWindows()
picam2.stop()

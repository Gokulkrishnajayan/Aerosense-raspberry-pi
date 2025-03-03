import cv2
import mediapipe as mp
import math
import numpy as np
import logging
from collections import deque
from picamera2 import Picamera2

# Initialize logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

file_handler = logging.FileHandler('hand_tracking.log')
stream_handler = logging.StreamHandler()

formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
file_handler.setFormatter(formatter)
stream_handler.setFormatter(formatter)

logger.addHandler(file_handler)
logger.addHandler(stream_handler)

# Initialize Picamera2
picam2 = Picamera2()
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "RGB888"})
picam2.configure(config)
picam2.start()

# Initialize MediaPipe hands module
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(min_detection_confidence=0.5, min_tracking_confidence=0.5)
mp_draw = mp.solutions.drawing_utils

# Track the last state of raised fingers using a buffer (deque)
finger_state_history = deque(maxlen=2)  # Stores the last 2 states of raised fingers

# Function to calculate angle between three points (in degrees)
def calculate_angle(a, b, c):
    ab = np.array([a[0] - b[0], a[1] - b[1]])
    bc = np.array([c[0] - b[0], c[1] - b[1]])

    dot_product = np.dot(ab, bc)
    mag_ab = np.linalg.norm(ab)
    mag_bc = np.linalg.norm(bc)

    angle = np.arccos(dot_product / (mag_ab * mag_bc))  # in radians
    return math.degrees(angle)  # convert to degrees

# Function to check the drone's mode based on raised fingers
def check_drone_mode(fingers_raised):
    if not fingers_raised:
        logger.info("Drone Stable Mode")
    elif set(fingers_raised) == {"Thumb", "Index", "Middle", "Ring", "Pinky"}:
        logger.info("Drone Landing")
    elif set(fingers_raised) == {"Index", "Middle"}:
        logger.info("Drone Down")
    elif set(fingers_raised) == {"Index"}:
        logger.info("Drone Up")
    elif set(fingers_raised) == {"Index", "Middle", "Ring"}:
        logger.info("Drone X Yaw")
    elif set(fingers_raised) == {"Index", "Middle", "Ring", "Pinky"}:
        logger.info("Drone Y Yaw")
    elif set(fingers_raised) == {"Thumb"}:    
        logger.info("Drone Right")
    elif set(fingers_raised) == {"Pinky"}:    
        logger.info("Drone Left")

# Smooth transition: Calculate majority of raised fingers over recent frames
def get_majority_fingers_state():
    if len(finger_state_history) == 0:
        return []
    finger_count = {}
    for state in finger_state_history:
        state_tuple = tuple(sorted(state))  # Sort to avoid duplicate configurations
        finger_count[state_tuple] = finger_count.get(state_tuple, 0) + 1

    majority_state = max(finger_count, key=finger_count.get)
    return list(majority_state)

while True:
    frame = picam2.capture_array()
    frame = cv2.flip(frame, 0) 
    
    # Convert the RGB frame to BGR for OpenCV
    # frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

    # Process the frame and get hand landmarks
    results = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

    if not results.multi_hand_landmarks:
        logger.info("Drone Stable Mode")
        current_fingers_raised = []
    else:
        current_fingers_raised = []

        for landmarks in results.multi_hand_landmarks:
            mp_draw.draw_landmarks(frame, landmarks, mp_hands.HAND_CONNECTIONS)

            # List of finger tip and base landmarks
            fingers = {
                "Thumb": (4, 3),
                "Index": (8, 6),
                "Middle": (12, 10),
                "Ring": (16, 14),
                "Pinky": (20, 18),
            }

            h, w, c = frame.shape
            for finger_name, (tip_id, base_id) in fingers.items():
                tip_x = landmarks.landmark[tip_id].x
                tip_y = landmarks.landmark[tip_id].y
                base_x = landmarks.landmark[base_id].x
                base_y = landmarks.landmark[base_id].y

                if finger_name == "Thumb":
                    point1 = (landmarks.landmark[0].x, landmarks.landmark[0].y)
                    point3 = (base_x, base_y)
                    point4 = (tip_x, tip_y)
                    angle = calculate_angle(point1, point3, point4)
                    if angle > 150:
                        current_fingers_raised.append("Thumb")
                else:
                    if tip_y < base_y:
                        current_fingers_raised.append(finger_name)

                tip_x_screen = int(tip_x * w)
                tip_y_screen = int(tip_y * h)
                cv2.circle(frame, (tip_x_screen, tip_y_screen), 10, (0, 255, 0), -1)

        finger_state_history.append(current_fingers_raised)
        smoothed_fingers_raised = get_majority_fingers_state()
        check_drone_mode(smoothed_fingers_raised)

    cv2.imshow('Hand Tracking', frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cv2.destroyAllWindows()
picam2.stop()

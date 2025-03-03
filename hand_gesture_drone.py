import cv2
import mediapipe as mp
import math
import numpy as np
from collections import deque
from dronekit import connect, VehicleMode, LocationGlobalRelative
import time
import logging

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize MediaPipe hands module
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(min_detection_confidence=0.5, min_tracking_confidence=0.5)
mp_draw = mp.solutions.drawing_utils

# Initialize webcam
cap = cv2.VideoCapture(0)

# Track the last state of raised fingers using a buffer (deque)
finger_state_history = deque(maxlen=10)  # Stores the last 10 states

# Connect to the drone (replace with your connection string)logger.info("Starting main loop...")
logger.info("Webcam initialized...")
logger.info("Drone connection established...")
logger.info("MediaPipe hands module initialized...")
connection_string = "172.25.192.1:14550"  # For SITL
vehicle = connect(connection_string, wait_ready=True)

# --------------------------------------------------------------------------
# Drone Control Functions
# --------------------------------------------------------------------------
def arm_and_takeoff(target_altitude):
    logger.info("Arming motors...")
    vehicle.mode = VehicleMode("GUIDED")
    vehicle.armed = True

    while not vehicle.armed:
        logger.info("Waiting for arming...")
        time.sleep(1)

    logger.info("Taking off!")
    vehicle.simple_takeoff(target_altitude)

    while True:
        altitude = vehicle.location.global_relative_frame.alt
        logger.info(f"Current Altitude: {altitude:.2f}")
        if altitude >= target_altitude * 0.95:
            logger.info("Reached target altitude!")
            break
        time.sleep(1)

def land_drone():
    logger.info("Landing...")
    vehicle.mode = VehicleMode("LAND")

    while vehicle.armed:
        logger.info("Waiting for landing...")
        time.sleep(1)

    logger.info("Landed and motors disarmed.")

def move_forward(distance):
    logger.info(f"Moving forward by {distance} meters...")
    current_location = vehicle.location.global_relative_frame
    target_location = LocationGlobalRelative(
        current_location.lat + (distance / 111319.9),
        current_location.lon,
        current_location.alt
    )
    vehicle.simple_goto(target_location)

def yaw_drone(heading):
    logger.info(f"Yawing to {heading} degrees...")
    vehicle.simple_goto(vehicle.location.global_relative_frame, heading=heading)

# --------------------------------------------------------------------------
# Gesture Detection Functions
# --------------------------------------------------------------------------
def calculate_angle(a, b, c):
    ab = np.array([a[0] - b[0], a[1] - b[1]])
    bc = np.array([c[0] - b[0], c[1] - b[1]])
    dot_product = np.dot(ab, bc)
    mag_ab = np.linalg.norm(ab)
    mag_bc = np.linalg.norm(bc)
    angle = np.arccos(dot_product / (mag_ab * mag_bc))
    return math.degrees(angle)

def get_majority_fingers_state():
    if not finger_state_history:
        return []
    finger_count = {}
    for state in finger_state_history:
        state_tuple = tuple(sorted(state))
        finger_count[state_tuple] = finger_count.get(state_tuple, 0) + 1
    majority_state = max(finger_count, key=finger_count.get)
    return list(majority_state)

def check_drone_mode(fingers_raised):
    if not fingers_raised:
        logger.info("Drone Stable Mode")
    elif set(fingers_raised) == {"Thumb", "Index", "Middle", "Ring", "Pinky"}:
        logger.info("Drone Landing")
        land_drone()
    elif set(fingers_raised) == {"Index", "Middle"}:
        logger.info("Drone Down")
        vehicle.simple_goto(vehicle.location.global_relative_frame, altitude=5)
    elif set(fingers_raised) == {"Index"}:
        logger.info("Drone Up")
        vehicle.simple_goto(vehicle.location.global_relative_frame, altitude=15)
    elif set(fingers_raised) == {"Index", "Middle", "Ring"}:
        logger.info("Drone X Yaw")
        yaw_drone(90)
    elif set(fingers_raised) == {"Index", "Middle", "Ring", "Pinky"}:
        logger.info("Drone Y Yaw")
        yaw_drone(180)
    elif set(fingers_raised) == {"Thumb"}:
        logger.info("Drone Right")
        move_forward(5)
    elif set(fingers_raised) == {"Pinky"}:
        logger.info("Drone Left")
        move_forward(-5)

# --------------------------------------------------------------------------
# Main Loop
# --------------------------------------------------------------------------
def main():
    # Arm and takeoff to 10 meters initially
    arm_and_takeoff(10)

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # Mirror and resize the frame
        frame = cv2.flip(frame, 1)
        frame = cv2.resize(frame, (640, 480))

        # Process hand landmarks
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb_frame)

        if not results.multi_hand_landmarks:
            current_fingers_raised = []
        else:
            current_fingers_raised = []
            for landmarks in results.multi_hand_landmarks:
                mp_draw.draw_landmarks(frame, landmarks, mp_hands.HAND_CONNECTIONS)
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

    cap.release()
    cv2.destroyAllWindows()
    vehicle.close()

if __name__ == "__main__":
    main()
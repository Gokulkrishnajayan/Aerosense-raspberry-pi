import base64
import time
import cv2
import mediapipe as mp
import numpy as np
import socketio
from collections import deque

# Initialize SocketIO client
sio = socketio.Client()
sio.connect('https://192.168.7.57:5000', transports=['websocket'])  # Use wss://

# Initialize MediaPipe Hands module
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(min_detection_confidence=0.5, min_tracking_confidence=0.5)
mp_draw = mp.solutions.drawing_utils

# Track last state of raised fingers
finger_state_history = deque(maxlen=2)

# Function to calculate angle between three points
def calculate_angle(a, b, c):
    ab = np.array([a[0] - b[0], a[1] - b[1]])
    bc = np.array([c[0] - b[0], c[1] - b[1]])
    dot_product = np.dot(ab, bc)
    mag_ab = np.linalg.norm(ab)
    mag_bc = np.linalg.norm(bc)
    angle = np.arccos(dot_product / (mag_ab * mag_bc))
    return np.degrees(angle)

# Function to check drone mode based on raised fingers
def check_drone_mode(fingers_raised):
    command = None
    if not fingers_raised:
        command = "stable"
    elif set(fingers_raised) == {"Thumb", "Index", "Middle", "Ring", "Pinky"}:
        command = "land"
    elif set(fingers_raised) == {"Index", "Middle"}:
        command = "down"
    elif set(fingers_raised) == {"Index"}:
        command = "up"
    elif set(fingers_raised) == {"Index", "Middle", "Ring"}:
        command = "yaw_x"
    elif set(fingers_raised) == {"Index", "Middle", "Ring", "Pinky"}:
        command = "yaw_y"
    elif set(fingers_raised) == {"Thumb"}:    
        command = "right"
    elif set(fingers_raised) == {"Pinky"}:    
        command = "left"
    
    if command:
        sio.emit('ai_control', {'command': command})  # Send command to Raspberry Pi
        print(f"Detected Fingers: {fingers_raised}, Command: {command}")


# Capture from client's camera
cap = cv2.VideoCapture(0)

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.flip(frame, 1)
    results = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    current_fingers_raised = []

    if results.multi_hand_landmarks:
        for landmarks in results.multi_hand_landmarks:
            mp_draw.draw_landmarks(frame, landmarks, mp_hands.HAND_CONNECTIONS)
            fingers = {
                "Thumb": (4, 3), "Index": (8, 6), "Middle": (12, 10),
                "Ring": (16, 14), "Pinky": (20, 18)
            }
            for finger_name, (tip_id, base_id) in fingers.items():
                tip_y = landmarks.landmark[tip_id].y
                base_y = landmarks.landmark[base_id].y
                if finger_name == "Thumb":
                    point1 = (landmarks.landmark[0].x, landmarks.landmark[0].y)
                    point3 = (landmarks.landmark[base_id].x, landmarks.landmark[base_id].y)
                    point4 = (landmarks.landmark[tip_id].x, landmarks.landmark[tip_id].y)
                    angle = calculate_angle(point1, point3, point4)
                    if angle > 150:
                        current_fingers_raised.append("Thumb")
                else:
                    if tip_y < base_y:
                        current_fingers_raised.append(finger_name)
    
    finger_state_history.append(current_fingers_raised)
    check_drone_mode(current_fingers_raised)
    

        # Encode frame to Base64 for streaming
    _, buffer = cv2.imencode('.jpg', frame)
    encoded_frame = base64.b64encode(buffer).decode('utf-8')
    

    
    # Send processed frame to the web client
    sio.emit('processed_frame', {'image': encoded_frame})
    # cv2.imshow('Hand Detection', frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

def connect_socket():
    while True:
        try:
            sio.connect('https://192.168.7.57:5000', transports=['websocket'])
            print("Reconnected to WebSocket")
            break
        except Exception as e:
            print("WebSocket Reconnect Failed:", e)
            time.sleep(5)  # Retry after 5 seconds

sio.on('disconnect', connect_socket)  # Reconnect when disconnected


@sio.on('stop_ai')
def stop_ai():
    print("Received stop signal. Exiting AI Control...")
    sio.disconnect()
    exit(0)  # Exit the script immediately



cap.release()
cv2.destroyAllWindows()
sio.disconnect()

from flask import Flask, request, jsonify, render_template, Response
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename
import os
import torch
import pandas as pd
import cv2
import numpy as np
import base64
from kernel_utils import VideoReader, FaceExtractor, confident_strategy, predict_on_video_set
from training.zoo.classifiers import DeepFakeClassifier
import socket
import threading
import queue
import time
import subprocess
import sys
import platform

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size
app.config['SECRET_KEY'] = 'your-secret-key'

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Initialize model
def load_model():
    model = DeepFakeClassifier(encoder="tf_efficientnet_b7_ns").to("cuda")
    checkpoint = torch.load("weights/final_999_DeepFakeClassifier_tf_efficientnet_b7_ns_0_23", map_location="cpu")
    state_dict = checkpoint.get("state_dict", checkpoint)
    model.load_state_dict({k.replace("module.", ""): v for k, v in state_dict.items()}, strict=True)
    model.eval()
    return model.half()

# Global variables for model and utilities
model = load_model()
frames_per_video = 32
video_reader = VideoReader()
video_read_fn = lambda x: video_reader.read_frames(x, num_frames=frames_per_video)
face_extractor = FaceExtractor(video_read_fn)
input_size = 380
strategy = confident_strategy

# Queue for real-time processing
frame_queue = queue.Queue(maxsize=32)
result_queue = queue.Queue()

# Store the Electron process
electron_process = None

def get_local_ip():
    try:
        # Create a socket to get the local IP address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

def process_frame(frame):
    # Convert frame to RGB
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # Extract faces
    faces = face_extractor.process_video(frame_rgb)
    
    if len(faces) > 0:
        # Process the first face found
        face = faces[0]["faces"][0] if faces[0]["faces"] else None
        if face is not None:
            # Resize face to model input size
            face = cv2.resize(face, (input_size, input_size))
            face = cv2.cvtColor(face, cv2.COLOR_RGB2BGR)
            
            # Convert to tensor and normalize
            face_tensor = torch.from_numpy(face).float().permute(2, 0, 1).unsqueeze(0)
            face_tensor = face_tensor / 255.0
            face_tensor = face_tensor.to("cuda")
            
            # Get prediction
            with torch.no_grad():
                pred = model(face_tensor.half())
                pred = torch.sigmoid(pred).cpu().numpy()[0][0]
            
            return pred
    return 0.5

def real_time_processor():
    while True:
        if not frame_queue.empty():
            frame = frame_queue.get()
            result = process_frame(frame)
            result_queue.put(result)
        time.sleep(0.01)  # Small delay to prevent CPU overload

# Start the real-time processor thread
processor_thread = threading.Thread(target=real_time_processor, daemon=True)
processor_thread.start()

def start_electron_app():
    global electron_process
    try:
        # Get the directory of the current script
        current_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Find npm in common locations
        npm_paths = [
            os.path.join(os.environ.get('APPDATA', ''), 'npm', 'npm.cmd'),  # Windows npm global
            os.path.join(os.environ.get('PROGRAMFILES', ''), 'nodejs', 'npm.cmd'),  # Windows npm in Program Files
            os.path.join(os.environ.get('PROGRAMFILES(X86)', ''), 'nodejs', 'npm.cmd'),  # Windows npm in Program Files (x86)
            'npm'  # Try system PATH
        ]
        
        npm_path = None
        for path in npm_paths:
            if os.path.exists(path):
                npm_path = path
                break
        
        if not npm_path:
            raise Exception("Could not find npm. Please make sure Node.js is installed.")
        
        # Check if package.json exists
        package_json = os.path.join(current_dir, 'package.json')
        if not os.path.exists(package_json):
            raise Exception("package.json not found. Please make sure you're in the correct directory.")
        
        # Determine the command based on the platform
        if platform.system() == 'Windows':
            # For Windows, use npm start
            electron_process = subprocess.Popen(
                [npm_path, 'start'],
                cwd=current_dir,
                creationflags=subprocess.CREATE_NEW_CONSOLE,
                shell=True
            )
        else:
            # For Unix-like systems
            electron_process = subprocess.Popen(
                [npm_path, 'start'],
                cwd=current_dir
            )
        
        # Wait a bit to check if the process started successfully
        time.sleep(2)
        if electron_process.poll() is not None:
            raise Exception("Electron app failed to start. Check if all dependencies are installed.")
        
        return True
    except Exception as e:
        print(f"Error starting Electron app: {e}")
        return False

@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('screen_frame')
def handle_screen_frame(data):
    try:
        # Decode base64 image
        encoded_data = data.split(',')[1]
        nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            print("Error: Could not decode frame")
            return
            
        # Convert frame to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Create a temporary file to store the frame
        temp_frame_path = os.path.join(app.config['UPLOAD_FOLDER'], 'temp_frame.jpg')
        cv2.imwrite(temp_frame_path, frame)
        
        try:
            # Extract faces using the temporary file
            faces = face_extractor.process_video(temp_frame_path)
            
            if len(faces) > 0:
                # Process the first face found
                face = faces[0]["faces"][0] if faces[0]["faces"] else None
                if face is not None:
                    # Resize face to model input size
                    face = cv2.resize(face, (input_size, input_size))
                    face = cv2.cvtColor(face, cv2.COLOR_RGB2BGR)
                    
                    # Convert to tensor and normalize
                    face_tensor = torch.from_numpy(face).float().permute(2, 0, 1).unsqueeze(0)
                    face_tensor = face_tensor / 255.0
                    face_tensor = face_tensor.to("cuda")
                    
                    # Get prediction
                    with torch.no_grad():
                        pred = model(face_tensor.half())
                        pred = torch.sigmoid(pred).cpu().numpy()[0][0]
                    
                    # Send result back to client
                    label = "Fake" if pred > 0.5 else "Real"
                    confidence = pred if pred > 0.5 else 1 - pred
                    
                    emit('detection_result', {
                        'label': label,
                        'confidence': float(confidence)
                    })
                else:
                    emit('detection_result', {
                        'label': 'No Face',
                        'confidence': 0.0
                    })
            else:
                emit('detection_result', {
                    'label': 'No Face',
                    'confidence': 0.0
                })
        finally:
            # Clean up temporary file
            if os.path.exists(temp_frame_path):
                os.remove(temp_frame_path)
            
    except Exception as e:
        print(f"Error processing frame: {str(e)}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/screen')
def screen():
    return render_template('screen.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    
    file = request.files['video']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # Process video
        predictions = predict_on_video_set(
            face_extractor=face_extractor,
            input_size=input_size,
            models=[model],
            strategy=strategy,
            frames_per_video=frames_per_video,
            videos=[filename],
            num_workers=1,
            test_dir=app.config['UPLOAD_FOLDER']
        )
        
        # Clean up
        os.remove(filepath)
        
        # Return prediction (0 for real, 1 for fake)
        result = "Fake" if predictions[0] > 0.5 else "Real"
        confidence = predictions[0] if predictions[0] > 0.5 else 1 - predictions[0]
        
        return jsonify({
            'result': result,
            'confidence': float(confidence),
            'filename': filename
        })

@app.route('/start-electron', methods=['POST'])
def start_electron():
    success = start_electron_app()
    return jsonify({'success': success})

if __name__ == '__main__':
    local_ip = get_local_ip()
    print(f"\n=== Deepfake Detection Server ===")
    print(f"Local URL: http://localhost:5000")
    print(f"Network URL: http://{local_ip}:5000")
    print("===============================\n")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True) 
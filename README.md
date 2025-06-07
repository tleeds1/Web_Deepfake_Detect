# Web Deepfake Detect

A web application for detecting deepfake images and videos using machine learning.

## Features

- Upload images or videos for deepfake detection
- Batch prediction support
- Model management

## Requirements

- Python 3.8+
- pip

## Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/Web_Deepfake_Detect.git
   cd Web_Deepfake_Detect
   ```

2. **Create and activate a virtual environment**
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Download or place your trained model weights**
   - Place your model files in the `weights/` directory.

### Download Pretrained Model Weights
Download the pretrained model weights from [this Google Drive folder](https://drive.google.com/drive/folders/1yhn5PL3zNvgi0fJwEKMZHuC_-eQYs8gq?usp=drive_link) and place them in the `weights/` directory before running the application.

## Running the Web Application

1. **Start the web server**
   ```bash
   python web.py
   ```
   or, if using Flask:
   ```bash
   flask run
   ```

2. **Open your browser**
   - Go to [http://localhost:5000](http://localhost:5000)

3. **Upload images or videos**
   - Use the web interface to upload files and view predictions.

## Batch Prediction

To run predictions on a folder of files and save results to a CSV:
```bash
./predict_submission.sh <test_folder> <output.csv>
```
*On Windows, use Git Bash or WSL to run the script.*

## Notes

- Ensure your model weights are compatible with the code.
- For large files or datasets, adjust the configuration as needed.

## License

MIT License

---
Feel free to contribute or open issues!
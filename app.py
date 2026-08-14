import io
import json
import time
import uuid
from datetime import datetime

import numpy as np
from flask import Flask, request, jsonify, render_template, send_from_directory
from PIL import Image

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8 MB upload cap

MODEL_PATH = "model/crop_disease.keras"
IMG_SIZE = (160, 160)

# Exact training order pulled from the notebook's `class_names` output
# (tf.keras.utils.image_dataset_from_directory, alphabetical folder order).
CLASS_NAMES = [
    "Apple___Apple_scab", "Apple___Black_rot", "Apple___Cedar_apple_rust", "Apple___healthy",
    "Background_without_leaves",
    "Blueberry___healthy",
    "Cherry___Powdery_mildew", "Cherry___healthy",
    "Corn___Cercospora_leaf_spot Gray_leaf_spot", "Corn___Common_rust",
    "Corn___Northern_Leaf_Blight", "Corn___healthy",
    "Grape___Black_rot", "Grape___Esca_(Black_Measles)",
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)", "Grape___healthy",
    "Orange___Haunglongbing_(Citrus_greening)",
    "Peach___Bacterial_spot", "Peach___healthy",
    "Pepper,_bell___Bacterial_spot", "Pepper,_bell___healthy",
    "Potato___Early_blight", "Potato___Late_blight", "Potato___healthy",
    "Raspberry___healthy",
    "Soybean___healthy",
    "Squash___Powdery_mildew",
    "Strawberry___Leaf_scorch", "Strawberry___healthy",
    "Tomato___Bacterial_spot", "Tomato___Early_blight", "Tomato___Late_blight",
    "Tomato___Leaf_Mold", "Tomato___Septoria_leaf_spot",
    "Tomato___Spider_mites Two-spotted_spider_mite", "Tomato___Target_Spot",
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus", "Tomato___Tomato_mosaic_virus",
    "Tomato___healthy",
]

assert len(CLASS_NAMES) == 39, "Class list must match the model's 39 output units"

# In-memory scan history (fine for a class project / single-process demo).
SCAN_HISTORY = []

_model = None


def get_model():
    """Lazy-load the Keras model on first request so the server boots instantly."""
    global _model
    if _model is None:
        import tensorflow as tf
        _model = tf.keras.models.load_model(MODEL_PATH)
    return _model


def parse_label(raw_label):
    """Split 'Crop___Disease' into readable crop / condition / status fields."""
    if raw_label == "Background_without_leaves":
        return {"crop": "Background", "condition": "No leaf detected", "status": "unknown"}

    if "___" in raw_label:
        crop, condition = raw_label.split("___", 1)
    else:
        crop, condition = raw_label, "unknown"

    crop = crop.replace("_", " ").replace(",", ",").strip()
    condition_clean = condition.replace("_", " ").strip()
    status = "healthy" if condition.lower() == "healthy" else "diseased"

    return {"crop": crop, "condition": condition_clean, "status": status}


def preprocess_image(file_bytes):
    img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
    img = img.resize(IMG_SIZE)
    arr = np.array(img, dtype=np.float32)  # model's own preprocess_input layer scales this
    arr = np.expand_dims(arr, axis=0)
    return arr, img


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/predict", methods=["POST"])
def predict():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No image selected"}), 400

    try:
        file_bytes = file.read()
        arr, _ = preprocess_image(file_bytes)
    except Exception:
        return jsonify({"error": "Could not read that image file"}), 400

    model = get_model()
    t0 = time.time()
    preds = model.predict(arr, verbose=0)[0]
    infer_ms = round((time.time() - t0) * 1000, 1)

    top3_idx = np.argsort(preds)[::-1][:3]
    top3 = [
        {"label": CLASS_NAMES[i], "parsed": parse_label(CLASS_NAMES[i]), "confidence": round(float(preds[i]) * 100, 2)}
        for i in top3_idx
    ]

    best = top3[0]

    record = {
        "id": str(uuid.uuid4())[:8],
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "crop": best["parsed"]["crop"],
        "condition": best["parsed"]["condition"],
        "status": best["parsed"]["status"],
        "confidence": best["confidence"],
        "infer_ms": infer_ms,
    }
    SCAN_HISTORY.insert(0, record)
    SCAN_HISTORY[:] = SCAN_HISTORY[:200]  # cap memory growth

    return jsonify({
        "top3": top3,
        "infer_ms": infer_ms,
        "scan_id": record["id"],
        "timestamp": record["timestamp"],
    })


@app.route("/api/history")
def history():
    limit = request.args.get("limit", default=25, type=int)
    return jsonify(SCAN_HISTORY[:limit])


@app.route("/api/stats")
def stats():
    total = len(SCAN_HISTORY)
    healthy = sum(1 for r in SCAN_HISTORY if r["status"] == "healthy")
    diseased = total - healthy
    avg_conf = round(sum(r["confidence"] for r in SCAN_HISTORY) / total, 1) if total else 0
    avg_ms = round(sum(r["infer_ms"] for r in SCAN_HISTORY) / total, 1) if total else 0

    crop_counts = {}
    for r in SCAN_HISTORY:
        crop_counts[r["crop"]] = crop_counts.get(r["crop"], 0) + 1
    top_crop = max(crop_counts, key=crop_counts.get) if crop_counts else "—"

    condition_counts = {}
    for r in SCAN_HISTORY:
        if r["status"] == "diseased":
            condition_counts[r["condition"]] = condition_counts.get(r["condition"], 0) + 1
    top_condition = max(condition_counts, key=condition_counts.get) if condition_counts else "—"

    return jsonify({
        "total_scans": total,
        "healthy_count": healthy,
        "diseased_count": diseased,
        "avg_confidence": avg_conf,
        "avg_infer_ms": avg_ms,
        "top_crop": top_crop,
        "top_condition": top_condition,
        "classes_supported": len(CLASS_NAMES),
    })


@app.route("/api/classes")
def classes():
    return jsonify([{"label": c, "parsed": parse_label(c)} for c in CLASS_NAMES])


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

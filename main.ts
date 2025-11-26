// ===========================
// CONFIG
// ===========================
const ROBOFLOW_API_KEY = "kgm9BwsfeNyUBPwSijfg";
const ROBOFLOW_MODEL = "deteksi_jenttik-an9y5";
const ROBOFLOW_VERSION = "1";

const FIREBASE_URL =
  "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

const CLOUDINARY_CLOUD_NAME = "dnm25bwiu";
const CLOUDINARY_UPLOAD_PRESET = "unsigned_preset";
const CLOUDINARY_URL =
  `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// ===========================
// UTIL 1: Fetch Annotated Image (Roboflow)
// ===========================
async function getAnnotatedImage(imageUrl: string): Promise<Uint8Array> {
  const detectUrl =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}` +
    `&image=${encodeURIComponent(imageUrl)}` +
    `&format=image` +
    `&labels=confidence`;

  const res = await fetch(detectUrl);
  if (!res.ok) throw new Error("Gagal mengambil annotated image");

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ===========================
// UTIL 2: Fetch JSON Prediction (Roboflow)
// ===========================
async function getPredictionJSON(imageUrl: string): Promise<any> {
  const url =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}` +
    `&image=${encodeURIComponent(imageUrl)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Gagal mengambil JSON prediction");

  return await res.json();
}

// ===========================
// UTIL 3: Upload Image ke Cloudinary
// ===========================
async function uploadToCloudinary(buffer: Uint8Array): Promise<string> {
  const boundary = "----BOUNDARY-" + crypto.randomUUID();
  const encoder = new TextEncoder();

  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="upload_preset"\r\n\r\n` +
    `${CLOUDINARY_UPLOAD_PRESET}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="annotated.jpg"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`;

  const tail = `\r\n--${boundary}--\r\n`;

  const body = new Uint8Array(
    encoder.encode(head).length +
      buffer.length +
      encoder.encode(tail).length,
  );

  body.set(encoder.encode(head), 0);
  body.set(buffer, encoder.encode(head).length);
  body.set(
    encoder.encode(tail),
    encoder.encode(head).length + buffer.length,
  );

  const res = await fetch(CLOUDINARY_URL, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  const txt = await res.text();
  const json = JSON.parse(txt);

  if (!res.ok) throw new Error("Upload Cloudinary gagal: " + txt);

  return json.secure_url;
}

// ===========================
// UTIL 4: Simpan ke Firebase
// ===========================
async function saveToFirebase(data: any) {
  return await fetch(FIREBASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// ===========================
// MAIN SERVER
// ===========================
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ===== Root Check =====
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(JSON.stringify({ status: "OK", msg: "Server Running" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ===== API DETECTION =====
  if (req.method === "POST" && url.pathname === "/api/detect") {
    try {
      const body = JSON.parse(await req.text());
      const { imageUrl } = body;

      if (!imageUrl) {
        return new Response(JSON.stringify({ error: "imageUrl diperlukan" }), {
          status: 400,
        });
      }

      console.log("📥 ESP32 sent:", imageUrl);

      // 1) Ambil annotated image from Roboflow
      const annotatedBuffer = await getAnnotatedImage(imageUrl);

      // 2) Upload ke Cloudinary
      const annotatedUrl = await uploadToCloudinary(annotatedBuffer);
      console.log("📤 Cloudinary:", annotatedUrl);

      // 3) Ambil JSON prediction Roboflow
      const prediction = await getPredictionJSON(imageUrl);

      // 4) Hitung jumlah jentik otomatis
      const jumlahJentik = Array.isArray(prediction.predictions)
        ? prediction.predictions.length
        : 0;

      // 5) Save ke Firebase
      const dataToSave = {
        originalImageUrl: imageUrl,
        annotatedImageUrl: annotatedUrl,
        predictions: prediction.predictions,
        jumlahJentik,
        timestamp: Date.now(),
      };

      await saveToFirebase(dataToSave);

      // 6) Response ke ESP32 atau Frontend
      return new Response(JSON.stringify({
        success: true,
        ...dataToSave,
      }), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (err) {
      console.error("🔥 ERROR:", err);
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
      });
    }
  }

  return new Response("Not Found", { status: 404 });
});

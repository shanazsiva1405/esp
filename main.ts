///////////////////////////////////////////////////////////////
// IMPORTS
///////////////////////////////////////////////////////////////
import {
  createCanvas,
  loadImage,
} from "https://deno.land/x/canvas@v1.4.1/mod.ts";


///////////////////////////////////////////////////////////////
// CONFIG
///////////////////////////////////////////////////////////////
const ROBOFLOW_API_KEY = "kgm9BwsfeNyUBPwSijfg";
const ROBOFLOW_MODEL = "deteksi_jenttik-an9y5";
const ROBOFLOW_VERSION = "1";

const FIREBASE_URL =
  "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

const CLOUDINARY_CLOUD_NAME = "dnm25bwiu";
const CLOUDINARY_UPLOAD_PRESET = "unsigned_preset";
const CLOUDINARY_URL =
  `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;


///////////////////////////////////////////////////////////////
// API CALL: Roboflow JSON
///////////////////////////////////////////////////////////////
async function getPredictionJSON(imageUrl: string): Promise<any> {
  const url =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}` +
    `&image=${encodeURIComponent(imageUrl)}`;

  const res = await fetch(url);
  const txt = await res.text();

  if (!res.ok) throw new Error("Gagal mengambil JSON prediction: " + txt);

  return JSON.parse(txt);
}


///////////////////////////////////////////////////////////////
// DRAW BOUNDING BOX + CONFIDENCE
///////////////////////////////////////////////////////////////
async function drawAnnotatedImage(
  imageUrl: string,
  predictions: any[],
): Promise<Uint8Array> {
  const img = await loadImage(imageUrl);

  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");

  // Gambar foto asli
  ctx.drawImage(img, 0, 0);

  // Style bounding box
  ctx.lineWidth = 3;
  ctx.font = "30px Arial";
  ctx.strokeStyle = "#00FF00";
  ctx.fillStyle = "#00FF00";

  // Draw semua bbox
  for (const p of predictions) {
    const x = p.x - p.width / 2;
    const y = p.y - p.height / 2;

    ctx.strokeRect(x, y, p.width, p.height);

    const label = `${Math.round(p.confidence * 100)}%`;
    ctx.fillText(label, x, y - 10);
  }

  return canvas.toBuffer("image/jpeg");
}


///////////////////////////////////////////////////////////////
// UPLOAD CLOUDINARY
///////////////////////////////////////////////////////////////
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

  if (!res.ok) throw new Error("Cloudinary upload error: " + txt);

  return json.secure_url;
}


///////////////////////////////////////////////////////////////
// SAVE TO FIREBASE
///////////////////////////////////////////////////////////////
async function saveToFirebase(data: any) {
  return await fetch(FIREBASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}


///////////////////////////////////////////////////////////////
// SERVER HANDLER
///////////////////////////////////////////////////////////////
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Root test endpoint
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({ status: "OK", msg: "Deno Server Running" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Main detection endpoint
  if (req.method === "POST" && url.pathname === "/api/detect") {
    try {
      const body = JSON.parse(await req.text());
      const { imageUrl } = body;

      if (!imageUrl) {
        return new Response(
          JSON.stringify({ error: "imageUrl diperlukan" }),
          { status: 400 },
        );
      }

      console.log("📥 Image received:", imageUrl);

      // 1) Ambil JSON prediction dari Roboflow
      const prediction = await getPredictionJSON(imageUrl);

      // 2) Hitung jumlah jentik
      const jumlahJentik = prediction?.predictions?.length || 0;

      // 3) Generate annotated image secara manual
      const annotatedBuffer = await drawAnnotatedImage(
        imageUrl,
        prediction.predictions,
      );

      // 4) Upload ke Cloudinary
      const annotatedUrl = await uploadToCloudinary(annotatedBuffer);

      // 5) Simpan ke Firebase
      const dataToSave = {
        originalImageUrl: imageUrl,
        annotatedImageUrl: annotatedUrl,
        predictions: prediction.predictions,
        jumlahJentik,
        timestamp: Date.now(),
      };

      await saveToFirebase(dataToSave);

      // 6) Response ke user / ESP32
      return new Response(JSON.stringify({
        success: true,
        ...dataToSave,
      }), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (err) {
      console.error("🔥 ERROR:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 500 },
      );
    }
  }

  return new Response("Not Found", { status: 404 });
});

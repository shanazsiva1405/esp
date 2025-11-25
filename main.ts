// ===============================
// CONFIG
// ===============================
const ROBOFLOW_API_KEY = "kgm9BwsfeNyUBPwSijfg";
const ROBOFLOW_MODEL = "deteksi_jenttik-an9y5";
const ROBOFLOW_VERSION = "1";

const FIREBASE_URL =
  "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

// Cloudinary
const CLOUD_NAME = "dnm25bwiu";
const UPLOAD_PRESET = "unsigned_preset";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

// ===============================
// Helper: Upload foto asli ke Cloudinary
// ===============================
async function uploadToCloudinary(imageBuffer: Uint8Array): Promise<string> {
  const boundary = "----BOUNDARY-" + crypto.randomUUID();
  const encoder = new TextEncoder();

  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="upload_preset"\r\n\r\n` +
    `${UPLOAD_PRESET}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="raw.jpg"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`;

  const tail = `\r\n--${boundary}--\r\n`;

  const body = new Uint8Array(
    encoder.encode(head).length + imageBuffer.length +
      encoder.encode(tail).length,
  );

  body.set(encoder.encode(head), 0);
  body.set(imageBuffer, encoder.encode(head).length);
  body.set(
    encoder.encode(tail),
    encoder.encode(head).length + imageBuffer.length,
  );

  const res = await fetch(CLOUDINARY_URL, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  const txt = await res.text();
  console.log("Cloudinary raw upload response:", txt);

  const json = JSON.parse(txt);

  if (!res.ok) throw new Error("Cloudinary upload error: " + txt);

  return json.secure_url;
}

// ===============================
// Helper: Ambil gambar bounding box dari Roboflow
// ===============================
async function getAnnotatedImage(imageUrl: string): Promise<Uint8Array> {
  const detectUrl =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}&image=${encodeURIComponent(imageUrl)}&format=image`;

  console.log("Request annotated image:", detectUrl);

  const res = await fetch(detectUrl);

  if (!res.ok) {
    console.error("Annotated error:", await res.text());
    throw new Error("Gagal mengambil annotated image");
  }

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ===============================
// Helper: Upload annotated image ke Cloudinary
// ===============================
async function uploadAnnotatedImage(buffer: Uint8Array): Promise<string> {
  const boundary = "----BOUNDARY-" + crypto.randomUUID();
  const encoder = new TextEncoder();

  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="upload_preset"\r\n\r\n` +
    `${UPLOAD_PRESET}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="annotated.jpg"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`;

  const tail = `\r\n--${boundary}--\r\n`;

  const body = new Uint8Array(
    encoder.encode(head).length + buffer.length +
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
  console.log("Cloudinary annotated upload:", txt);

  const json = JSON.parse(txt);

  if (!res.ok) throw new Error("Annotated upload error: " + txt);

  return json.secure_url;
}

// ===============================
// HTTP SERVER
// ===============================
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Cek hidup
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({ status: "OK", message: "Deno Deploy Running" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Endpoint utama ESP32-CAM
  if (req.method === "POST" && url.pathname === "/api/upload") {
    try {
      const form = await req.formData();
      const file = form.get("file");

      if (!(file instanceof File)) {
        return new Response(
          JSON.stringify({ error: "File tidak ditemukan" }),
          { status: 400 },
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const imageBuffer = new Uint8Array(arrayBuffer);

      console.log("📥 Received image from ESP32, size:", imageBuffer.length);

      // 1) Upload foto asli
      const originalUrl = await uploadToCloudinary(imageBuffer);
      console.log("☁️ Original uploaded:", originalUrl);

      // 2) Ambil annotated image dari Roboflow
      const annotatedBuffer = await getAnnotatedImage(originalUrl);
      console.log("🟩 Annotated buffer received:", annotatedBuffer.length);

      // 3) Upload annotated ke Cloudinary
      const annotatedUrl = await uploadAnnotatedImage(annotatedBuffer);
      console.log("📤 Annotated uploaded:", annotatedUrl);

      // 4) Simpan ke Firebase
      await fetch(FIREBASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalImageUrl: originalUrl,
          annotatedImageUrl: annotatedUrl,
          timestamp: Date.now(),
        }),
      });

      return new Response(
        JSON.stringify({
          success: true,
          originalImageUrl: originalUrl,
          annotatedImageUrl: annotatedUrl,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      console.error("🔥 Error in /api/upload:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 500 },
      );
    }
  }

  return new Response("Not Found", { status: 404 });
});

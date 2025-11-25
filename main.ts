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

// ===============================================
// Helper: Upload annotated image (Uint8Array) ke Cloudinary
// ===============================================
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
  console.log("Cloudinary annotated upload:", txt);

  const json = JSON.parse(txt);

  if (!res.ok) throw new Error("Annotated upload error: " + txt);

  return json.secure_url;
}

// ===============================================
// Helper: Dapatkan Annotated Image dari Roboflow
// ===============================================
async function getAnnotatedImage(imageUrl: string): Promise<Uint8Array> {
  const detectUrl =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}&image=${encodeURIComponent(imageUrl)}&format=image`;

  console.log("🔍 Roboflow request:", detectUrl);

  const rfResp = await fetch(detectUrl);

  if (!rfResp.ok) {
    console.error("Roboflow error:", await rfResp.text());
    throw new Error("Gagal mengambil annotated image dari Roboflow");
  }

  const buf = await rfResp.arrayBuffer();
  return new Uint8Array(buf);
}

// ===============================================
// HTTP SERVER
// ===============================================
Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({ status: "OK", message: "Deno Deploy Running" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // ===========================================
  // Endpoint dari ESP32: /api/detect
  // ===========================================
  if (req.method === "POST" && url.pathname === "/api/detect") {
    try {
      const body = await req.text();
      const json = JSON.parse(body);

      const imageUrl = json.imageUrl;
      if (!imageUrl) {
        return new Response(
          JSON.stringify({ error: "imageUrl tidak ditemukan" }),
          { status: 400 },
        );
      }

      console.log("📥 ESP32 sent image URL:", imageUrl);

      // 1) Ambil annotated JPEG dari Roboflow
      const annotatedBuffer = await getAnnotatedImage(imageUrl);
      console.log("🟩 Annotated buffer length:", annotatedBuffer.length);

      // 2) Upload annotated ke Cloudinary
      const annotatedUrl = await uploadAnnotatedImage(annotatedBuffer);
      console.log("📤 Annotated uploaded:", annotatedUrl);

      // 3) Simpan ke Firebase
      await fetch(FIREBASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalImageUrl: imageUrl,
          annotatedImageUrl: annotatedUrl,
          timestamp: Date.now(),
        }),
      });

      return new Response(
        JSON.stringify({
          success: true,
          originalImageUrl: imageUrl,
          annotatedImageUrl: annotatedUrl,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      console.error("🔥 Error in /api/detect:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 500 },
      );
    }
  }

  return new Response("Not Found", { status: 404 });
});

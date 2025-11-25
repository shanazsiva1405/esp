// main.ts (Deno)

const ROBOFLOW_API_KEY = "kgm9BwsfeNyUBPwSijfg";          // <= ganti punya kamu
const ROBOFLOW_MODEL = "deteksi_jenttik-an9y5";           // <= nama model
const ROBOFLOW_VERSION = "1";

// Firebase RTDB endpoint (node "detections")
const FIREBASE_URL =
  "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

// Cloudinary
const CLOUD_NAME = "dnm25bwiu";
const UPLOAD_PRESET = "unsigned_preset";                  // <= preset unsigned
const CLOUDINARY_URL =
  `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

// ========= Helper: Upload buffer ke Cloudinary =========
async function uploadToCloudinary(imageBuffer: Uint8Array): Promise<string> {
  const boundary = "----DenoBoundary" + crypto.randomUUID();
  const encoder = new TextEncoder();

  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="upload_preset"\r\n\r\n` +
    `${UPLOAD_PRESET}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="detect.jpg"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`;

  const tail = `\r\n--${boundary}--\r\n`;

  const headBytes = encoder.encode(head);
  const tailBytes = encoder.encode(tail);

  const body = new Uint8Array(
    headBytes.length + imageBuffer.length + tailBytes.length,
  );
  body.set(headBytes, 0);
  body.set(imageBuffer, headBytes.length);
  body.set(tailBytes, headBytes.length + imageBuffer.length);

  const res = await fetch(CLOUDINARY_URL, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Cloudinary error:", txt);
    throw new Error("Gagal upload ke Cloudinary");
  }

  const data = await res.json();
  return data.secure_url as string;
}

// ========= Helper: Kirim gambar ke Roboflow (binary) =========
async function detectWithRoboflow(imageBuffer: Uint8Array) {
  const url =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}&format=json`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: imageBuffer,
  });

  const txt = await res.text();
  console.log("Roboflow raw response:", txt);

  // Cek dulu apakah kemungkinan besar JSON (misal diawali `{` atau `[`)
  const trimmed = txt.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    console.error("Respon Roboflow bukan JSON:", txt);
    throw new Error("Response Roboflow bukan JSON");
  }

  if (!res.ok) {
    console.error("Roboflow error status:", res.status, txt);
    throw new Error("Gagal deteksi di Roboflow");
  }

  try {
    const data = JSON.parse(trimmed);
    return data;
  } catch (e) {
    console.error("Gagal parse JSON Roboflow:", txt);
    throw new Error("Response Roboflow bukan JSON valid");
  }
}


// ========= HTTP Server =========
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Cek hidup
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({
        message: "✅ Deno Deploy aktif!",
        usage: "POST /api/upload (multipart file)",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // === Endpoint utama dari ESP32: /api/upload (multipart/form-data) ===
  if (req.method === "POST" && url.pathname === "/api/upload") {
    try {
      const formData = await req.formData();
      const file = formData.get("file");

      if (!(file instanceof File)) {
        return new Response(
          JSON.stringify({ error: "file tidak ditemukan di form-data" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const imageBuffer = new Uint8Array(arrayBuffer);

      // 1) Deteksi di Roboflow (pakai binary)
      const roboflowData = await detectWithRoboflow(imageBuffer);

      // 2) Upload gambar asli ke Cloudinary
      const imageUrl = await uploadToCloudinary(imageBuffer);

      // 3) Simpan hasil ke Firebase RTDB
      await fetch(FIREBASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          detection: roboflowData,
          timestamp: Date.now(),
        }),
      });

      return new Response(
        JSON.stringify({
          success: true,
          imageUrl,
          detection: roboflowData,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      console.error("Error di /api/upload:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // === Endpoint lama /api/detect: jika kirim imageUrl, masih bisa dipakai ===
  if (req.method === "POST" && url.pathname === "/api/detect") {
    try {
      const { imageUrl } = await req.json();
      if (!imageUrl) {
        return new Response(
          JSON.stringify({ error: "imageUrl kosong" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const detectUrl =
        `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}?api_key=${ROBOFLOW_API_KEY}&image=${
          encodeURIComponent(imageUrl)
        }`;

      const roboflowRes = await fetch(detectUrl);
      const roboflowData = await roboflowRes.json();

      await fetch(FIREBASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          detection: roboflowData,
          timestamp: Date.now(),
        }),
      });

      return new Response(
        JSON.stringify({ success: true, roboflowData }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      console.error("Error di /api/detect:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  return new Response("404 Not Found", { status: 404 });
});

// main.ts (Deno)

const ROBOFLOW_API_KEY = "kgm9BwsfeNyUBPwSijfg";
const ROBOFLOW_MODEL = "deteksi_jenttik-an9y5";
const ROBOFLOW_VERSION = "1";

// Firebase RTDB endpoint
const FIREBASE_URL =
  "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

// Cloudinary
const CLOUD_NAME = "dnm25bwiu";
const UPLOAD_PRESET = "unsigned_preset";
const CLOUDINARY_URL =
  `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

// Helper: upload buffer ke Cloudinary, return secure_url
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

  // gabung: head + binary + tail
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

// Helper: panggil Roboflow pakai buffer image
async function detectWithRoboflow(imageBuffer: Uint8Array) {
  const url =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}?api_key=${ROBOFLOW_API_KEY}&format=json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded", // sesuai doc Roboflow untuk binary
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Roboflow error:", txt);
    throw new Error("Gagal deteksi di Roboflow");
  }

  const data = await res.json();
  return data;
}

// (opsional) kalau kamu mau minta Roboflow balikin gambar yang sudah dibox,
// biasanya endpoint-nya pakai format=image, tapi seringnya dari URL.
// Di sini dulu kita pakai json + simpan hasil ke RTDB, gambar asli tetap dari Cloudinary.

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({
        message: "✅ Deno Deploy aktif!",
        usage: "POST /api/upload (multipart file)",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // === ENDPOINT BARU UNTUK ESP32: /api/upload ===
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

      // 1) Deteksi di Roboflow
      const roboflowData = await detectWithRoboflow(imageBuffer);

      // 2) Upload gambar ke Cloudinary
      const imageUrl = await uploadToCloudinary(imageBuffer);

      // 3) Simpan hasil + URL ke Firebase RTDB
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

  // endpoint lama /api/detect masih boleh dipakai kalau dari tempat lain kirim imageUrl
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
          encodeURIComponent(
            imageUrl,
          )
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
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  return new Response("404 Not Found", { status: 404 });
});

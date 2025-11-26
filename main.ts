///////////////////////////////////////////////////////////////
// CONFIG
///////////////////////////////////////////////////////////////
const ROBOFLOW_API_KEY = "kgm9BwsfeNyUBPwSijfg";
const ROBOFLOW_MODEL = "deteksi_jenttik-an9y5";
const ROBOFLOW_VERSION = "1";

const FIREBASE_URL =
  "https://siling-ai-default-rtdb.asia-southeast1.firebasedatabase.app/detections.json";

const CLOUDINARY_CLOUD = "dnm25bwiu";
const CLOUDINARY_UPLOAD_PRESET = "unsigned_preset";


///////////////////////////////////////////////////////////////
// Ambil ANNOTATED IMAGE dari Roboflow (format=image)
///////////////////////////////////////////////////////////////
async function getAnnotatedImage(imageUrl: string) {
  const url =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}` +
    `&image=${encodeURIComponent(imageUrl)}` +
    `&format=image`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Gagal mengambil annotated image");

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}


///////////////////////////////////////////////////////////////
// Ambil JSON PREDICTION dari Roboflow
///////////////////////////////////////////////////////////////
async function getPredictionJSON(imageUrl: string) {
  const url =
    `https://detect.roboflow.com/${ROBOFLOW_MODEL}/${ROBOFLOW_VERSION}` +
    `?api_key=${ROBOFLOW_API_KEY}` +
    `&image=${encodeURIComponent(imageUrl)}`;

  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) throw new Error("Gagal ambil JSON Roboflow: " + text);

  return JSON.parse(text);
}


///////////////////////////////////////////////////////////////
// UPLOAD gambar annotated ke Cloudinary
///////////////////////////////////////////////////////////////
async function uploadAnnotatedToCloudinary(buffer: Uint8Array) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "image/jpeg" }));
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const upload = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
    { method: "POST", body: form }
  );

  const json = await upload.json();
  if (!upload.ok) throw new Error("Cloudinary upload error: " + JSON.stringify(json));

  return json.secure_url;
}


///////////////////////////////////////////////////////////////
// SIMPAN KE FIREBASE
///////////////////////////////////////////////////////////////
async function saveToFirebase(data: any) {
  await fetch(FIREBASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}


///////////////////////////////////////////////////////////////
// SERVER UTAMA
///////////////////////////////////////////////////////////////
Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "OK" }));
  }

  if (req.method === "POST" && url.pathname === "/api/detect") {
    try {
      const { imageUrl } = JSON.parse(await req.text());

      if (!imageUrl)
        return new Response(JSON.stringify({ error: "imageUrl diperlukan" }), {
          status: 400,
        });

      console.log("📥 Menerima gambar:", imageUrl);

      // 1) Ambil JSON prediksi
      const prediction = await getPredictionJSON(imageUrl);
      const predictions = prediction.predictions ?? [];

      // Hitung jumlah jentik
      const jumlahJentik = predictions.length;

      // Ambil confidence list
      const confidenceList = predictions.map((p: any) =>
        Number((p.confidence * 100).toFixed(2))
      );

      // 2) Ambil annotated image (dari Roboflow)
      const annotatedBuffer = await getAnnotatedImage(imageUrl);

      // 3) Upload annotated ke Cloudinary
      const annotatedUrl = await uploadAnnotatedToCloudinary(annotatedBuffer);

      // 4) Data yang disimpan ke Firebase
      const savedData = {
        originalImageUrl: imageUrl,
        annotatedImageUrl: annotatedUrl,
        jumlahJentik,
        confidenceList,
        predictions,
        timestamp: Date.now()
      };

      await saveToFirebase(savedData);

      return new Response(
        JSON.stringify({ success: true, ...savedData }),
        { headers: { "Content-Type": "application/json" } }
      );

    } catch (err) {
      console.error("🔥 ERROR:", err);
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
      });
    }
  }

  return new Response("Not Found", { status: 404 });
});

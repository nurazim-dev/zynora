const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const PRODUCT_IMAGE_FORMATS = {
  "image/jpeg": { extension: "jpg", valid: (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  "image/png": { extension: "png", valid: (data) => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", valid: (data) => data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" },
};

async function saveProductImage(buffer, mimeType) {
  const format = PRODUCT_IMAGE_FORMATS[mimeType];
  if (!Buffer.isBuffer(buffer) || !format || buffer.length === 0 || buffer.length > 5 * 1024 * 1024 || !format.valid(buffer)) {
    const error = new Error("Выберите корректное изображение JPG, PNG или WebP размером до 5 МБ.");
    error.status = 400;
    throw error;
  }
  const filename = `${randomUUID()}.${format.extension}`;
  const directory = path.join(__dirname, "..", "public", "uploads", "products");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, filename), buffer, { flag: "wx" });
  return `/public/uploads/products/${filename}`;
}

module.exports = { saveProductImage };

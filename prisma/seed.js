require("dotenv").config();
const bcrypt = require("bcryptjs");
const { prisma } = require("../config/database");

async function main() {
  const laptops = await prisma.category.upsert({ where: { slug: "laptops" }, update: { name: "Ноутбуки" }, create: { name: "Ноутбуки", slug: "laptops" } });
  await prisma.category.upsert({ where: { slug: "tablets" }, update: { name: "Планшеты" }, create: { name: "Планшеты", slug: "tablets" } });
  await prisma.category.upsert({ where: { slug: "accessories" }, update: { name: "Аксессуары" }, create: { name: "Аксессуары", slug: "accessories" } });
  const products = [
    {
      slug: "macbook-air-m5", name: "MacBook Air M5", imagePath: "/image/m5.webp",
      description: "Apple MacBook Air M5 (2026): тонкий бесшумный ноутбук с дисплеем Liquid Retina 13,6 или 15,3 дюйма, памятью от 16 ГБ, Wi-Fi 7 и автономностью до 18 часов.",
      specifications: { processor: "Apple M5, 10-ядерный CPU", memory: "От 16 ГБ", storage: "SSD 512 ГБ–4 ТБ", display: "Liquid Retina, 500 нит, P3, True Tone", wireless: "Wi-Fi 7, Bluetooth 6", battery: "До 18 часов", ports: "Thunderbolt 4, MagSafe 3, 3,5 мм" },
    },
    {
      slug: "macbook-air-m4", name: "MacBook Air M4", imagePath: "/image/m4.jpeg",
      description: "Apple MacBook Air M4 (2025): тонкий бесшумный ноутбук с дисплеем Liquid Retina 13,6 или 15,3 дюйма, памятью от 16 ГБ, Wi-Fi 6E и автономностью до 18 часов.",
      specifications: { processor: "Apple M4, 10-ядерный CPU", memory: "От 16 ГБ", storage: "SSD 256 ГБ–2 ТБ", display: "Liquid Retina, 500 нит, P3, True Tone", wireless: "Wi-Fi 6E, Bluetooth 5.3", battery: "До 18 часов", camera: "12 Мп Center Stage", ports: "Thunderbolt 4 / USB-C, MagSafe 3, 3,5 мм" },
    },
    {
      slug: "macbook-air-m3", name: "MacBook Air M3", imagePath: "/image/m3.webp",
      description: "Apple MacBook Air M3 (2024): тонкий бесшумный ноутбук с дисплеем Liquid Retina 13,6 или 15,3 дюйма, памятью от 8 ГБ, Wi-Fi 6E и автономностью до 18 часов.",
      specifications: { processor: "Apple M3, 8-ядерный CPU", memory: "От 8 ГБ", storage: "SSD 256 ГБ–2 ТБ", display: "Liquid Retina, 500 нит, P3, True Tone", wireless: "Wi-Fi 6E, Bluetooth 5.3", battery: "До 18 часов", camera: "FaceTime HD 1080p", ports: "Thunderbolt / USB 4, MagSafe 3, 3,5 мм" },
    },
  ];
  for (const product of products) {
    await prisma.product.upsert({ where: { slug: product.slug }, update: { ...product, categoryId: laptops.id }, create: { ...product, categoryId: laptops.id, brand: "Apple", stock: 0, price: null, active: true } });
  }

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH) {
    const email = process.env.ADMIN_EMAIL.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({ where: { email }, data: { role: "ADMIN", passwordHash: process.env.ADMIN_PASSWORD_HASH } });
    } else {
      await prisma.user.create({ data: { email, name: "ZYNORA Admin", passwordHash: process.env.ADMIN_PASSWORD_HASH, role: "ADMIN" } });
    }
  } else {
    console.log("ADMIN_EMAIL or ADMIN_PASSWORD_HASH missing; admin account was not seeded.");
  }
  console.log("ZYNORA seed finished. Product prices and stock remain unset until entered by the store owner.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

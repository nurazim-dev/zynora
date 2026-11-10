const { z } = require("zod");

const orderSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30).regex(/^[+\d()\s-]+$/),
  city: z.string().trim().min(2).max(100),
  address: z.string().trim().min(4).max(250),
  comment: z.string().trim().max(1000).optional().default(""),
  couponCode: z.string().trim().max(40).optional().default(""),
  idempotencyKey: z.string().uuid(),
  items: z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(20) })).min(1).max(30),
}).superRefine((data, context) => {
  const ids = data.items.map((item) => item.productId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Удалите повторяющиеся товары из заказа.", path: ["items"] });
});

const productSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  price: z.number().int().positive().nullable().optional(),
  stock: z.number().int().min(0).max(100000).optional(),
  lowStockThreshold: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
});

const statusSchema = z.object({ status: z.enum(["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]) });

module.exports = { orderSchema, productSchema, statusSchema };

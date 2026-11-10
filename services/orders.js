const crypto = require("node:crypto");
const { prisma } = require("../config/database");
const { orderSchema } = require("../validators/schemas");

class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function createOrder(input, userId = null) {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) throw new OrderError(parsed.error.issues[0]?.message || "Проверьте данные заказа.");
  const data = parsed.data;

  try {
    const order = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { idempotencyKey: data.idempotencyKey }, include: { items: true } });
      if (existing) {
        if (existing.userId !== userId) throw new OrderError("Ключ этого заказа уже использован.", 409);
        return existing;
      }

      const ids = data.items.map((item) => item.productId);
      const products = await tx.product.findMany({ where: { id: { in: ids }, active: true } });
      const byId = new Map(products.map((product) => [product.id, product]));
      let subtotal = 0;
      const orderItems = [];

      for (const item of data.items) {
        const product = byId.get(item.productId);
        if (!product) throw new OrderError("Один из товаров больше недоступен.", 409);
        if (product.price === null || product.price <= 0) throw new OrderError(`Цена товара «${product.name}» ещё не указана.`, 409);
        const reserved = await tx.product.updateMany({
          where: { id: product.id, active: true, stock: { gte: item.quantity }, reservedStock: { lte: product.stock - item.quantity } },
          data: { reservedStock: { increment: item.quantity } },
        });
        if (reserved.count !== 1) throw new OrderError(`Недостаточно свободного остатка товара «${product.name}».`, 409);
        subtotal += product.price * item.quantity;
        orderItems.push({
          productId: product.id,
          productName: product.name,
          productSlug: product.slug,
          imagePath: product.imagePath,
          unitPrice: product.price,
          quantity: item.quantity,
        });
      }

      let discount = 0;
      let couponId = null;
      if (data.couponCode) {
        const coupon = await tx.coupon.findUnique({ where: { code: data.couponCode.toUpperCase() } });
        if (!coupon || !coupon.active || (coupon.expiresAt && coupon.expiresAt < new Date()) || (coupon.usageLimit !== null && coupon.uses >= coupon.usageLimit)) {
          throw new OrderError("Промокод недействителен или срок его действия истёк.", 400);
        }
        if (subtotal < coupon.minSubtotal) throw new OrderError(`Для промокода нужна сумма от ${coupon.minSubtotal} сом.`, 400);
        discount = coupon.type === "PERCENT" ? Math.floor(subtotal * coupon.value / 100) : Math.min(subtotal, coupon.value);
        couponId = coupon.id;
        const use = await tx.coupon.updateMany({
          where: { id: coupon.id, active: true, OR: [{ usageLimit: null }, { uses: { lt: coupon.usageLimit ?? 0 } }] },
          data: { uses: { increment: 1 } },
        });
        if (use.count !== 1) throw new OrderError("Промокод больше нельзя использовать.", 409);
      }

      const now = new Date();
      const orderNumber = `ZY-${now.getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const created = await tx.order.create({
        data: {
          orderNumber,
          trackingToken: crypto.randomBytes(32).toString("base64url"),
          idempotencyKey: data.idempotencyKey,
          userId,
          customerName: data.customerName,
          phone: data.phone,
          city: data.city,
          address: data.address,
          comment: data.comment || null,
          subtotal,
          discount,
          delivery: 0,
          total: subtotal - discount,
          couponId,
          items: { create: orderItems },
          statusHistory: { create: { to: "PENDING_PAYMENT", note: "Заказ создан" } },
        },
        include: { items: true },
      });
      await tx.inventoryMovement.createMany({ data: orderItems.map((item) => ({ productId: item.productId, orderId: created.id, type: "RESERVE", quantity: item.quantity, note: `Резерв заказа ${orderNumber}` })) });
      return created;
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
    return order;
  } catch (error) {
    if (error instanceof OrderError) throw error;
    if (error.code === "P2002") {
      const duplicate = await prisma.order.findUnique({ where: { idempotencyKey: data.idempotencyKey }, include: { items: true } });
      if (duplicate?.userId === userId) return duplicate;
      throw new OrderError("Не удалось создать заказ. Попробуйте ещё раз.", 409);
    }
    if (error.code === "P2034") throw new OrderError("Заказ конфликтует с параллельной покупкой. Повторите попытку.", 409);
    throw error;
  }
}

function publicOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    trackingToken: order.trackingToken,
    customerName: order.customerName,
    subtotal: order.subtotal,
    discount: order.discount,
    delivery: order.delivery,
    total: order.total,
    status: order.status,
    paymentReported: order.paymentReported,
    createdAt: order.createdAt,
    items: order.items,
  };
}

module.exports = { createOrder, publicOrder, OrderError };

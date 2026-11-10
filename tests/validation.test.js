const test = require("node:test");
const assert = require("node:assert/strict");
const { orderSchema, productSchema } = require("../validators/schemas");
const { ALLOWED_TRANSITIONS } = require("../services/telegram");
const { requireAdmin, requireUser } = require("../middlewares/auth");

const validOrder = {
  customerName: "Тестовый покупатель",
  phone: "+996 555 000 000",
  city: "Бишкек",
  address: "Улица Тестовая, 1",
  idempotencyKey: "65d7ac16-7439-4c92-98d3-38ecb52410cc",
  items: [{ productId: 1, quantity: 1 }],
};

test("accepts a valid order and applies optional defaults", () => {
  const parsed = orderSchema.parse(validOrder);
  assert.equal(parsed.comment, "");
  assert.equal(parsed.items[0].quantity, 1);
});

test("rejects duplicate product lines to keep stock reservations unambiguous", () => {
  const result = orderSchema.safeParse({ ...validOrder, items: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }] });
  assert.equal(result.success, false);
});

test("rejects invalid contact values and quantities", () => {
  assert.equal(orderSchema.safeParse({ ...validOrder, phone: "call me", items: [{ productId: 1, quantity: 0 }] }).success, false);
});

test("product inventory fields are bounded integers", () => {
  assert.equal(productSchema.safeParse({ stock: 4, lowStockThreshold: 2, active: true }).success, true);
  assert.equal(productSchema.safeParse({ stock: -1 }).success, false);
});

test("payment report and cancellation transitions are represented", () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.PENDING_PAYMENT, ["PAYMENT_REPORTED", "PAID", "CANCELLED"]);
  assert.deepEqual(ALLOWED_TRANSITIONS.PAYMENT_REPORTED, ["PAID", "CANCELLED"]);
});

test("admin middleware rejects guests and customer accounts", () => {
  const statuses = [];
  const response = { status(code) { statuses.push(code); return this; }, json(body) { this.body = body; return this; } };
  requireAdmin({ session: {} }, response, () => assert.fail("guest must not pass"));
  requireAdmin({ session: { user: { role: "CUSTOMER" } } }, response, () => assert.fail("customer must not pass"));
  assert.deepEqual(statuses, [401, 401]);
});

test("user middleware allows authenticated customers", () => {
  let passed = false;
  requireUser({ session: { user: { id: 7, role: "CUSTOMER" } } }, {}, () => { passed = true; });
  assert.equal(passed, true);
});

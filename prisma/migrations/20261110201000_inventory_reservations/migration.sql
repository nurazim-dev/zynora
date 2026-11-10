CREATE TYPE "InventoryMovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'RESERVE', 'RELEASE', 'SALE', 'RETURN');

ALTER TABLE "Product"
ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 3;

UPDATE "Order"
SET "status" = 'PAYMENT_REPORTED'
WHERE "status" = 'PENDING_PAYMENT' AND "paymentReported" = TRUE;

CREATE TABLE "InventoryMovement" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryMovement_productId_createdAt_idx" ON "InventoryMovement"("productId", "createdAt");
CREATE INDEX "InventoryMovement_orderId_createdAt_idx" ON "InventoryMovement"("orderId", "createdAt");

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "InventoryMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH pending_reservations AS (
    SELECT oi."productId", SUM(oi."quantity")::INTEGER AS quantity
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    WHERE oi."productId" IS NOT NULL AND o."status" IN ('PENDING_PAYMENT', 'PAYMENT_REPORTED')
    GROUP BY oi."productId"
)
UPDATE "Product" p
SET "stock" = p."stock" + r.quantity,
    "reservedStock" = r.quantity
FROM pending_reservations r
WHERE p."id" = r."productId";

INSERT INTO "InventoryMovement" ("productId", "orderId", "type", "quantity", "note")
SELECT oi."productId", o."id", 'RESERVE', oi."quantity", 'Существующий резерв неоплаченного заказа'
FROM "OrderItem" oi
JOIN "Order" o ON o."id" = oi."orderId"
WHERE oi."productId" IS NOT NULL AND o."status" IN ('PENDING_PAYMENT', 'PAYMENT_REPORTED');

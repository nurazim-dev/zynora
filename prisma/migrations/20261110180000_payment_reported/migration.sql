ALTER TABLE "Order"
ADD COLUMN "paymentReported" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "paymentReportedAt" TIMESTAMP(3);

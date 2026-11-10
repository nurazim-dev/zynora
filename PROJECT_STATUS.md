# ZYNORA implementation status

## Existing foundation

- Vanilla JavaScript storefront, Express modular routes, PostgreSQL/Prisma, sessions, catalog, customer accounts, favorites, coupons, reviews, checkout, QR payment, admin dashboard, and Telegram notifications already exist.
- Existing product/order identifiers and product records are retained; no destructive schema reset is acceptable.
- Payment reports have a separate `PAYMENT_REPORTED` status; only an administrator can confirm payment.
- Unpaid orders reserve inventory separately from physical stock, and inventory changes are recorded.
- Existing unpaid orders are migrated with their stock reservations preserved. The current database migration was backed up and applied without reset.

## Current specification pass

- Preserve the current stack and local-first workflow.
- Add explicit payment-reported state and inventory reservations so unpaid orders do not reduce on-hand stock.
- Add missing storefront/admin/production essentials in small migrations.
- Automated checks cover order validation, inventory input bounds, order status transitions, and session/role middleware.
- Keep real bank/Telegram integration boundaries honest; credentials and MBank verification remain external.
- Added server pagination, comparison, recently viewed products, warehouse history, order CSV/print invoice, retryable Telegram notification, API v1, health check, upload validation, and production Docker/Nginx files.
- Added five Node test-runner checks for order validation and payment transition rules.

## Constraints / not yet done

- Existing integer primary keys will not be rewritten to UUIDs because that would risk existing order/product references.
- Email delivery, bank payment verification, shipping carrier integration, and remote object storage need provider credentials and are not implemented as fake integrations.
- Full acceptance scope still needs broader browser responsive QA, end-to-end checkout tests, richer analytics/date filters, product variants/questions/newsletter, audit logging, and final SEO structured data. Production deployment, HTTPS, backup scheduling, and external provider credentials are intentionally left for the owner.

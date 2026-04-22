// ─────────────────────────────────────────────────────────────────
//  FreshBox O2C – Service Definition
// ─────────────────────────────────────────────────────────────────
using freshbox.o2c as db from '../db/schema';

service O2CService @(path:'/api/o2c') {

  // ── Master data (read-only projections) ─────────────────────────
  @readonly entity Customers   as projection on db.Customers;
  @readonly entity Products    as projection on db.Products;

  // ── O2C Documents ────────────────────────────────────────────────
  entity Inquiries    as projection on db.Inquiries    actions {
    action convertToQuotation(discountPct: Decimal(5,2)) returns Quotations;
  };
  entity InquiryItems as projection on db.InquiryItems;

  entity Quotations   as projection on db.Quotations   actions {
    action acceptQuotation()  returns SalesOrders;
    action rejectQuotation()  returns String;
  };
  entity QuotationItems as projection on db.QuotationItems;

  entity SalesOrders  as projection on db.SalesOrders  actions {
    action createDelivery(
      batchLabel   : String(50),
      plannedDate  : Date,
      items        : array of {
        soItemId   : UUID;
        qty        : Integer;
      }
    ) returns Deliveries;
  };
  entity SalesOrderItems  as projection on db.SalesOrderItems;
  entity ScheduleLines    as projection on db.ScheduleLines;

  entity Deliveries   as projection on db.Deliveries   actions {
    action postGoodsIssue() returns String;
    action cancelDelivery() returns String;
  };
  entity DeliveryItems    as projection on db.DeliveryItems;

  entity Invoices     as projection on db.Invoices     actions {
    action markPaid()        returns String;
    action cancelInvoice()   returns String;
  };
  entity InvoiceItems     as projection on db.InvoiceItems;
  entity InvoiceDeliveries as projection on db.InvoiceDeliveries;

  // ── Convenience action: bill multiple deliveries at once ──────────
  action createInvoiceFromDeliveries(
    deliveryIds  : array of String,
    invoiceDate  : Date,
    dueDate      : Date
  ) returns Invoices;

  // ── Read-only reporting views ─────────────────────────────────────
  @readonly view DocumentFlow as select from db.SalesOrders {
    ID              as salesOrderId,
    status          as soStatus,
    customer.name   as customerName,
    orderDate,
    // aggregated counts via sub-selects handled in service impl
  };
}

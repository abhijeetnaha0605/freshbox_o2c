// ─────────────────────────────────────────────────────────────────
//  FreshBox O2C – Core Data Model
//  Mirrors the SAP SD document flow:
//    Inquiry → Quotation → Sales Order → Delivery(×n) → Invoice
// ─────────────────────────────────────────────────────────────────
namespace freshbox.o2c;

using { managed, cuid } from '@sap/cds/common';

// ── Lookup / Master Data ──────────────────────────────────────────

entity Customers : managed {
  key ID          : String(10);
  name            : String(100) not null;
  address         : String(200);
  gstin           : String(15);
  contactPerson   : String(80);
  email           : String(100);
  phone           : String(15);
}

entity Products : managed {
  key ID          : String(10);
  name            : String(100) not null;
  description     : String(300);
  basePrice       : Decimal(10,2) not null;
  uom             : String(5) default 'EA';
  gstRate         : Decimal(5,2) default 18.00; // GST % (CGST+SGST or IGST)
  stockQty        : Integer default 0;
}

// ── O2C Document Entities ─────────────────────────────────────────

entity Inquiries : managed {
  key ID            : String(12);
  customer          : Association to Customers;
  inquiryDate       : Date;
  validUntil        : Date;
  notes             : String(500);
  status            : String(20) default 'Open'; // Open | Converted | Cancelled
  items             : Composition of many InquiryItems on items.inquiry = $self;
}

entity InquiryItems {
  key ID            : UUID;
  inquiry           : Association to Inquiries;
  product           : Association to Products;
  requestedQty      : Integer not null;
  notes             : String(200);
}

// ─────────────────────────────────────────────────────────────────

entity Quotations : managed {
  key ID            : String(12);
  inquiry           : Association to Inquiries;
  customer          : Association to Customers;
  quotationDate     : Date;
  validUntil        : Date;
  discountPct       : Decimal(5,2) default 0;   // e.g. 15 for 15 %
  notes             : String(500);
  status            : String(20) default 'Open'; // Open | Accepted | Rejected | Expired
  items             : Composition of many QuotationItems on items.quotation = $self;
  // Calculated totals (virtual, populated by service)
  virtual netAmount   : Decimal(12,2);
  virtual gstAmount   : Decimal(12,2);
  virtual totalAmount : Decimal(12,2);
}

entity QuotationItems {
  key ID            : UUID;
  quotation         : Association to Quotations;
  product           : Association to Products;
  quantity          : Integer not null;
  unitPrice         : Decimal(10,2) not null;
  discountPct       : Decimal(5,2) default 0;
  // Calculated
  virtual lineNet   : Decimal(12,2);
}

// ─────────────────────────────────────────────────────────────────

entity SalesOrders : managed {
  key ID              : String(12);
  quotation           : Association to Quotations;
  customer            : Association to Customers;
  orderDate           : Date;
  requestedDelivDate  : Date;
  salesOrg            : String(10) default 'IN00';
  distChannel         : String(5)  default 'WH';
  division            : String(5)  default 'FB';
  discountPct         : Decimal(5,2) default 0;
  status              : String(20) default 'Open';
  // Open | PartiallyDelivered | FullyDelivered | Billed | Cancelled
  notes               : String(500);
  items               : Composition of many SalesOrderItems on items.salesOrder = $self;
  virtual netAmount   : Decimal(12,2);
  virtual gstAmount   : Decimal(12,2);
  virtual totalAmount : Decimal(12,2);
}

entity SalesOrderItems {
  key ID            : UUID;
  salesOrder        : Association to SalesOrders;
  product           : Association to Products;
  quantity          : Integer not null;
  unitPrice         : Decimal(10,2) not null;
  discountPct       : Decimal(5,2) default 0;
  openQty           : Integer;   // remaining to be delivered
  virtual lineNet   : Decimal(12,2);
  scheduleLines     : Composition of many ScheduleLines on scheduleLines.soItem = $self;
}

entity ScheduleLines {
  key ID            : UUID;
  soItem            : Association to SalesOrderItems;
  deliveryDate      : Date not null;
  scheduledQty      : Integer not null;
  deliveredQty      : Integer default 0;
}

// ─────────────────────────────────────────────────────────────────

entity Deliveries : managed {
  key ID            : String(12);
  salesOrder        : Association to SalesOrders;
  customer          : Association to Customers;
  plannedDate       : Date;
  actualDate        : Date;
  status            : String(20) default 'Pending';
  // Pending | Picked | Packed | GoodsIssued | Cancelled
  batchLabel        : String(50);   // e.g. "Lunch Batch – Day 1"
  items             : Composition of many DeliveryItems on items.delivery = $self;
}

entity DeliveryItems {
  key ID            : UUID;
  delivery          : Association to Deliveries;
  soItem            : Association to SalesOrderItems;
  product           : Association to Products;
  deliveredQty      : Integer not null;
  unitPrice         : Decimal(10,2);
}

// ─────────────────────────────────────────────────────────────────

entity Invoices : managed {
  key ID            : String(12);
  customer          : Association to Customers;
  invoiceDate       : Date;
  dueDate           : Date;
  status            : String(20) default 'Open'; // Open | Paid | Cancelled
  notes             : String(500);
  items             : Composition of many InvoiceItems on items.invoice = $self;
  deliveries        : Association to many InvoiceDeliveries on deliveries.invoice = $self;
  virtual baseAmount  : Decimal(12,2);
  virtual discountAmt : Decimal(12,2);
  virtual netAmount   : Decimal(12,2);
  virtual cgst        : Decimal(12,2);
  virtual sgst        : Decimal(12,2);
  virtual igst        : Decimal(12,2);
  virtual totalAmount : Decimal(12,2);
}

entity InvoiceItems {
  key ID            : UUID;
  invoice           : Association to Invoices;
  delivery          : Association to Deliveries;
  soItem            : Association to SalesOrderItems;
  product           : Association to Products;
  quantity          : Integer not null;
  unitPrice         : Decimal(10,2) not null;
  discountPct       : Decimal(5,2) default 0;
  gstRate           : Decimal(5,2) default 18.00;
  virtual lineNet   : Decimal(12,2);
  virtual lineGst   : Decimal(12,2);
  virtual lineTotal : Decimal(12,2);
}

// Link table – which deliveries are covered by an invoice
entity InvoiceDeliveries {
  key invoice    : Association to Invoices;
  key delivery   : Association to Deliveries;
}

#!/usr/bin/env node
/**
 * FreshBox O2C – Standalone Integration Test Suite
 * Zero dependencies. Uses only Node.js built-in `http` module.
 * Run:  node tests/test-standalone.js
 * Requires server to be running: node server.js
 */
'use strict';

const http = require('http');

const BASE = 'http://localhost:3000';
let passed = 0, failed = 0, soItemIds = [];

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3000,
      path, method,
      headers: { 'Content-Type': 'application/json',
                 ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    };
    const r = http.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.log(`  ❌  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function run() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🍱  FreshBox Foods O2C — Integration Test Suite');
  console.log('═'.repeat(60));

  // ─── Scenario A: Master Data ────────────────────────────────────
  console.log('\n📦 Scenario A — Master Data Verification\n');

  const cust = await req('GET', '/api/customers');
  assert(cust.status === 200, 'GET /api/customers returns 200');
  assert(cust.data.value.length >= 3, 'At least 3 customers seeded');
  assert(cust.data.value[0].ID === 'TECH01', 'TechPark Cafeteria present');
  assert(cust.data.value[0].gstin === '29AADCT1234F1Z5', 'GSTIN correctly seeded');

  const prods = await req('GET', '/api/products');
  assert(prods.status === 200, 'GET /api/products returns 200');
  assert(prods.data.value.length >= 5, 'At least 5 products seeded');
  const vegBox = prods.data.value.find(p => p.ID === 'MEAL-VEG');
  assert(vegBox !== undefined, 'MEAL-VEG product exists');
  assert(vegBox.basePrice === 180.00, 'MEAL-VEG base price = ₹180');
  assert(vegBox.gstRate === 5.00, 'MEAL-VEG GST rate = 5% (food item)');
  assert(vegBox.stockQty === 500, 'MEAL-VEG initial stock = 500');

  // ─── Scenario B: Full O2C Happy Path ───────────────────────────
  console.log('\n🛒 Scenario B — Full O2C Happy Path (TechPark 120 Meals)\n');

  // Step 1: Create Inquiry
  const inqR = await req('POST', '/api/inquiries', {
    customer_ID: 'TECH01',
    inquiryDate: '2025-01-15',
    validUntil: '2025-01-22',
    notes: 'Need 120 meal boxes for 2 days – Lunch and Dinner batches',
    items: [
      { product_ID: 'MEAL-VEG', requestedQty: 80 },
      { product_ID: 'MEAL-NVG', requestedQty: 40 }
    ]
  });
  assert(inqR.status === 201, 'Inquiry created (201)');
  const inqId = inqR.data.ID;
  assert(inqId.startsWith('INQ'), `Inquiry ID format correct: ${inqId}`);
  assert(inqR.data.status === 'Open', 'Inquiry status = Open');
  assert(inqR.data.customer_ID === 'TECH01', 'Inquiry linked to TechPark');

  // Step 2: Convert to Quotation (15% discount for 100+ meals)
  const qtR = await req('POST', `/api/inquiries/${inqId}/convert`, { discountPct: 15 });
  assert(qtR.status === 200, 'Inquiry converted to Quotation');
  const qtId = qtR.data.ID;
  assert(qtId.startsWith('QT'), `Quotation ID format correct: ${qtId}`);
  assert(qtR.data.discountPct === 15, 'Discount 15% set on Quotation');
  assert(qtR.data.items.length === 2, '2 quotation items inherited from Inquiry');

  // Verify inquiry is now Converted
  const inqCheck = await req('GET', '/api/inquiries');
  const inqFinal = inqCheck.data.value.find(i => i.ID === inqId);
  assert(inqFinal.status === 'Converted', 'Inquiry status → Converted after conversion');

  // Check item pricing
  const vegItem = qtR.data.items.find(i => i.product_ID === 'MEAL-VEG');
  assert(vegItem.unitPrice === 180, 'VEG item unitPrice = ₹180 (from product master)');
  assert(vegItem.discountPct === 15, 'VEG item discountPct = 15%');

  // Step 3: Accept Quotation → Sales Order
  const soR = await req('POST', `/api/quotations/${qtId}/accept`);
  assert(soR.status === 200, 'Quotation accepted → Sales Order created');
  const soId = soR.data.ID;
  assert(soId.startsWith('SO'), `Sales Order ID correct: ${soId}`);
  assert(soR.data.status === 'Open', 'Sales Order status = Open');
  assert(soR.data.salesOrg === 'IN00', 'Sales Org = IN00');
  assert(soR.data.distChannel === 'WH', 'Distribution Channel = WH');
  assert(soR.data.division === 'FB', 'Division = FB (FreshBox)');
  assert(soR.data.items.length === 2, '2 SO items created');

  soItemIds = soR.data.items.map(i => i.ID);
  const soVegItem = soR.data.items.find(i => i.product_ID === 'MEAL-VEG');
  const soNvgItem = soR.data.items.find(i => i.product_ID === 'MEAL-NVG');
  assert(soVegItem.openQty === 80, 'MEAL-VEG openQty = 80');
  assert(soNvgItem.openQty === 40, 'MEAL-NVG openQty = 40');

  // Step 4a: Delivery 1 – Lunch Batch (60 meals)
  const dlv1R = await req('POST', `/api/salesorders/${soId}/deliver`, {
    batchLabel: 'Lunch Batch – Day 1',
    plannedDate: '2025-01-16',
    items: [
      { soItemId: soVegItem.ID, qty: 40 },
      { soItemId: soNvgItem.ID, qty: 20 }
    ]
  });
  assert(dlv1R.status === 200, 'Delivery 1 (Lunch Batch) created');
  const dlv1Id = dlv1R.data.ID;
  assert(dlv1Id.startsWith('DL'), `Delivery ID correct: ${dlv1Id}`);
  assert(dlv1R.data.batchLabel === 'Lunch Batch – Day 1', 'Batch label correct');
  assert(dlv1R.data.status === 'Pending', 'Delivery 1 status = Pending');

  // Verify SO is PartiallyDelivered
  const soCheck1 = await req('GET', '/api/salesorders');
  const soMid = soCheck1.data.value.find(s => s.ID === soId);
  assert(soMid.status === 'PartiallyDelivered', 'SO status → PartiallyDelivered after Dlv1');
  const vegAfterDlv1 = soMid.items.find(i => i.product_ID === 'MEAL-VEG');
  assert(vegAfterDlv1.openQty === 40, 'MEAL-VEG openQty reduced to 40 after Dlv1');

  // Post Goods Issue – Delivery 1
  const gi1R = await req('POST', `/api/deliveries/${dlv1Id}/goodsissue`);
  assert(gi1R.status === 200, `GI posted for Delivery 1 (${dlv1Id})`);

  // Verify stock reduced
  const prodsAfterGI1 = await req('GET', '/api/products');
  const vegAfterGI1 = prodsAfterGI1.data.value.find(p => p.ID === 'MEAL-VEG');
  assert(vegAfterGI1.stockQty === 460, `MEAL-VEG stock: 500 - 40 = 460 after GI1`);

  // Step 4b: Delivery 2 – Dinner Batch (remaining 60 meals)
  const dlv2R = await req('POST', `/api/salesorders/${soId}/deliver`, {
    batchLabel: 'Dinner Batch – Day 2',
    plannedDate: '2025-01-17',
    items: [
      { soItemId: soVegItem.ID, qty: 40 },
      { soItemId: soNvgItem.ID, qty: 20 }
    ]
  });
  assert(dlv2R.status === 200, 'Delivery 2 (Dinner Batch) created');
  const dlv2Id = dlv2R.data.ID;

  // Verify SO is now FullyDelivered
  const soCheck2 = await req('GET', '/api/salesorders');
  const soFull = soCheck2.data.value.find(s => s.ID === soId);
  assert(soFull.status === 'FullyDelivered', 'SO status → FullyDelivered after Dlv2');

  // Post Goods Issue – Delivery 2
  const gi2R = await req('POST', `/api/deliveries/${dlv2Id}/goodsissue`);
  assert(gi2R.status === 200, `GI posted for Delivery 2 (${dlv2Id})`);

  // Verify stock further reduced
  const prodsAfterGI2 = await req('GET', '/api/products');
  const vegAfterGI2 = prodsAfterGI2.data.value.find(p => p.ID === 'MEAL-VEG');
  assert(vegAfterGI2.stockQty === 420, `MEAL-VEG stock: 460 - 40 = 420 after GI2`);
  const nvgAfterGI2 = prodsAfterGI2.data.value.find(p => p.ID === 'MEAL-NVG');
  assert(nvgAfterGI2.stockQty === 360, `MEAL-NVG stock: 400 - 40 = 360 after both GIs`);

  // Step 5: Create Invoice (both deliveries combined)
  const invR = await req('POST', '/api/invoices/create', {
    deliveryIds: [dlv1Id, dlv2Id],
    invoiceDate: '2025-01-17',
    dueDate: '2025-02-16'
  });
  assert(invR.status === 201, 'Invoice created (201)');
  const invId = invR.data.ID;
  assert(invId.startsWith('IV'), `Invoice ID correct: ${invId}`);
  assert(invR.data.items.length === 4, '4 invoice line items (2 products × 2 deliveries)');

  // Verify GST calculation
  // MEAL-VEG: 80 units × ₹180 × (1-15%) = ₹12,240 net; GST 5% = ₹612
  // MEAL-NVG: 40 units × ₹220 × (1-15%) = ₹7,480 net; GST 5% = ₹374
  // Total net = ₹19,720; Total GST = ₹986; Total = ₹20,706
  assert(invR.data.netAmount === 19720, `Net amount = ₹19,720 (after 15% discount)`);
  assert(invR.data.cgst === 493, `CGST = ₹493 (2.5% of ₹19,720)`);
  assert(invR.data.sgst === 493, `SGST = ₹493 (2.5% of ₹19,720)`);
  assert(invR.data.totalAmount === 20706, `Total payable = ₹20,706`);
  assert(invR.data.discountAmt === 3480, `Discount = ₹3,480 (15% on ₹23,200 gross)`);

  // Verify SO is now Billed
  const soFinalCheck = await req('GET', '/api/salesorders');
  const soBilled = soFinalCheck.data.value.find(s => s.ID === soId);
  assert(soBilled.status === 'Billed', 'SO status → Billed after invoice creation');

  // Mark Invoice Paid
  const paidR = await req('POST', `/api/invoices/${invId}/pay`);
  assert(paidR.status === 200, `Invoice ${invId} marked as Paid`);
  const invCheck = await req('GET', '/api/invoices');
  const paidInv = invCheck.data.value.find(i => i.ID === invId);
  assert(paidInv.status === 'Paid', 'Invoice status = Paid');

  // ─── Scenario C: Error Handling ────────────────────────────────
  console.log('\n🚫 Scenario C — Error & Validation Handling\n');

  // Cannot convert already-converted inquiry
  const dupConvert = await req('POST', `/api/inquiries/${inqId}/convert`, { discountPct: 10 });
  assert(dupConvert.status === 400, 'Duplicate Inquiry conversion blocked (400)');

  // Cannot accept already-accepted quotation
  const dupAccept = await req('POST', `/api/quotations/${qtId}/accept`);
  assert(dupAccept.status === 400, 'Duplicate Quotation acceptance blocked (400)');

  // Cannot deliver more than openQty
  const soItems2 = soFinalCheck.data.value.find(s => s.ID === soId).items;
  const overDeliver = await req('POST', `/api/salesorders/${soId}/deliver`, {
    batchLabel: 'Overflow Batch',
    items: [{ soItemId: soItems2[0].ID, qty: 999 }]
  });
  assert(overDeliver.status === 400, 'Over-delivery blocked (400)');

  // Cannot post GI on already GI'd delivery
  const dupGI = await req('POST', `/api/deliveries/${dlv1Id}/goodsissue`);
  assert(dupGI.status === 400, 'Duplicate Goods Issue blocked (400)');

  // Cannot invoice a non-GoodsIssued delivery
  const inq2 = await req('POST', '/api/inquiries', {
    customer_ID: 'CORP02',
    items: [{ product_ID: 'BRKFT-01', requestedQty: 50 }]
  });
  const qt2 = await req('POST', `/api/inquiries/${inq2.data.ID}/convert`, { discountPct: 0 });
  const so2 = await req('POST', `/api/quotations/${qt2.data.ID}/accept`);
  const so2Items = so2.data.items;
  const dlvPending = await req('POST', `/api/salesorders/${so2.data.ID}/deliver`, {
    batchLabel: 'Pending delivery',
    items: [{ soItemId: so2Items[0].ID, qty: 50 }]
  });
  const invBeforeGI = await req('POST', '/api/invoices/create', {
    deliveryIds: [dlvPending.data.ID]
  });
  assert(invBeforeGI.status === 400, 'Invoice before GoodsIssue blocked (400)');

  // Cannot pay already-paid invoice
  const dupPay = await req('POST', `/api/invoices/${invId}/pay`);
  assert(dupPay.status === 400, 'Double payment blocked (400)');

  // ─── Scenario D: Stats & Audit ─────────────────────────────────
  console.log('\n📊 Scenario D — Dashboard Stats & Audit Trail\n');

  const stats = await req('GET', '/api/stats');
  assert(stats.status === 200, 'Stats endpoint returns 200');
  assert(stats.data.inquiries >= 2, `Inquiries count >= 2 (got ${stats.data.inquiries})`);
  assert(stats.data.salesOrders >= 2, `Sales Orders count >= 2`);
  assert(stats.data.deliveries >= 3, `Deliveries count >= 3`);
  assert(stats.data.goodsIssued >= 2, `Goods Issued >= 2`);
  assert(stats.data.paidInvoices >= 1, `Paid invoices >= 1`);
  assert(stats.data.totalSpend === 20706, `Total spend = ₹20,706 (matches invoice)`);

  const auditR = await req('GET', '/api/audit');
  assert(auditR.status === 200, 'Audit log endpoint returns 200');
  assert(auditR.data.value.length >= 8, `Audit log has >= 8 entries (got ${auditR.data.value.length})`);
  const auditActions = auditR.data.value.map(a => a.action);
  assert(auditActions.includes('INVOICE_PAID'),    'Audit: INVOICE_PAID event recorded');
  assert(auditActions.includes('INVOICE_CREATED'), 'Audit: INVOICE_CREATED event recorded');
  assert(auditActions.includes('GOODS_ISSUE_POSTED'), 'Audit: GOODS_ISSUE_POSTED event recorded');
  assert(auditActions.includes('DELIVERY_CREATED'), 'Audit: DELIVERY_CREATED event recorded');
  assert(auditActions.includes('SALES_ORDER_CREATED'), 'Audit: SALES_ORDER_CREATED event recorded');
  assert(auditActions.includes('QUOTATION_CREATED'), 'Audit: QUOTATION_CREATED event recorded');
  assert(auditActions.includes('INQUIRY_CREATED'), 'Audit: INQUIRY_CREATED event recorded');

  // ─── Summary ──────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  📄  Document Flow Chain');
  console.log('═'.repeat(60));
  console.log(`  ${inqId} (Inquiry)        → status: Converted`);
  console.log(`  ${qtId}  (Quotation)       → status: Accepted, discount: 15%`);
  console.log(`  ${soId}  (Sales Order)     → status: Billed`);
  console.log(`  ${dlv1Id} (Delivery 1)     → Lunch Batch Day 1, GoodsIssued`);
  console.log(`  ${dlv2Id} (Delivery 2)     → Dinner Batch Day 2, GoodsIssued`);
  console.log(`  ${invId}  (Invoice)         → status: Paid, Total: ₹20,706`);

  console.log('\n' + '═'.repeat(60));
  console.log(`  Test Results:  ✅ ${passed} passed   ❌ ${failed} failed`);
  console.log('═'.repeat(60) + '\n');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});

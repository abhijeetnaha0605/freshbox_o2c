#!/usr/bin/env node
/**
 * FreshBox O2C – Automated Integration Test
 * Run:  node tests/integration-test.js
 * Requires the server to be running: cds watch
 */

const BASE = 'http://localhost:4004/api/o2c';

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${txt}`);
  }
  return res.json();
}

function pass(msg) { console.log('  ✅', msg); }
function fail(msg) { console.error('  ❌', msg); process.exitCode = 1; }

async function run() {
  console.log('\n🍱 FreshBox O2C – Integration Test\n');

  // ── Master data ────────────────────────────────────────────────
  console.log('1. Checking master data...');
  const customers = await req('GET', '/Customers');
  const products  = await req('GET', '/Products');
  customers.value.length >= 1 ? pass('Customers loaded') : fail('No customers');
  products.value.length  >= 1 ? pass('Products loaded')  : fail('No products');

  // ── Inquiry ────────────────────────────────────────────────────
  console.log('\n2. Creating Inquiry...');
  const inqId = 'INQ' + Date.now().toString().slice(-6);
  await req('POST', '/Inquiries', {
    ID: inqId,
    customer_ID: 'TECH01',
    inquiryDate: '2025-01-15',
    validUntil:  '2025-01-22',
    status: 'Open',
    items: [
      { product_ID: 'MEAL-VEG', requestedQty: 80 },
      { product_ID: 'MEAL-NVG', requestedQty: 40 }
    ]
  });
  pass(`Inquiry ${inqId} created`);

  // ── Convert to Quotation ───────────────────────────────────────
  console.log('\n3. Converting to Quotation (15% discount)...');
  const qt = await req('POST', `/Inquiries('${inqId}')/O2CService.convertToQuotation`,
    { discountPct: 15 });
  const qtId = qt.ID;
  pass(`Quotation ${qtId} created, discountPct=${qt.discountPct}`);
  if (qt.discountPct !== 15) fail('Discount not set correctly');

  // ── Accept Quotation ───────────────────────────────────────────
  console.log('\n4. Accepting Quotation → Sales Order...');
  const so = await req('POST', `/Quotations('${qtId}')/O2CService.acceptQuotation`, {});
  const soId = so.ID;
  pass(`Sales Order ${soId} created`);

  // Get SO items
  const soItemsRes = await req('GET', `/SalesOrderItems?$filter=salesOrder_ID eq '${soId}'`);
  const soItems = soItemsRes.value;
  if (soItems.length < 2) { fail('Expected 2 SO items'); return; }
  pass(`${soItems.length} SO items with openQty set`);

  // ── Delivery 1 ─────────────────────────────────────────────────
  console.log('\n5a. Creating Delivery 1 (Lunch Batch)...');
  const dlv1 = await req('POST', `/SalesOrders('${soId}')/O2CService.createDelivery`, {
    batchLabel: 'Lunch Batch – Day 1',
    plannedDate: '2025-01-16',
    items: soItems.map(i => ({ soItemId: i.ID, qty: Math.floor(i.quantity / 2) }))
  });
  const dlv1Id = dlv1.ID;
  pass(`Delivery ${dlv1Id} created`);

  // Post GI for delivery 1
  const gi1 = await req('POST', `/Deliveries('${dlv1Id}')/O2CService.postGoodsIssue`, {});
  pass(`GI posted: ${gi1}`);

  // ── Delivery 2 ─────────────────────────────────────────────────
  console.log('\n5b. Creating Delivery 2 (Dinner Batch)...');
  const soItemsUpdated = (await req('GET', `/SalesOrderItems?$filter=salesOrder_ID eq '${soId}'`)).value;
  const dlv2 = await req('POST', `/SalesOrders('${soId}')/O2CService.createDelivery`, {
    batchLabel: 'Dinner Batch – Day 2',
    plannedDate: '2025-01-17',
    items: soItemsUpdated.filter(i => i.openQty > 0)
              .map(i => ({ soItemId: i.ID, qty: i.openQty }))
  });
  const dlv2Id = dlv2.ID;
  pass(`Delivery ${dlv2Id} created`);

  const gi2 = await req('POST', `/Deliveries('${dlv2Id}')/O2CService.postGoodsIssue`, {});
  pass(`GI posted: ${gi2}`);

  // ── Invoice ────────────────────────────────────────────────────
  console.log('\n6. Creating Invoice from both deliveries...');
  const inv = await req('POST', '/createInvoiceFromDeliveries', {
    deliveryIds: [dlv1Id, dlv2Id],
    invoiceDate: '2025-01-17',
    dueDate: '2025-02-16'
  });
  const invId = inv.ID;
  pass(`Invoice ${invId} created`);

  // Mark paid
  const paid = await req('POST', `/Invoices('${invId}')/O2CService.markPaid`, {});
  pass(`${paid}`);

  // ── Final verification ─────────────────────────────────────────
  console.log('\n7. Verifying document states...');
  const finalInq = await req('GET', `/Inquiries('${inqId}')`);
  const finalQt  = await req('GET', `/Quotations('${qtId}')`);
  const finalSO  = await req('GET', `/SalesOrders('${soId}')`);
  const finalInv = await req('GET', `/Invoices('${invId}')`);

  finalInq.status === 'Converted' ? pass(`Inquiry: ${finalInq.status}`) : fail(`Inquiry status=${finalInq.status}`);
  finalQt.status  === 'Accepted'  ? pass(`Quotation: ${finalQt.status}`) : fail(`Quotation status=${finalQt.status}`);
  finalSO.status  === 'Billed'    ? pass(`Sales Order: ${finalSO.status}`) : fail(`SO status=${finalSO.status}`);
  finalInv.status === 'Paid'      ? pass(`Invoice: ${finalInv.status}`) : fail(`Invoice status=${finalInv.status}`);

  console.log('\n' + '─'.repeat(50));
  console.log('📄 Document Flow:');
  console.log(`  ${inqId} → ${qtId} → ${soId} → ${dlv1Id}, ${dlv2Id} → ${invId}`);
  console.log('─'.repeat(50));
  console.log(process.exitCode ? '\n❌ Some tests failed.' : '\n✅ All tests passed!\n');
}

run().catch(err => { console.error('\n💥 Fatal:', err.message); process.exit(1); });

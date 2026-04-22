#!/usr/bin/env node
/**
 * FreshBox O2C – Standalone Server + Integration Test
 * Zero external dependencies — uses only Node.js built-ins
 * Run:  node server-standalone.js
 * This starts an HTTP server on port 4005 AND runs the full test suite.
 */
'use strict';

const http  = require('http');
const url   = require('url');
const crypto = require('crypto');

// ─── In-memory database ───────────────────────────────────────────
const DB = {
  customers: [
    { ID: 'TECH01', name: 'TechPark Cafeteria',   address: 'Plot 12, Tech Hub, Bangalore', gstin: '29AADCT1234F1Z5', contactPerson: 'Rahul Sharma', email: 'rahul@techpark.in', phone: '+91-9876543210' },
    { ID: 'CORP02', name: 'Infosys Pantry',        address: 'Electronics City, Bangalore',  gstin: '29AADCI5678G2Z3', contactPerson: 'Priya Nair',   email: 'priya@infosys.com',  phone: '+91-9876543211' },
    { ID: 'STAR03', name: 'StarHealth Canteen',    address: 'New Tank Street, Chennai',     gstin: '33AADCS9012H3Z1', contactPerson: 'Meena Pillai', email: 'meena@starhealth.in',phone: '+91-9876543212' }
  ],
  products: [
    { ID: 'MEAL-VEG', name: 'Veg Meal Box',      basePrice: 180, uom: 'EA', gstRate: 5,  stockQty: 500 },
    { ID: 'MEAL-NVG', name: 'Non-Veg Meal Box',  basePrice: 220, uom: 'EA', gstRate: 5,  stockQty: 400 },
    { ID: 'MEAL-PRE', name: 'Premium Meal Box',  basePrice: 320, uom: 'EA', gstRate: 5,  stockQty: 200 },
    { ID: 'SNACK-PM', name: 'Evening Snack Pack', basePrice: 80,  uom: 'EA', gstRate: 18, stockQty: 300 },
    { ID: 'BRKFT-01', name: 'Breakfast Box',      basePrice: 120, uom: 'EA', gstRate: 5,  stockQty: 250 }
  ],
  inquiries:     [],
  quotations:    [],
  salesOrders:   [],
  soItems:       [],
  deliveries:    [],
  deliveryItems: [],
  invoices:      [],
  invoiceItems:  []
};

// ─── Counters ────────────────────────────────────────────────────
const counters = { INQ: 0, QT: 0, SO: 0, DL: 0, IV: 0 };
function nextId(pfx) { return pfx + String(++counters[pfx]).padStart(6, '0'); }
function uuid()       { return crypto.randomUUID(); }

// ─── Business Logic ───────────────────────────────────────────────
function calcLineNet(price, qty, disc) { return +(price * qty * (1 - disc / 100)).toFixed(2); }
function calcGST(net, rate)            { return +(net * rate / 100).toFixed(2); }

function getCustomer(id) { return DB.customers.find(c => c.ID === id); }
function getProduct(id)  { return DB.products.find(p => p.ID === id); }

// ─── Route handlers ──────────────────────────────────────────────

const routes = {};

function route(method, path, fn) {
  routes[method + ':' + path] = fn;
}

// GET collections
route('GET', '/customers',  () => ({ value: DB.customers }));
route('GET', '/products',   () => ({ value: DB.products  }));
route('GET', '/inquiries',  () => ({ value: DB.inquiries.map(enrichInquiry)  }));
route('GET', '/quotations', () => ({ value: DB.quotations.map(enrichQuotation) }));
route('GET', '/salesorders',() => ({ value: DB.salesOrders.map(enrichSO) }));
route('GET', '/deliveries', () => ({ value: DB.deliveries.map(enrichDelivery) }));
route('GET', '/invoices',   () => ({ value: DB.invoices.map(enrichInvoice)  }));

// ── Enrich helpers ────────────────────────────────────────────────
function enrichInquiry(inq) {
  return { ...inq, customer: getCustomer(inq.customer_ID) };
}
function enrichQuotation(q) {
  const items = q.items.map(it => ({
    ...it,
    product: getProduct(it.product_ID),
    lineNet: calcLineNet(it.unitPrice, it.quantity, it.discountPct)
  }));
  let net = items.reduce((s, i) => s + i.lineNet, 0);
  const gst = calcGST(net, 5);
  return { ...q, customer: getCustomer(q.customer_ID), items, netAmount: +net.toFixed(2), gstAmount: gst, totalAmount: +(net + gst).toFixed(2) };
}
function enrichSO(so) {
  const items = DB.soItems.filter(i => i.salesOrder_ID === so.ID).map(it => ({
    ...it, product: getProduct(it.product_ID),
    lineNet: calcLineNet(it.unitPrice, it.quantity, it.discountPct)
  }));
  let net = items.reduce((s, i) => s + i.lineNet, 0);
  const gst = calcGST(net, 5);
  return { ...so, customer: getCustomer(so.customer_ID), items, netAmount: +net.toFixed(2), gstAmount: gst, totalAmount: +(net + gst).toFixed(2) };
}
function enrichDelivery(d) {
  const items = DB.deliveryItems.filter(i => i.delivery_ID === d.ID)
    .map(it => ({ ...it, product: getProduct(it.product_ID) }));
  return { ...d, customer: getCustomer(d.customer_ID), items };
}
function enrichInvoice(inv) {
  const items = DB.invoiceItems.filter(i => i.invoice_ID === inv.ID).map(it => {
    const gross  = it.unitPrice * it.quantity;
    const discAmt = +(gross * it.discountPct / 100).toFixed(2);
    const lineNet = +(gross - discAmt).toFixed(2);
    const lineGst = calcGST(lineNet, it.gstRate);
    return { ...it, product: getProduct(it.product_ID), lineNet, lineGst, lineTotal: +(lineNet + lineGst).toFixed(2) };
  });
  let base = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  let disc = items.reduce((s, i) => s + i.unitPrice * i.quantity * i.discountPct / 100, 0);
  let gstT = items.reduce((s, i) => s + i.lineGst, 0);
  let net  = base - disc;
  return {
    ...inv, customer: getCustomer(inv.customer_ID), items,
    baseAmount: +base.toFixed(2), discountAmt: +disc.toFixed(2),
    netAmount: +net.toFixed(2), cgst: +(gstT/2).toFixed(2), sgst: +(gstT/2).toFixed(2),
    igst: 0, totalAmount: +(net + gstT).toFixed(2)
  };
}

// ─── Action Handlers ──────────────────────────────────────────────

function createInquiry(body) {
  const id = body.ID || nextId('INQ');
  const cust = getCustomer(body.customer_ID);
  if (!cust) throw { code: 400, message: `Customer ${body.customer_ID} not found` };
  const today = new Date().toISOString().slice(0,10);
  const inq = {
    ID: id, customer_ID: body.customer_ID,
    inquiryDate: body.inquiryDate || today,
    validUntil:  body.validUntil  || new Date(Date.now()+7*86400000).toISOString().slice(0,10),
    notes: body.notes || '', status: 'Open',
    items: (body.items||[]).map(it => ({ ID: uuid(), inquiry_ID: id, product_ID: it.product_ID, requestedQty: it.requestedQty, notes: it.notes||'' }))
  };
  DB.inquiries.push(inq);
  return enrichInquiry(inq);
}

function convertToQuotation(inquiryId, discountPct = 0) {
  const inq = DB.inquiries.find(i => i.ID === inquiryId);
  if (!inq) throw { code: 404, message: `Inquiry ${inquiryId} not found` };
  if (inq.status !== 'Open') throw { code: 400, message: `Inquiry ${inquiryId} is not Open` };
  const qtId = nextId('QT');
  const today = new Date().toISOString().slice(0,10);
  const items = inq.items.map(it => {
    const prod = getProduct(it.product_ID);
    return { ID: uuid(), quotation_ID: qtId, product_ID: it.product_ID, quantity: it.requestedQty, unitPrice: prod?.basePrice || 0, discountPct };
  });
  const qt = {
    ID: qtId, inquiry_ID: inquiryId, customer_ID: inq.customer_ID,
    quotationDate: today, validUntil: new Date(Date.now()+7*86400000).toISOString().slice(0,10),
    discountPct, status: 'Open', items
  };
  DB.quotations.push(qt);
  inq.status = 'Converted';
  return enrichQuotation(qt);
}

function acceptQuotation(qtId) {
  const qt = DB.quotations.find(q => q.ID === qtId);
  if (!qt) throw { code: 404, message: `Quotation ${qtId} not found` };
  if (qt.status !== 'Open') throw { code: 400, message: `Quotation ${qtId} is not Open` };
  const soId = nextId('SO');
  const today = new Date().toISOString().slice(0,10);
  const so = {
    ID: soId, quotation_ID: qtId, customer_ID: qt.customer_ID,
    orderDate: today, discountPct: qt.discountPct,
    salesOrg: 'IN00', distChannel: 'WH', division: 'FB', status: 'Open', notes: ''
  };
  DB.salesOrders.push(so);
  const soItems = qt.items.map(it => ({
    ID: uuid(), salesOrder_ID: soId, product_ID: it.product_ID,
    quantity: it.quantity, unitPrice: it.unitPrice, discountPct: it.discountPct, openQty: it.quantity
  }));
  DB.soItems.push(...soItems);
  qt.status = 'Accepted';
  return enrichSO(so);
}

function createDelivery(soId, { batchLabel, plannedDate, items }) {
  const so = DB.salesOrders.find(s => s.ID === soId);
  if (!so) throw { code: 404, message: `SO ${soId} not found` };
  if (!items || items.length === 0) throw { code: 400, message: 'No items specified' };
  const dlvId = nextId('DL');
  const today  = new Date().toISOString().slice(0,10);
  const dlv = {
    ID: dlvId, salesOrder_ID: soId, customer_ID: so.customer_ID,
    plannedDate: plannedDate || today, actualDate: null,
    status: 'Pending', batchLabel: batchLabel || `Delivery from ${soId}`
  };
  DB.deliveries.push(dlv);
  for (const it of items) {
    const soIt = DB.soItems.find(s => s.ID === it.soItemId);
    if (!soIt) throw { code: 400, message: `SO Item ${it.soItemId} not found` };
    if (it.qty > soIt.openQty) throw { code: 400, message: `Qty ${it.qty} exceeds openQty ${soIt.openQty}` };
    DB.deliveryItems.push({
      ID: uuid(), delivery_ID: dlvId, soItem_ID: it.soItemId,
      product_ID: soIt.product_ID, deliveredQty: it.qty, unitPrice: soIt.unitPrice
    });
    soIt.openQty -= it.qty;
  }
  // update SO status
  const allSoItems = DB.soItems.filter(s => s.salesOrder_ID === soId);
  so.status = allSoItems.every(s => s.openQty === 0) ? 'FullyDelivered' : 'PartiallyDelivered';
  return enrichDelivery(dlv);
}

function postGoodsIssue(dlvId) {
  const dlv = DB.deliveries.find(d => d.ID === dlvId);
  if (!dlv) throw { code: 404, message: `Delivery ${dlvId} not found` };
  if (dlv.status === 'GoodsIssued') throw { code: 400, message: `Already GI'd` };
  // reduce stock
  const items = DB.deliveryItems.filter(i => i.delivery_ID === dlvId);
  for (const it of items) {
    const prod = DB.products.find(p => p.ID === it.product_ID);
    if (prod) prod.stockQty = Math.max(0, prod.stockQty - it.deliveredQty);
  }
  dlv.status = 'GoodsIssued';
  dlv.actualDate = new Date().toISOString().slice(0,10);
  return `Delivery ${dlvId} – Goods Issue posted. Stock updated.`;
}

function createInvoiceFromDeliveries({ deliveryIds, invoiceDate, dueDate }) {
  if (!deliveryIds || deliveryIds.length === 0) throw { code: 400, message: 'No delivery IDs provided' };
  const deliveries = deliveryIds.map(id => {
    const d = DB.deliveries.find(x => x.ID === id);
    if (!d) throw { code: 404, message: `Delivery ${id} not found` };
    if (d.status !== 'GoodsIssued') throw { code: 400, message: `Delivery ${id} not GoodsIssued (status: ${d.status})` };
    return d;
  });
  const customerIds = [...new Set(deliveries.map(d => d.customer_ID))];
  if (customerIds.length > 1) throw { code: 400, message: 'All deliveries must belong to same customer' };
  const today = new Date().toISOString().slice(0,10);
  const invId = nextId('IV');
  const inv = {
    ID: invId, customer_ID: customerIds[0],
    invoiceDate: invoiceDate || today,
    dueDate: dueDate || new Date(Date.now()+30*86400000).toISOString().slice(0,10),
    status: 'Open'
  };
  DB.invoices.push(inv);
  for (const dlv of deliveries) {
    const dlvItems = DB.deliveryItems.filter(i => i.delivery_ID === dlv.ID);
    for (const it of dlvItems) {
      const soIt = DB.soItems.find(s => s.ID === it.soItem_ID);
      const prod = getProduct(it.product_ID);
      DB.invoiceItems.push({
        ID: uuid(), invoice_ID: invId, delivery_ID: dlv.ID, soItem_ID: it.soItem_ID,
        product_ID: it.product_ID, quantity: it.deliveredQty,
        unitPrice: it.unitPrice || soIt?.unitPrice || 0,
        discountPct: soIt?.discountPct || 0, gstRate: prod?.gstRate || 5
      });
    }
  }
  // mark SO billed if fully delivered
  for (const dlv of deliveries) {
    if (dlv.salesOrder_ID) {
      const soItems = DB.soItems.filter(s => s.salesOrder_ID === dlv.salesOrder_ID);
      if (soItems.every(s => s.openQty === 0)) {
        const so = DB.salesOrders.find(s => s.ID === dlv.salesOrder_ID);
        if (so) so.status = 'Billed';
      }
    }
  }
  return enrichInvoice(inv);
}

function markPaid(invId) {
  const inv = DB.invoices.find(i => i.ID === invId);
  if (!inv) throw { code: 404, message: `Invoice ${invId} not found` };
  if (inv.status === 'Paid') throw { code: 400, message: 'Already Paid' };
  inv.status = 'Paid';
  return `Invoice ${invId} marked as Paid.`;
}

// ─── HTTP Server ──────────────────────────────────────────────────

function respond(res, code, data) {
  const body = typeof data === 'string' ? JSON.stringify({ message: data }) : JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { respond(res, 204, {}); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const parsed = url.parse(req.url, true);
    const rawPath = decodeURIComponent(parsed.pathname.replace(/^\/api\/o2c/i, ''));
    const path    = rawPath.toLowerCase();
    try {
      let data = body ? JSON.parse(body) : {};
      let result;
      // Route matching
      if (req.method === 'GET'  && path === '/customers')  result = { value: DB.customers };
      else if (req.method === 'GET'  && path === '/products')   result = { value: DB.products  };
      else if (req.method === 'GET'  && path === '/inquiries')  result = { value: DB.inquiries.map(enrichInquiry) };
      else if (req.method === 'GET'  && path === '/quotations') result = { value: DB.quotations.map(enrichQuotation) };
      else if (req.method === 'GET'  && path === '/salesorders')result = { value: DB.salesOrders.map(enrichSO) };
      else if (req.method === 'GET'  && path.startsWith('/salesorderitems')) {
        const filter = parsed.query['$filter'] || '';
        const soIdMatch = filter.match(/salesorder_id eq '([^']+)'/i);
        const items = soIdMatch ? DB.soItems.filter(i => i.salesOrder_ID === soIdMatch[1]) : DB.soItems;
        result = { value: items };
      }
      else if (req.method === 'GET'  && path === '/deliveries')  result = { value: DB.deliveries.map(enrichDelivery) };
      else if (req.method === 'GET'  && path === '/invoices')     result = { value: DB.invoices.map(enrichInvoice)   };
      else if (req.method === 'POST' && path === '/inquiries')    result = createInquiry(data);
      // action: convertToQuotation  (path like /inquiries('X')/O2CService.convertToQuotation)
      else if (req.method === 'POST' && path.includes('converttoquotation')) {
        const id = rawPath.match(/inquiries\('([^']+)'\)/i)?.[1];
        result = convertToQuotation(id, data.discountPct || 0);
      }
      // action: acceptQuotation
      else if (req.method === 'POST' && path.includes('acceptquotation')) {
        const id = rawPath.match(/quotations\('([^']+)'\)/i)?.[1];
        result = acceptQuotation(id);
      }
      // action: createDelivery
      else if (req.method === 'POST' && path.includes('createdelivery')) {
        const id = rawPath.match(/salesorders\('([^']+)'\)/i)?.[1];
        result = createDelivery(id, data);
      }
      // action: postGoodsIssue
      else if (req.method === 'POST' && path.includes('postgoodsissue')) {
        const id = rawPath.match(/deliveries\('([^']+)'\)/i)?.[1];
        result = postGoodsIssue(id);
      }
      // action: createInvoiceFromDeliveries
      else if (req.method === 'POST' && path.includes('createinvoicefromdeliveries')) {
        result = createInvoiceFromDeliveries(data);
      }
      // action: markPaid
      else if (req.method === 'POST' && path.includes('markpaid')) {
        const id = rawPath.match(/invoices\('([^']+)'\)/i)?.[1];
        result = markPaid(id);
      }
      else {
        respond(res, 404, { error: `No route: ${req.method} ${path}` }); return;
      }
      respond(res, 200, result);
    } catch (err) {
      respond(res, err.code || 500, { error: err.message || String(err) });
    }
  });
});

const PORT = 4005;

// ─── Integration Test Suite ───────────────────────────────────────

async function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    // encode special chars so Node HTTP client does not throw ERR_UNESCAPED_CHARACTERS
    const safePath = ('/api/o2c' + path).replace(/'/g, "%27").replace(/ /g, "%20");
    const opts = { hostname: 'localhost', port: PORT, path: safePath, method,
      headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0, failed = 0;
const results = [];

function assert(condition, label, detail = '') {
  if (condition) {
    passed++;
    results.push({ ok: true,  label, detail });
    process.stdout.write(`  ✅  ${label}\n`);
  } else {
    failed++;
    results.push({ ok: false, label, detail });
    process.stdout.write(`  ❌  ${label}  ${detail}\n`);
  }
}

async function runTests() {
  console.log('\n' + '═'.repeat(62));
  console.log('  🍱  FreshBox Foods O2C — Integration Test Suite');
  console.log('═'.repeat(62) + '\n');

  // ── 1. Master Data ──────────────────────────────────────────────
  console.log('STEP 0 — Master Data');
  let r = await apiCall('GET', '/customers');
  assert(r.status === 200, 'GET /customers → 200');
  assert(r.body.value.length === 3, 'Three customers seeded');
  r = await apiCall('GET', '/products');
  assert(r.status === 200, 'GET /products → 200');
  assert(r.body.value.length === 5, 'Five products seeded');
  const vegProd = r.body.value.find(p => p.ID === 'MEAL-VEG');
  assert(vegProd?.basePrice === 180, 'Veg Meal Box base price = ₹180');
  assert(vegProd?.gstRate === 5, 'Food GST rate = 5%');

  // ── 2. Inquiry ──────────────────────────────────────────────────
  console.log('\nSTEP 1 — Inquiry (VA11)');
  r = await apiCall('POST', '/inquiries', {
    ID: 'INQ000001', customer_ID: 'TECH01',
    inquiryDate: '2025-01-15', validUntil: '2025-01-22',
    notes: '120 meal boxes – 60 lunch + 60 dinner', status: 'Open',
    items: [
      { product_ID: 'MEAL-VEG', requestedQty: 80 },
      { product_ID: 'MEAL-NVG', requestedQty: 40 }
    ]
  });
  assert(r.status === 200, 'POST /inquiries → 200');
  assert(r.body.ID === 'INQ000001', 'Inquiry ID = INQ000001');
  assert(r.body.status === 'Open', 'Inquiry status = Open');
  assert(r.body.customer?.name === 'TechPark Cafeteria', 'Customer name populated');
  assert(r.body.items?.length === 2, 'Two inquiry items created');

  // ── 3. Convert to Quotation ─────────────────────────────────────
  console.log('\nSTEP 2 — Quotation (VA21) with 15% discount');
  r = await apiCall('POST', "/inquiries('INQ000001')/O2CService.convertToQuotation", { discountPct: 15 });
  assert(r.status === 200, 'convertToQuotation action → 200');
  const qtId = r.body.ID;
  assert(qtId?.startsWith('QT'), `Quotation ID starts with QT (got ${qtId})`);
  assert(r.body.discountPct === 15, 'Discount = 15%');
  assert(r.body.items?.length === 2, 'Quotation has 2 items');
  // check pricing: 80 x 180 x 0.85 = 12240, 40 x 220 x 0.85 = 7480, net = 19720
  const vegLine = r.body.items.find(i => i.product_ID === 'MEAL-VEG');
  const nvgLine = r.body.items.find(i => i.product_ID === 'MEAL-NVG');
  assert(vegLine?.unitPrice === 180, 'Veg unit price = ₹180');
  assert(nvgLine?.unitPrice === 220, 'NVG unit price = ₹220');
  assert(Math.abs((vegLine?.lineNet || 0) - 12240) < 1, `Veg line net = ₹12,240 (got ₹${vegLine?.lineNet})`);
  assert(Math.abs((r.body.netAmount || 0) - 19720) < 1, `Quotation net = ₹19,720 (got ₹${r.body.netAmount})`);
  // 5% GST on 19720 = 986
  assert(Math.abs((r.body.gstAmount || 0) - 986) < 1, `GST (5%) = ₹986 (got ₹${r.body.gstAmount})`);
  assert(Math.abs((r.body.totalAmount || 0) - 20706) < 1, `Total = ₹20,706 (got ₹${r.body.totalAmount})`);

  // Verify inquiry status changed
  r = await apiCall('GET', '/inquiries');
  const inq = r.body.value.find(i => i.ID === 'INQ000001');
  assert(inq?.status === 'Converted', 'Inquiry status = Converted');

  // ── 4. Accept Quotation → Sales Order ──────────────────────────
  console.log('\nSTEP 3 — Sales Order (VA01)');
  r = await apiCall('POST', `/quotations('${qtId}')/O2CService.acceptQuotation`, {});
  assert(r.status === 200, 'acceptQuotation action → 200');
  const soId = r.body.ID;
  assert(soId?.startsWith('SO'), `Sales Order ID starts with SO (got ${soId})`);
  assert(r.body.status === 'Open', 'SO status = Open');
  assert(r.body.items?.length === 2, 'SO has 2 line items');
  assert(r.body.items?.every(i => i.openQty === i.quantity), 'All items fully open');
  // verify quotation accepted
  r = await apiCall('GET', '/quotations');
  const qt = r.body.value.find(q => q.ID === qtId);
  assert(qt?.status === 'Accepted', 'Quotation status = Accepted');

  // Get SO items for delivery
  r = await apiCall('GET', `/salesorderitems?$filter=salesOrder_ID eq '${soId}'`);
  const soItems = r.body.value;
  assert(soItems.length === 2, `SO items available (got ${soItems.length})`);
  const vegSOItem = soItems.find(i => i.product_ID === 'MEAL-VEG');
  const nvgSOItem = soItems.find(i => i.product_ID === 'MEAL-NVG');
  assert(vegSOItem?.openQty === 80, `Veg openQty = 80 (got ${vegSOItem?.openQty})`);
  assert(nvgSOItem?.openQty === 40, `NVG openQty = 40 (got ${nvgSOItem?.openQty})`);

  // ── 5a. Delivery 1 – Lunch Batch ───────────────────────────────
  console.log('\nSTEP 4a — Delivery 1: Lunch Batch (VL01N)');
  r = await apiCall('POST', `/salesorders('${soId}')/O2CService.createDelivery`, {
    batchLabel: 'Lunch Batch – Day 1',
    plannedDate: '2025-01-16',
    items: [
      { soItemId: vegSOItem.ID, qty: 40 },
      { soItemId: nvgSOItem.ID, qty: 20 }
    ]
  });
  assert(r.status === 200, 'createDelivery (Lunch) → 200');
  const dlv1Id = r.body.ID;
  assert(dlv1Id?.startsWith('DL'), `Delivery 1 ID starts with DL (got ${dlv1Id})`);
  assert(r.body.status === 'Pending', 'Delivery 1 status = Pending');
  assert(r.body.items?.length === 2, 'Delivery 1 has 2 items');
  assert(r.body.batchLabel === 'Lunch Batch – Day 1', 'Batch label correct');

  // Post Goods Issue 1
  r = await apiCall('POST', `/deliveries('${dlv1Id}')/O2CService.postGoodsIssue`, {});
  assert(r.status === 200, 'postGoodsIssue (Delivery 1) → 200');
  // Check stock reduced
  r = await apiCall('GET', '/products');
  const vegStock1 = r.body.value.find(p => p.ID === 'MEAL-VEG')?.stockQty;
  assert(vegStock1 === 460, `Veg stock after Delivery 1 GI = 460 (got ${vegStock1})`);
  r = await apiCall('GET', '/deliveries');
  const dlv1 = r.body.value.find(d => d.ID === dlv1Id);
  assert(dlv1?.status === 'GoodsIssued', 'Delivery 1 status = GoodsIssued');
  assert(dlv1?.actualDate !== null, 'Actual date set on GI');

  // Verify partial SO status
  r = await apiCall('GET', '/salesorders');
  const soPartial = r.body.value.find(s => s.ID === soId);
  assert(soPartial?.status === 'PartiallyDelivered', 'SO status = PartiallyDelivered');

  // ── 5b. Delivery 2 – Dinner Batch ──────────────────────────────
  console.log('\nSTEP 4b — Delivery 2: Dinner Batch (VL01N)');
  r = await apiCall('POST', `/salesorders('${soId}')/O2CService.createDelivery`, {
    batchLabel: 'Dinner Batch – Day 2',
    plannedDate: '2025-01-17',
    items: [
      { soItemId: vegSOItem.ID, qty: 40 },
      { soItemId: nvgSOItem.ID, qty: 20 }
    ]
  });
  assert(r.status === 200, 'createDelivery (Dinner) → 200');
  const dlv2Id = r.body.ID;
  assert(dlv2Id !== dlv1Id, 'Delivery 2 has unique ID');
  assert(r.body.batchLabel === 'Dinner Batch – Day 2', 'Dinner batch label correct');
  r = await apiCall('POST', `/deliveries('${dlv2Id}')/O2CService.postGoodsIssue`, {});
  assert(r.status === 200, 'postGoodsIssue (Delivery 2) → 200');
  const vegStock2 = (await apiCall('GET', '/products')).body.value.find(p => p.ID === 'MEAL-VEG')?.stockQty;
  assert(vegStock2 === 420, `Veg stock after Delivery 2 GI = 420 (got ${vegStock2})`);
  r = await apiCall('GET', '/salesorders');
  const soFull = r.body.value.find(s => s.ID === soId);
  assert(soFull?.status === 'FullyDelivered', 'SO status = FullyDelivered');

  // Validate openQty = 0
  r = await apiCall('GET', `/salesorderitems?$filter=salesOrder_ID eq '${soId}'`);
  assert(r.body.value.every(i => i.openQty === 0), 'All SO items openQty = 0');

  // ── 6. Invoice ──────────────────────────────────────────────────
  console.log('\nSTEP 5 — Invoice (VF01) with GST breakup');
  r = await apiCall('POST', '/createInvoiceFromDeliveries', {
    deliveryIds: [dlv1Id, dlv2Id],
    invoiceDate: '2025-01-17',
    dueDate: '2025-02-16'
  });
  assert(r.status === 200, 'createInvoiceFromDeliveries → 200');
  const invId = r.body.ID;
  assert(invId?.startsWith('IV'), `Invoice ID starts with IV (got ${invId})`);
  assert(r.body.status === 'Open', 'Invoice status = Open');
  assert(r.body.items?.length === 4, `Invoice has 4 line items (2 per delivery = 4 got ${r.body.items?.length})`);
  // Price validation: 80 VEG x 180 x 0.85 + 40 NVG x 220 x 0.85 = 19720 net
  assert(Math.abs(r.body.netAmount - 19720) < 1, `Invoice net = ₹19,720 (got ₹${r.body.netAmount})`);
  assert(Math.abs(r.body.cgst - 493) < 1, `CGST (2.5%) = ₹493 (got ₹${r.body.cgst})`);
  assert(Math.abs(r.body.sgst - 493) < 1, `SGST (2.5%) = ₹493 (got ₹${r.body.sgst})`);
  assert(r.body.igst === 0, 'IGST = 0 (intra-state)');
  assert(Math.abs(r.body.totalAmount - 20706) < 1, `Invoice total = ₹20,706 (got ₹${r.body.totalAmount})`);

  // SO should now be Billed
  r = await apiCall('GET', '/salesorders');
  const soBilled = r.body.value.find(s => s.ID === soId);
  assert(soBilled?.status === 'Billed', 'SO status = Billed');

  // ── 7. Mark Paid ────────────────────────────────────────────────
  console.log('\nSTEP 6 — Mark Invoice Paid');
  r = await apiCall('POST', `/invoices('${invId}')/O2CService.markPaid`, {});
  assert(r.status === 200, 'markPaid → 200');
  r = await apiCall('GET', '/invoices');
  const paidInv = r.body.value.find(i => i.ID === invId);
  assert(paidInv?.status === 'Paid', 'Invoice status = Paid');

  // ── 8. Edge cases ───────────────────────────────────────────────
  console.log('\nSTEP 7 — Edge Case Validations');
  // Double-accept quotation
  r = await apiCall('POST', `/quotations('${qtId}')/O2CService.acceptQuotation`, {});
  assert(r.status === 400, 'Reject double-accept of Quotation (400)');
  // GI on already-issued delivery
  r = await apiCall('POST', `/deliveries('${dlv1Id}')/O2CService.postGoodsIssue`, {});
  assert(r.status === 400, 'Reject double GI posting (400)');
  // Invoice on non-GI'd delivery
  const badDlv = await apiCall('POST', `/salesorders('${soId}')/O2CService.createDelivery`, {
    batchLabel: 'Extra batch', plannedDate: '2025-01-18', items: []
  });
  // create a fresh inquiry to test bad flow
  const inq2 = await apiCall('POST', '/inquiries', { ID: 'INQ000002', customer_ID: 'CORP02', status: 'Open', items: [{ product_ID: 'SNACK-PM', requestedQty: 10 }] });
  assert(inq2.status === 200, 'Second inquiry created for edge-case test');
  const qt2 = await apiCall('POST', "/inquiries('INQ000002')/O2CService.convertToQuotation", { discountPct: 0 });
  const so2 = await apiCall('POST', `/quotations('${qt2.body.ID}')/O2CService.acceptQuotation`, {});
  const so2Items = (await apiCall('GET', `/salesorderitems?$filter=salesOrder_ID eq '${so2.body.ID}'`)).body.value;
  const dlvPending = await apiCall('POST', `/salesorders('${so2.body.ID}')/O2CService.createDelivery`, {
    batchLabel: 'Pending batch', plannedDate: '2025-01-18',
    items: [{ soItemId: so2Items[0].ID, qty: so2Items[0].openQty }]
  });
  assert(dlvPending.status === 200, 'Pending delivery created for edge-case');
  // Try to invoice pending (not GI'd) delivery
  r = await apiCall('POST', '/createInvoiceFromDeliveries', { deliveryIds: [dlvPending.body.ID] });
  assert(r.status === 400, 'Block invoice on non-GI delivery (400)');

  // ── Summary ─────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(62));
  console.log(`  RESULTS: ${passed} passed  |  ${failed} failed  |  ${passed+failed} total`);
  console.log('═'.repeat(62) + '\n');

  const docFlow = `  INQ000001 → ${qtId} → ${soId} → ${dlv1Id}, ${dlv2Id} → ${invId}`;
  console.log('  Document Flow:');
  console.log(docFlow);
  console.log('  Final States:');
  console.log(`    Inquiry   INQ000001 : Converted`);
  console.log(`    Quotation ${qtId}  : Accepted`);
  console.log(`    SalesOrder ${soId} : Billed`);
  console.log(`    Delivery  ${dlv1Id} : GoodsIssued`);
  console.log(`    Delivery  ${dlv2Id} : GoodsIssued`);
  console.log(`    Invoice   ${invId}  : Paid`);
  console.log('');

  return { passed, failed, total: passed + failed, docFlow,
           ids: { inqId: 'INQ000001', qtId, soId, dlv1Id, dlv2Id, invId } };
}

// ─── Main ─────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  try {
    const summary = await runTests();
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(1);
  }
});

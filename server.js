#!/usr/bin/env node
/**
 * FreshBox Foods – O2C Standalone Server
 * Zero external dependencies. Pure Node.js built-ins only.
 * Run: node server.js
 * Then open: http://localhost:3000
 */

'use strict';

const http   = require('http');
const url    = require('url');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ─────────────────────────────────────────────────────────────────
//  In-Memory Database
// ─────────────────────────────────────────────────────────────────
const DB = {
  customers: [
    { ID: 'TECH01', name: 'TechPark Cafeteria',   address: 'Plot 12, Tech Hub, Bangalore - 560100', gstin: '29AADCT1234F1Z5', contactPerson: 'Rahul Sharma', email: 'rahul@techpark.in', phone: '+91-9876543210' },
    { ID: 'CORP02', name: 'Infosys Pantry',        address: 'Electronics City Phase 1, Bangalore',   gstin: '29AADCI5678G2Z3', contactPerson: 'Priya Nair',   email: 'priya@infosys.com', phone: '+91-9876543211' },
    { ID: 'STAR03', name: 'StarHealth Canteen',    address: 'No 1, New Tank Street, Chennai - 600034', gstin: '33AADCS9012H3Z1', contactPerson: 'Meena Pillai', email: 'meena@starhealth.in', phone: '+91-9876543212' }
  ],
  products: [
    { ID: 'MEAL-VEG', name: 'Veg Meal Box',       description: 'Full vegetarian meal: rice, dal, 2 sabzi, salad, roti', basePrice: 180.00, uom: 'EA', gstRate: 5.00,  stockQty: 500 },
    { ID: 'MEAL-NVG', name: 'Non-Veg Meal Box',   description: 'Chicken/fish meal: rice, curry, salad, roti',          basePrice: 220.00, uom: 'EA', gstRate: 5.00,  stockQty: 400 },
    { ID: 'MEAL-PRE', name: 'Premium Meal Box',   description: 'Chef-special 4-course meal with dessert',              basePrice: 320.00, uom: 'EA', gstRate: 5.00,  stockQty: 200 },
    { ID: 'SNACK-PM', name: 'Evening Snack Pack', description: 'Samosa, chai, fruit bowl',                             basePrice: 80.00,  uom: 'EA', gstRate: 18.00, stockQty: 300 },
    { ID: 'BRKFT-01', name: 'Breakfast Box',      description: 'Idli/Poha, sambhar, chutney, juice',                  basePrice: 120.00, uom: 'EA', gstRate: 5.00,  stockQty: 250 }
  ],
  inquiries:    [],
  inquiryItems: [],
  quotations:   [],
  quotItems:    [],
  salesOrders:  [],
  soItems:      [],
  schedLines:   [],
  deliveries:   [],
  dlvItems:     [],
  invoices:     [],
  invItems:     [],
  invDlvLinks:  [],
  auditLog:     []
};

// Counters for document IDs
const counters = { INQ: 0, QT: 0, SO: 0, DL: 0, IV: 0 };
function nextId(prefix) {
  counters[prefix]++;
  return prefix + String(counters[prefix]).padStart(6, '0');
}
function uuid() { return crypto.randomUUID(); }
function today() { return new Date().toISOString().slice(0, 10); }
function addDays(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

function audit(action, docId, note) {
  DB.auditLog.unshift({ ts: new Date().toISOString(), action, docId, note });
}

// ─────────────────────────────────────────────────────────────────
//  O2C Business Logic
// ─────────────────────────────────────────────────────────────────
function calcLineNet(unitPrice, qty, discPct) {
  return +((unitPrice * qty) * (1 - discPct / 100)).toFixed(2);
}
function calcGST(net, rate) { return +(net * rate / 100).toFixed(2); }

const O2C = {

  createInquiry(body) {
    const id = nextId('INQ');
    const inq = { ID: id, customer_ID: body.customer_ID, inquiryDate: body.inquiryDate || today(),
                  validUntil: body.validUntil || addDays(7), notes: body.notes || '', status: 'Open',
                  createdAt: new Date().toISOString() };
    DB.inquiries.push(inq);
    (body.items || []).forEach(it => {
      DB.inquiryItems.push({ ID: uuid(), inquiry_ID: id, product_ID: it.product_ID, requestedQty: it.requestedQty, notes: it.notes || '' });
    });
    audit('INQUIRY_CREATED', id, `Customer: ${body.customer_ID}`);
    return inq;
  },

  convertToQuotation(inqId, discountPct = 0) {
    const inq = DB.inquiries.find(i => i.ID === inqId);
    if (!inq) throw new Error(`Inquiry ${inqId} not found`);
    if (inq.status !== 'Open') throw new Error(`Inquiry ${inqId} is not Open`);
    const items = DB.inquiryItems.filter(i => i.inquiry_ID === inqId);
    const qtId = nextId('QT');
    const qt = { ID: qtId, inquiry_ID: inqId, customer_ID: inq.customer_ID,
                 quotationDate: today(), validUntil: addDays(7), discountPct, status: 'Open',
                 createdAt: new Date().toISOString() };
    DB.quotations.push(qt);
    items.forEach(it => {
      const prod = DB.products.find(p => p.ID === it.product_ID);
      DB.quotItems.push({ ID: uuid(), quotation_ID: qtId, product_ID: it.product_ID,
                          quantity: it.requestedQty, unitPrice: prod ? prod.basePrice : 0,
                          discountPct });
    });
    inq.status = 'Converted';
    audit('QUOTATION_CREATED', qtId, `From ${inqId}, Discount: ${discountPct}%`);
    return { ...qt, items: DB.quotItems.filter(i => i.quotation_ID === qtId) };
  },

  acceptQuotation(qtId) {
    const qt = DB.quotations.find(q => q.ID === qtId);
    if (!qt) throw new Error(`Quotation ${qtId} not found`);
    if (qt.status !== 'Open') throw new Error(`Quotation ${qtId} is not Open`);
    const items = DB.quotItems.filter(i => i.quotation_ID === qtId);
    const soId = nextId('SO');
    const so = { ID: soId, quotation_ID: qtId, customer_ID: qt.customer_ID,
                 orderDate: today(), requestedDelivDate: addDays(1),
                 salesOrg: 'IN00', distChannel: 'WH', division: 'FB',
                 discountPct: qt.discountPct, status: 'Open',
                 createdAt: new Date().toISOString() };
    DB.salesOrders.push(so);
    items.forEach(it => {
      DB.soItems.push({ ID: uuid(), salesOrder_ID: soId, product_ID: it.product_ID,
                        quantity: it.quantity, unitPrice: it.unitPrice,
                        discountPct: it.discountPct, openQty: it.quantity });
    });
    qt.status = 'Accepted';
    audit('SALES_ORDER_CREATED', soId, `From ${qtId}, Customer: ${qt.customer_ID}`);
    return { ...so, items: DB.soItems.filter(i => i.salesOrder_ID === soId) };
  },

  createDelivery(soId, batchLabel, plannedDate, dlvItems) {
    const so = DB.salesOrders.find(s => s.ID === soId);
    if (!so) throw new Error(`Sales Order ${soId} not found`);
    if (so.status === 'Cancelled' || so.status === 'Billed')
      throw new Error(`SO ${soId} cannot have new deliveries in status ${so.status}`);
    const soItemMap = Object.fromEntries(DB.soItems.filter(i => i.salesOrder_ID === soId).map(i => [i.ID, i]));
    for (const d of dlvItems) {
      const soIt = soItemMap[d.soItemId];
      if (!soIt) throw new Error(`SO Item ${d.soItemId} not found`);
      if (d.qty > soIt.openQty) throw new Error(`Qty ${d.qty} > openQty ${soIt.openQty}`);
    }
    const dlvId = nextId('DL');
    DB.deliveries.push({ ID: dlvId, salesOrder_ID: soId, customer_ID: so.customer_ID,
                         plannedDate: plannedDate || today(), actualDate: null,
                         status: 'Pending', batchLabel: batchLabel || `Delivery from ${soId}`,
                         createdAt: new Date().toISOString() });
    dlvItems.forEach(d => {
      const soIt = soItemMap[d.soItemId];
      DB.dlvItems.push({ ID: uuid(), delivery_ID: dlvId, soItem_ID: d.soItemId,
                         product_ID: soIt.product_ID, deliveredQty: d.qty,
                         unitPrice: soIt.unitPrice });
      soIt.openQty -= d.qty;
    });
    const allItems = DB.soItems.filter(i => i.salesOrder_ID === soId);
    const allZero = allItems.every(i => i.openQty === 0);
    so.status = allZero ? 'FullyDelivered' : 'PartiallyDelivered';
    audit('DELIVERY_CREATED', dlvId, `${batchLabel} for ${soId}`);
    return { ...DB.deliveries.find(d => d.ID === dlvId),
             items: DB.dlvItems.filter(i => i.delivery_ID === dlvId) };
  },

  postGoodsIssue(dlvId) {
    const dlv = DB.deliveries.find(d => d.ID === dlvId);
    if (!dlv) throw new Error(`Delivery ${dlvId} not found`);
    if (dlv.status === 'GoodsIssued') throw new Error(`Already goods-issued`);
    if (dlv.status === 'Cancelled')   throw new Error(`Delivery is cancelled`);
    const items = DB.dlvItems.filter(i => i.delivery_ID === dlvId);
    items.forEach(it => {
      const prod = DB.products.find(p => p.ID === it.product_ID);
      if (prod) prod.stockQty = Math.max(0, prod.stockQty - it.deliveredQty);
    });
    dlv.status = 'GoodsIssued';
    dlv.actualDate = today();
    audit('GOODS_ISSUE_POSTED', dlvId, `Stock reduced for ${items.length} products`);
    return `Delivery ${dlvId} – Goods Issue posted. Stock updated.`;
  },

  createInvoice(deliveryIds, invoiceDate, dueDate) {
    const deliveries = deliveryIds.map(id => {
      const d = DB.deliveries.find(x => x.ID === id);
      if (!d) throw new Error(`Delivery ${id} not found`);
      if (d.status !== 'GoodsIssued') throw new Error(`Delivery ${id} not GoodsIssued (${d.status})`);
      return d;
    });
    const customerIds = [...new Set(deliveries.map(d => d.customer_ID))];
    if (customerIds.length > 1) throw new Error('All deliveries must belong to same customer');
    const invId = nextId('IV');
    DB.invoices.push({ ID: invId, customer_ID: customerIds[0],
                       invoiceDate: invoiceDate || today(),
                       dueDate: dueDate || addDays(30), status: 'Open',
                       createdAt: new Date().toISOString() });
    deliveries.forEach(d => {
      DB.invDlvLinks.push({ invoice_ID: invId, delivery_ID: d.ID });
      const items = DB.dlvItems.filter(i => i.delivery_ID === d.ID);
      items.forEach(it => {
        const soIt = DB.soItems.find(s => s.ID === it.soItem_ID);
        const prod = DB.products.find(p => p.ID === it.product_ID);
        DB.invItems.push({ ID: uuid(), invoice_ID: invId, delivery_ID: d.ID,
                           soItem_ID: it.soItem_ID, product_ID: it.product_ID,
                           quantity: it.deliveredQty, unitPrice: it.unitPrice,
                           discountPct: soIt ? soIt.discountPct : 0,
                           gstRate: prod ? prod.gstRate : 5 });
      });
    });
    // Update SO status to Billed
    deliveries.forEach(d => {
      if (d.salesOrder_ID) {
        const soItemsLeft = DB.soItems.filter(i => i.salesOrder_ID === d.salesOrder_ID);
        if (soItemsLeft.every(i => i.openQty === 0)) {
          const so = DB.salesOrders.find(s => s.ID === d.salesOrder_ID);
          if (so) so.status = 'Billed';
        }
      }
    });
    audit('INVOICE_CREATED', invId, `From deliveries: ${deliveryIds.join(', ')}`);
    return this.getInvoiceWithTotals(invId);
  },

  getInvoiceWithTotals(invId) {
    const inv = DB.invoices.find(i => i.ID === invId);
    if (!inv) throw new Error(`Invoice ${invId} not found`);
    const items = DB.invItems.filter(i => i.invoice_ID === invId);
    let base = 0, disc = 0, gstTotal = 0;
    const enrichedItems = items.map(it => {
      const gross   = it.unitPrice * it.quantity;
      const discAmt = +(gross * (it.discountPct || 0) / 100).toFixed(2);
      const lineNet  = +(gross - discAmt).toFixed(2);
      const lineGst  = calcGST(lineNet, it.gstRate || 5);
      const lineTotal= +(lineNet + lineGst).toFixed(2);
      base      += gross;
      disc      += discAmt;
      gstTotal  += lineGst;
      const prod = DB.products.find(p => p.ID === it.product_ID);
      return { ...it, productName: prod ? prod.name : it.product_ID,
               lineNet, lineGst, lineTotal };
    });
    const net = base - disc;
    return { ...inv,
      items: enrichedItems,
      baseAmount: +base.toFixed(2), discountAmt: +disc.toFixed(2),
      netAmount: +net.toFixed(2),
      cgst: +(gstTotal / 2).toFixed(2), sgst: +(gstTotal / 2).toFixed(2), igst: 0,
      totalAmount: +(net + gstTotal).toFixed(2)
    };
  },

  markPaid(invId) {
    const inv = DB.invoices.find(i => i.ID === invId);
    if (!inv) throw new Error(`Invoice ${invId} not found`);
    if (inv.status === 'Paid')      throw new Error('Already Paid');
    if (inv.status === 'Cancelled') throw new Error('Invoice is Cancelled');
    inv.status = 'Paid';
    audit('INVOICE_PAID', invId, `Payment received`);
    return `Invoice ${invId} marked as Paid.`;
  },

  getStats() {
    const paidInvoices = DB.invoices.filter(i => i.status === 'Paid');
    let totalSpend = 0;
    paidInvoices.forEach(inv => {
      const data = this.getInvoiceWithTotals(inv.ID);
      totalSpend += data.totalAmount;
    });
    return {
      inquiries:        DB.inquiries.length,
      openInquiries:    DB.inquiries.filter(i => i.status === 'Open').length,
      quotations:       DB.quotations.length,
      openQuotations:   DB.quotations.filter(q => q.status === 'Open').length,
      salesOrders:      DB.salesOrders.length,
      openSalesOrders:  DB.salesOrders.filter(s => s.status === 'Open').length,
      deliveries:       DB.deliveries.length,
      goodsIssued:      DB.deliveries.filter(d => d.status === 'GoodsIssued').length,
      invoices:         DB.invoices.length,
      openInvoices:     DB.invoices.filter(i => i.status === 'Open').length,
      paidInvoices:     paidInvoices.length,
      totalSpend:       +totalSpend.toFixed(2)
    };
  }
};

// ─────────────────────────────────────────────────────────────────
//  HTTP Router
// ─────────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

function err(res, msg, status = 400) {
  json(res, { error: msg }, status);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch(e) { reject(e); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  const parsed = url.parse(req.url, true);
  const p = parsed.pathname.replace(/\/$/, '');
  const method = req.method;

  try {
    // ── Static UI ─────────────────────────────────────────────────
    if (p === '' || p === '/') {
      const html = fs.readFileSync(path.join(__dirname, 'app/webapp/index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }

    // ── API Routes ────────────────────────────────────────────────
    if (p === '/api/customers' && method === 'GET')
      return json(res, { value: DB.customers });

    if (p === '/api/products' && method === 'GET')
      return json(res, { value: DB.products });

    if (p === '/api/stats' && method === 'GET')
      return json(res, O2C.getStats());

    if (p === '/api/audit' && method === 'GET')
      return json(res, { value: DB.auditLog.slice(0, 20) });

    // Inquiries
    if (p === '/api/inquiries' && method === 'GET') {
      const inqs = DB.inquiries.map(inq => ({
        ...inq,
        customer: DB.customers.find(c => c.ID === inq.customer_ID),
        items: DB.inquiryItems.filter(i => i.inquiry_ID === inq.ID).map(it => ({
          ...it, product: DB.products.find(p => p.ID === it.product_ID)
        }))
      }));
      return json(res, { value: inqs });
    }
    if (p === '/api/inquiries' && method === 'POST') {
      const body = await readBody(req);
      return json(res, O2C.createInquiry(body), 201);
    }
    const inqConvert = p.match(/^\/api\/inquiries\/([^/]+)\/convert$/);
    if (inqConvert && method === 'POST') {
      const body = await readBody(req);
      return json(res, O2C.convertToQuotation(inqConvert[1], body.discountPct || 0));
    }

    // Quotations
    if (p === '/api/quotations' && method === 'GET') {
      const qts = DB.quotations.map(qt => ({
        ...qt,
        customer: DB.customers.find(c => c.ID === qt.customer_ID),
        items: DB.quotItems.filter(i => i.quotation_ID === qt.ID).map(it => ({
          ...it, product: DB.products.find(p => p.ID === it.product_ID),
          lineNet: calcLineNet(it.unitPrice, it.quantity, it.discountPct)
        }))
      }));
      return json(res, { value: qts });
    }
    const qtAccept = p.match(/^\/api\/quotations\/([^/]+)\/accept$/);
    if (qtAccept && method === 'POST')
      return json(res, O2C.acceptQuotation(qtAccept[1]));
    const qtReject = p.match(/^\/api\/quotations\/([^/]+)\/reject$/);
    if (qtReject && method === 'POST') {
      const qt = DB.quotations.find(q => q.ID === qtReject[1]);
      if (!qt) return err(res, 'Not found', 404);
      qt.status = 'Rejected';
      audit('QUOTATION_REJECTED', qt.ID, '');
      return json(res, { message: `Quotation ${qt.ID} rejected` });
    }

    // Sales Orders
    if (p === '/api/salesorders' && method === 'GET') {
      const sos = DB.salesOrders.map(so => ({
        ...so,
        customer: DB.customers.find(c => c.ID === so.customer_ID),
        items: DB.soItems.filter(i => i.salesOrder_ID === so.ID).map(it => ({
          ...it, product: DB.products.find(p => p.ID === it.product_ID),
          lineNet: calcLineNet(it.unitPrice, it.quantity, it.discountPct)
        }))
      }));
      return json(res, { value: sos });
    }
    const soDelivery = p.match(/^\/api\/salesorders\/([^/]+)\/deliver$/);
    if (soDelivery && method === 'POST') {
      const body = await readBody(req);
      return json(res, O2C.createDelivery(soDelivery[1], body.batchLabel, body.plannedDate, body.items));
    }

    // Deliveries
    if (p === '/api/deliveries' && method === 'GET') {
      const dlvs = DB.deliveries.map(d => ({
        ...d,
        customer: DB.customers.find(c => c.ID === d.customer_ID),
        salesOrder: DB.salesOrders.find(s => s.ID === d.salesOrder_ID),
        items: DB.dlvItems.filter(i => i.delivery_ID === d.ID).map(it => ({
          ...it, product: DB.products.find(p => p.ID === it.product_ID)
        }))
      }));
      return json(res, { value: dlvs });
    }
    const dlvGI = p.match(/^\/api\/deliveries\/([^/]+)\/goodsissue$/);
    if (dlvGI && method === 'POST')
      return json(res, { message: O2C.postGoodsIssue(dlvGI[1]) });

    // Invoices
    if (p === '/api/invoices' && method === 'GET') {
      const invs = DB.invoices.map(inv => ({
        ...O2C.getInvoiceWithTotals(inv.ID),
        customer: DB.customers.find(c => c.ID === inv.customer_ID),
        deliveries: DB.invDlvLinks.filter(l => l.invoice_ID === inv.ID).map(l => ({
          ...DB.deliveries.find(d => d.ID === l.delivery_ID)
        }))
      }));
      return json(res, { value: invs });
    }
    if (p === '/api/invoices/create' && method === 'POST') {
      const body = await readBody(req);
      return json(res, O2C.createInvoice(body.deliveryIds, body.invoiceDate, body.dueDate), 201);
    }
    const invPay = p.match(/^\/api\/invoices\/([^/]+)\/pay$/);
    if (invPay && method === 'POST')
      return json(res, { message: O2C.markPaid(invPay[1]) });

    json(res, { error: 'Not Found' }, 404);
  } catch(e) {
    err(res, e.message);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🍱 FreshBox Foods O2C Server running on http://localhost:${PORT}`);
  console.log(`   API:  http://localhost:${PORT}/api/stats`);
  console.log(`   UI:   http://localhost:${PORT}/\n`);
});

module.exports = { server, DB, O2C };

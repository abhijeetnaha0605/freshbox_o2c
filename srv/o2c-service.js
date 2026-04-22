'use strict';
/**
 * FreshBox O2C – Service Implementation
 * Handles all custom actions and computed fields for the O2C flow.
 */
const cds = require('@sap/cds');

// ─── ID generator ─────────────────────────────────────────────────
const counter = {};
function nextId(prefix, pad = 6) {
  counter[prefix] = (counter[prefix] || 0) + 1;
  return `${prefix}${String(counter[prefix]).padStart(pad, '0')}`;
}

// ─── Pricing helpers ──────────────────────────────────────────────
function calcLineNet(unitPrice, qty, discountPct) {
  const gross = unitPrice * qty;
  return +(gross * (1 - discountPct / 100)).toFixed(2);
}

function calcGST(netAmount, gstRate) {
  return +(netAmount * gstRate / 100).toFixed(2);
}

// ─────────────────────────────────────────────────────────────────
module.exports = class O2CService extends cds.ApplicationService {

  async init() {

    const {
      Inquiries, InquiryItems,
      Quotations, QuotationItems,
      SalesOrders, SalesOrderItems, ScheduleLines,
      Deliveries, DeliveryItems,
      Invoices, InvoiceItems, InvoiceDeliveries,
      Products, Customers
    } = this.entities;

    // ── AFTER READ: inject virtual totals ─────────────────────────

    this.after('READ', Quotations, async (quotations) => {
      const arr = Array.isArray(quotations) ? quotations : [quotations];
      for (const q of arr) {
        if (!q.items) continue;
        let net = 0;
        for (const it of q.items) {
          it.lineNet = calcLineNet(it.unitPrice, it.quantity, it.discountPct || 0);
          net += it.lineNet;
        }
        // Get GST from first product – simplified; real app would sum per rate
        const gstRate = 5; // food items 5%
        q.netAmount   = +net.toFixed(2);
        q.gstAmount   = calcGST(net, gstRate);
        q.totalAmount = +(q.netAmount + q.gstAmount).toFixed(2);
      }
    });

    this.after('READ', SalesOrders, async (orders) => {
      const arr = Array.isArray(orders) ? orders : [orders];
      for (const o of arr) {
        if (!o.items) continue;
        let net = 0;
        for (const it of o.items) {
          it.lineNet = calcLineNet(it.unitPrice, it.quantity, it.discountPct || 0);
          net += it.lineNet;
        }
        const gstRate = 5;
        o.netAmount   = +net.toFixed(2);
        o.gstAmount   = calcGST(net, gstRate);
        o.totalAmount = +(o.netAmount + o.gstAmount).toFixed(2);
      }
    });

    this.after('READ', Invoices, async (invoices) => {
      const arr = Array.isArray(invoices) ? invoices : [invoices];
      for (const inv of arr) {
        if (!inv.items) continue;
        let base = 0, disc = 0, gstTotal = 0;
        for (const it of inv.items) {
          const gross = it.unitPrice * it.quantity;
          const discAmt = +(gross * (it.discountPct || 0) / 100).toFixed(2);
          it.lineNet   = +(gross - discAmt).toFixed(2);
          it.lineGst   = calcGST(it.lineNet, it.gstRate || 5);
          it.lineTotal = +(it.lineNet + it.lineGst).toFixed(2);
          base      += gross;
          disc      += discAmt;
          gstTotal  += it.lineGst;
        }
        const net = base - disc;
        // Intra-state: split CGST + SGST; Inter-state: IGST
        // Simplified: assume intra-state
        inv.baseAmount  = +base.toFixed(2);
        inv.discountAmt = +disc.toFixed(2);
        inv.netAmount   = +net.toFixed(2);
        inv.cgst        = +(gstTotal / 2).toFixed(2);
        inv.sgst        = +(gstTotal / 2).toFixed(2);
        inv.igst        = 0;
        inv.totalAmount = +(net + gstTotal).toFixed(2);
      }
    });

    // ────────────────────────────────────────────────────────────────
    //  ACTION: Inquiry → Quotation
    // ────────────────────────────────────────────────────────────────
    this.on('convertToQuotation', Inquiries, async (req) => {
      const { ID } = req.params[0];
      const { discountPct = 0 } = req.data;

      const inquiry = await SELECT.one.from(Inquiries, { ID }).columns(
        'ID', 'customer_ID', 'status',
        'items { product_ID, requestedQty }'
      );

      if (!inquiry) return req.error(404, `Inquiry ${ID} not found`);
      if (inquiry.status !== 'Open') return req.error(400, `Inquiry ${ID} is not Open`);

      // Load product prices
      const productIds = inquiry.items.map(i => i.product_ID);
      const products = await SELECT.from(Products).where({ ID: { in: productIds } });
      const priceMap = Object.fromEntries(products.map(p => [p.ID, p.basePrice]));

      const qId = nextId('QT');
      const today = new Date().toISOString().slice(0, 10);
      const validUntil = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const qItems = inquiry.items.map(it => ({
        ID: cds.utils.uuid(),
        quotation_ID: qId,
        product_ID: it.product_ID,
        quantity: it.requestedQty,
        unitPrice: priceMap[it.product_ID] || 0,
        discountPct
      }));

      await INSERT.into(Quotations).entries({
        ID: qId,
        inquiry_ID: ID,
        customer_ID: inquiry.customer_ID,
        quotationDate: today,
        validUntil,
        discountPct,
        status: 'Open'
      });
      await INSERT.into(QuotationItems).entries(qItems);

      // Mark inquiry as converted
      await UPDATE(Inquiries, { ID }).with({ status: 'Converted' });

      return SELECT.one.from(Quotations, { ID: qId }).columns(
        '*', 'items { * }'
      );
    });

    // ────────────────────────────────────────────────────────────────
    //  ACTION: Accept Quotation → Sales Order
    // ────────────────────────────────────────────────────────────────
    this.on('acceptQuotation', Quotations, async (req) => {
      const { ID } = req.params[0];

      const quotation = await SELECT.one.from(Quotations, { ID }).columns(
        '*, items { * }'
      );
      if (!quotation) return req.error(404, `Quotation ${ID} not found`);
      if (quotation.status !== 'Open') return req.error(400, `Quotation ${ID} is not Open`);

      const today = new Date().toISOString().slice(0, 10);
      const soId = nextId('SO');

      const soItems = quotation.items.map(it => ({
        ID: cds.utils.uuid(),
        salesOrder_ID: soId,
        product_ID: it.product_ID,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPct: it.discountPct,
        openQty: it.quantity
      }));

      await INSERT.into(SalesOrders).entries({
        ID: soId,
        quotation_ID: ID,
        customer_ID: quotation.customer_ID,
        orderDate: today,
        requestedDelivDate: today,
        discountPct: quotation.discountPct,
        status: 'Open'
      });
      await INSERT.into(SalesOrderItems).entries(soItems);

      await UPDATE(Quotations, { ID }).with({ status: 'Accepted' });

      return SELECT.one.from(SalesOrders, { ID: soId }).columns('*, items { * }');
    });

    // ────────────────────────────────────────────────────────────────
    //  ACTION: Reject Quotation
    // ────────────────────────────────────────────────────────────────
    this.on('rejectQuotation', Quotations, async (req) => {
      const { ID } = req.params[0];
      const q = await SELECT.one.from(Quotations, { ID });
      if (!q) return req.error(404, `Quotation ${ID} not found`);
      await UPDATE(Quotations, { ID }).with({ status: 'Rejected' });
      return `Quotation ${ID} rejected`;
    });

    // ────────────────────────────────────────────────────────────────
    //  ACTION: Create Delivery from Sales Order
    // ────────────────────────────────────────────────────────────────
    this.on('createDelivery', SalesOrders, async (req) => {
      const { ID } = req.params[0];
      const { batchLabel, plannedDate, items: dlvItems } = req.data;

      if (!dlvItems || dlvItems.length === 0)
        return req.error(400, 'No items specified for delivery');

      const so = await SELECT.one.from(SalesOrders, { ID })
        .columns('*, customer_ID, status, items { * }');
      if (!so) return req.error(404, `Sales Order ${ID} not found`);
      if (so.status === 'Cancelled' || so.status === 'Billed')
        return req.error(400, `Sales Order ${ID} cannot have new deliveries in status ${so.status}`);

      // Validate requested qtys against open qty
      const soItemMap = Object.fromEntries(so.items.map(i => [i.ID, i]));
      for (const d of dlvItems) {
        const soIt = soItemMap[d.soItemId];
        if (!soIt) return req.error(400, `SO Item ${d.soItemId} not found`);
        if (d.qty > soIt.openQty)
          return req.error(400, `Requested qty ${d.qty} exceeds open qty ${soIt.openQty} for item ${d.soItemId}`);
      }

      const dlvId = nextId('DL');
      const today = new Date().toISOString().slice(0, 10);

      const delivItems = dlvItems.map(d => ({
        ID: cds.utils.uuid(),
        delivery_ID: dlvId,
        soItem_ID: d.soItemId,
        product_ID: soItemMap[d.soItemId].product_ID,
        deliveredQty: d.qty,
        unitPrice: soItemMap[d.soItemId].unitPrice
      }));

      await INSERT.into(Deliveries).entries({
        ID: dlvId,
        salesOrder_ID: ID,
        customer_ID: so.customer_ID,
        plannedDate: plannedDate || today,
        status: 'Pending',
        batchLabel: batchLabel || `Delivery from ${ID}`
      });
      await INSERT.into(DeliveryItems).entries(delivItems);

      // Reduce openQty on SO items
      for (const d of dlvItems) {
        const soIt = soItemMap[d.soItemId];
        const newOpen = soIt.openQty - d.qty;
        await UPDATE(SalesOrderItems, { ID: d.soItemId }).with({ openQty: newOpen });
      }

      // Update SO status
      const updatedItems = await SELECT.from(SalesOrderItems).where({ salesOrder_ID: ID });
      const allZero = updatedItems.every(i => i.openQty === 0);
      await UPDATE(SalesOrders, { ID }).with({
        status: allZero ? 'FullyDelivered' : 'PartiallyDelivered'
      });

      return SELECT.one.from(Deliveries, { ID: dlvId }).columns('*, items { * }');
    });

    // ────────────────────────────────────────────────────────────────
    //  ACTION: Post Goods Issue
    // ────────────────────────────────────────────────────────────────
    this.on('postGoodsIssue', Deliveries, async (req) => {
      const { ID } = req.params[0];
      const dlv = await SELECT.one.from(Deliveries, { ID });
      if (!dlv) return req.error(404, `Delivery ${ID} not found`);
      if (dlv.status === 'GoodsIssued') return req.error(400, `Delivery ${ID} already goods-issued`);
      if (dlv.status === 'Cancelled') return req.error(400, `Delivery ${ID} is cancelled`);

      const today = new Date().toISOString().slice(0, 10);

      // Reduce product stock
      const items = await SELECT.from(DeliveryItems).where({ delivery_ID: ID });
      for (const it of items) {
        const prod = await SELECT.one.from(Products, { ID: it.product_ID });
        if (prod) {
          const newStock = Math.max(0, (prod.stockQty || 0) - it.deliveredQty);
          await UPDATE(Products, { ID: it.product_ID }).with({ stockQty: newStock });
        }
      }

      await UPDATE(Deliveries, { ID }).with({ status: 'GoodsIssued', actualDate: today });
      return `Delivery ${ID} – Goods Issue posted. Stock updated.`;
    });

    // ────────────────────────────────────────────────────────────────
    //  ACTION: Cancel Delivery
    // ────────────────────────────────────────────────────────────────
    this.on('cancelDelivery', Deliveries, async (req) => {
      const { ID } = req.params[0];
      const dlv = await SELECT.one.from(Deliveries, { ID });
      if (!dlv) return req.error(404, `Delivery ${ID} not found`);
      if (dlv.status === 'GoodsIssued')
        return req.error(400, `Cannot cancel a Goods-Issued delivery. Reverse it instead.`);

      // Restore open qty on SO items
      const items = await SELECT.from(DeliveryItems).where({ delivery_ID: ID });
      for (const it of items) {
        const soIt = await SELECT.one.from(SalesOrderItems, { ID: it.soItem_ID });
        if (soIt) {
          await UPDATE(SalesOrderItems, { ID: it.soItem_ID })
            .with({ openQty: soIt.openQty + it.deliveredQty });
        }
      }

      await UPDATE(Deliveries, { ID }).with({ status: 'Cancelled' });

      // Re-evaluate SO status
      if (dlv.salesOrder_ID) {
        const soItems = await SELECT.from(SalesOrderItems)
          .where({ salesOrder_ID: dlv.salesOrder_ID });
        const allOpen = soItems.every(i => i.openQty === i.quantity);
        await UPDATE(SalesOrders, { ID: dlv.salesOrder_ID })
          .with({ status: allOpen ? 'Open' : 'PartiallyDelivered' });
      }

      return `Delivery ${ID} cancelled and open quantities restored.`;
    });

    // ────────────────────────────────────────────────────────────────
    //  ACTION: Create Invoice from multiple Deliveries
    // ────────────────────────────────────────────────────────────────
    this.on('createInvoiceFromDeliveries', async (req) => {
      const { deliveryIds, invoiceDate, dueDate } = req.data;

      if (!deliveryIds || deliveryIds.length === 0)
        return req.error(400, 'No delivery IDs provided');

      // All deliveries must be GoodsIssued
      const deliveries = await SELECT.from(Deliveries)
        .where({ ID: { in: deliveryIds } })
        .columns('*, items { * }');

      for (const d of deliveries) {
        if (d.status !== 'GoodsIssued')
          return req.error(400, `Delivery ${d.ID} is not Goods-Issued (status: ${d.status})`);
      }

      // All must belong to same customer
      const customerIds = [...new Set(deliveries.map(d => d.customer_ID))];
      if (customerIds.length > 1)
        return req.error(400, 'All deliveries must belong to the same customer');

      const customerId = customerIds[0];
      const today = new Date().toISOString().slice(0, 10);
      const invId = nextId('IV');

      // Build invoice items
      const allDelivItems = deliveries.flatMap(d => d.items.map(it => ({
        ...it,
        customer_ID: d.customer_ID
      })));

      const invItems = [];
      for (const it of allDelivItems) {
        const soItem = await SELECT.one.from(SalesOrderItems, { ID: it.soItem_ID });
        const product = await SELECT.one.from(Products, { ID: it.product_ID });
        invItems.push({
          ID: cds.utils.uuid(),
          invoice_ID: invId,
          delivery_ID: it.delivery_ID,
          soItem_ID: it.soItem_ID,
          product_ID: it.product_ID,
          quantity: it.deliveredQty,
          unitPrice: it.unitPrice || soItem?.unitPrice || 0,
          discountPct: soItem?.discountPct || 0,
          gstRate: product?.gstRate || 5
        });
      }

      await INSERT.into(Invoices).entries({
        ID: invId,
        customer_ID: customerId,
        invoiceDate: invoiceDate || today,
        dueDate: dueDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        status: 'Open'
      });
      await INSERT.into(InvoiceItems).entries(invItems);

      // Link deliveries to invoice
      const invDlvLinks = deliveries.map(d => ({
        invoice_ID: invId,
        delivery_ID: d.ID
      }));
      await INSERT.into(InvoiceDeliveries).entries(invDlvLinks);

      // Mark SO as Billed if fully delivered
      for (const d of deliveries) {
        if (d.salesOrder_ID) {
          const soItems = await SELECT.from(SalesOrderItems)
            .where({ salesOrder_ID: d.salesOrder_ID });
          if (soItems.every(i => i.openQty === 0)) {
            await UPDATE(SalesOrders, { ID: d.salesOrder_ID }).with({ status: 'Billed' });
          }
        }
      }

      return SELECT.one.from(Invoices, { ID: invId }).columns('*, items { * }');
    });

    // ────────────────────────────────────────────────────────────────
    //  ACTION: Mark Invoice Paid
    // ────────────────────────────────────────────────────────────────
    this.on('markPaid', Invoices, async (req) => {
      const { ID } = req.params[0];
      const inv = await SELECT.one.from(Invoices, { ID });
      if (!inv) return req.error(404, `Invoice ${ID} not found`);
      if (inv.status === 'Paid') return req.error(400, `Invoice ${ID} is already Paid`);
      if (inv.status === 'Cancelled') return req.error(400, `Invoice ${ID} is Cancelled`);
      await UPDATE(Invoices, { ID }).with({ status: 'Paid' });
      return `Invoice ${ID} marked as Paid.`;
    });

    // ────────────────────────────────────────────────────────────────
    //  ACTION: Cancel Invoice
    // ────────────────────────────────────────────────────────────────
    this.on('cancelInvoice', Invoices, async (req) => {
      const { ID } = req.params[0];
      const inv = await SELECT.one.from(Invoices, { ID });
      if (!inv) return req.error(404, `Invoice ${ID} not found`);
      if (inv.status === 'Paid') return req.error(400, `Cannot cancel a Paid invoice`);
      await UPDATE(Invoices, { ID }).with({ status: 'Cancelled' });
      return `Invoice ${ID} cancelled.`;
    });

    return super.init();
  }
};

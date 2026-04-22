# FreshBox Foods — SAP BTP CAP Order-to-Cash (O2C)

> **Business Scenario:** TechPark Cafeteria orders 120 Meal Boxes from FreshBox Foods.  
> 60 boxes delivered Lunch Day 1, 60 boxes Dinner Day 2. 15% volume discount. GST @ 5%.  
> Full O2C cycle: **Inquiry → Quotation → Sales Order → 2 Deliveries → 1 Invoice**

---

## 📁 Project Structure

```
freshbox-o2c/
├── db/
│   ├── schema.cds          ← Data model (all O2C entities)
│   └── data/               ← Seed CSV files (Customers, Products)
├── srv/
│   ├── o2c-service.cds     ← OData V4 service definition
│   └── o2c-service.js      ← Business logic & action handlers
├── app/
│   └── webapp/
│       ├── Component.js
│       ├── manifest.json   ← Fiori routing & OData binding
│       ├── index.html
│       ├── view/           ← XML views (Dashboard, lists, details)
│       ├── controller/     ← JS controllers
│       └── i18n/
├── mta.yaml                ← BTP deployment descriptor
├── xs-security.json        ← XSUAA roles & scopes
├── .cdsrc.json             ← CDS build config (SQLite dev / HANA prod)
└── package.json
```

---

## 🚀 Part A — Run Locally (Before Deploying to BTP)

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18 or 20 LTS | https://nodejs.org |
| @sap/cds-dk | latest | `npm i -g @sap/cds-dk` |
| @cap-js/sqlite | (in package.json) | auto-installed |

### Steps

```bash
# 1. Extract the ZIP
unzip freshbox-o2c.zip
cd freshbox-o2c

# 2. Install dependencies
npm install

# 3. Start the development server (hot reload)
cds watch
```

You will see output like:
```
[cds] - loaded model from 2 file(s): db/schema.cds, srv/o2c-service.cds
[cds] - connect to db > sqlite { database: ':memory:' }
[cds] - using auth strategy { kind: 'mocked' }
[cds] - server listening on { url: 'http://localhost:4004' }
```

### Explore the Running App

| URL | What you see |
|-----|-------------|
| http://localhost:4004 | CDS welcome page — all endpoints listed |
| http://localhost:4004/api/o2c | OData metadata endpoint |
| http://localhost:4004/api/o2c/Customers | Customers JSON |
| http://localhost:4004/api/o2c/Products | Products JSON |
| http://localhost:4004/app/webapp/index.html | **Fiori UI** |

---

## 🧪 Part B — Walk Through the Full O2C Cycle (REST API)

Use any REST client (Thunder Client, Postman, curl) or the Fiori UI.

### Step 1 — Create an Inquiry

```http
POST http://localhost:4004/api/o2c/Inquiries
Content-Type: application/json

{
  "ID": "INQ000001",
  "customer_ID": "TECH01",
  "inquiryDate": "2025-01-15",
  "validUntil": "2025-01-22",
  "notes": "Need 120 meal boxes for 2 days",
  "status": "Open",
  "items": [
    { "product_ID": "MEAL-VEG", "requestedQty": 80 },
    { "product_ID": "MEAL-NVG", "requestedQty": 40 }
  ]
}
```

### Step 2 — Convert to Quotation (15% discount)

```http
POST http://localhost:4004/api/o2c/Inquiries('INQ000001')/O2CService.convertToQuotation
Content-Type: application/json

{ "discountPct": 15 }
```

Note the returned Quotation ID (e.g. `QT000001`).

### Step 3 — Accept Quotation → Sales Order

```http
POST http://localhost:4004/api/o2c/Quotations('QT000001')/O2CService.acceptQuotation
Content-Type: application/json

{}
```

Note the Sales Order ID (e.g. `SO000001`). Check items — `openQty` = full quantity.

### Step 4a — First Delivery (Lunch Batch — 60 boxes)

First, get SO item IDs:
```http
GET http://localhost:4004/api/o2c/SalesOrderItems?$filter=salesOrder_ID eq 'SO000001'
```

Then create delivery (replace `<ITEM-UUID>` with actual UUIDs):
```http
POST http://localhost:4004/api/o2c/SalesOrders('SO000001')/O2CService.createDelivery
Content-Type: application/json

{
  "batchLabel": "Lunch Batch – Day 1",
  "plannedDate": "2025-01-16",
  "items": [
    { "soItemId": "<UUID-VEG-ITEM>", "qty": 40 },
    { "soItemId": "<UUID-NVG-ITEM>", "qty": 20 }
  ]
}
```

Post Goods Issue for Delivery 1 (replace `DL000001` with returned ID):
```http
POST http://localhost:4004/api/o2c/Deliveries('DL000001')/O2CService.postGoodsIssue
Content-Type: application/json

{}
```

### Step 4b — Second Delivery (Dinner Batch — remaining 60 boxes)

```http
POST http://localhost:4004/api/o2c/SalesOrders('SO000001')/O2CService.createDelivery
Content-Type: application/json

{
  "batchLabel": "Dinner Batch – Day 2",
  "plannedDate": "2025-01-17",
  "items": [
    { "soItemId": "<UUID-VEG-ITEM>", "qty": 40 },
    { "soItemId": "<UUID-NVG-ITEM>", "qty": 20 }
  ]
}
```

Post Goods Issue for Delivery 2:
```http
POST http://localhost:4004/api/o2c/Deliveries('DL000002')/O2CService.postGoodsIssue
Content-Type: application/json

{}
```

### Step 5 — Create Invoice (both deliveries combined)

```http
POST http://localhost:4004/api/o2c/createInvoiceFromDeliveries
Content-Type: application/json

{
  "deliveryIds": ["DL000001", "DL000002"],
  "invoiceDate": "2025-01-17",
  "dueDate": "2025-02-16"
}
```

The response includes full GST breakup:
- `baseAmount` — gross before discount
- `discountAmt` — 15% off
- `netAmount` — taxable value
- `cgst` — 2.5% CGST
- `sgst` — 2.5% SGST
- `totalAmount` — final payable

### Step 6 — Mark Invoice Paid

```http
POST http://localhost:4004/api/o2c/Invoices('IV000001')/O2CService.markPaid
Content-Type: application/json

{}
```

**Document chain complete:** INQ → QT → SO → DL(×2) → IV ✅

---

## ☁️ Part C — Deploy to SAP BTP

### Prerequisites

```bash
# Install Cloud Foundry CLI
brew install cloudfoundry/tap/cf-cli@8     # macOS
# or download from https://github.com/cloudfoundry/cli/releases

# Install MTA Build Tool
npm install -g mbt

# Install CF MTA Plugin
cf install-plugin multiapps
```

### BTP Account Setup

1. Log in to https://cockpit.btp.cloud.sap
2. Create a **subaccount** in your global account
3. Enable entitlements:
   - **SAP HANA Cloud** (hdi-shared plan)
   - **Authorization and Trust Management** (XSUAA, application plan)
   - **HTML5 Application Repository** (app-host plan)
   - **SAP Build Work Zone** (standard plan) — optional, for Fiori launchpad

### Deploy Commands

```bash
# 1. Log in to Cloud Foundry endpoint
cf login -a https://api.cf.<region>.hana.ondemand.com

# 2. Target your org and space
cf target -o <your-org> -s <your-space>

# 3. Build the MTA archive
mbt build

# 4. Deploy
cf deploy mta_archives/freshbox-o2c_1.0.0.mtar
```

### After Deployment

```bash
# Check running apps
cf apps

# Tail logs for the backend
cf logs freshbox-o2c-srv --recent
```

Your app URL will be displayed in `cf apps` output.
Navigate to `https://freshbox-o2c-approuter-<org>-<space>.cfapps.<region>.hana.ondemand.com`

---

## 🗂 Document Flow Summary

```
INQ000001 (Inquiry — Open)
  └─► QT000001  (Quotation — 15% discount)
        └─► SO000001  (Sales Order — 120 meals)
              ├─► DL000001  (Delivery — Lunch Batch Day 1, 60 meals → GoodsIssued)
              ├─► DL000002  (Delivery — Dinner Batch Day 2, 60 meals → GoodsIssued)
              └─► IV000001  (Invoice — base + discount + CGST + SGST → Paid)
```

---

## 📐 OData Endpoints Reference

| Entity | CRUD | Notes |
|--------|------|-------|
| `/Customers` | R | Master data |
| `/Products` | R | With stock qty |
| `/Inquiries` | CRUD + action | `convertToQuotation(discountPct)` |
| `/Quotations` | CRUD + actions | `acceptQuotation()`, `rejectQuotation()` |
| `/SalesOrders` | CRUD + action | `createDelivery(batchLabel, plannedDate, items[])` |
| `/Deliveries` | CRUD + actions | `postGoodsIssue()`, `cancelDelivery()` |
| `/Invoices` | CRUD + actions | `markPaid()`, `cancelInvoice()` |
| `/createInvoiceFromDeliveries` | action | Unbounded — takes array of delivery IDs |

---

## 🇮🇳 GST Implementation Notes

- Food items use **5% GST** (CGST 2.5% + SGST 2.5% for intra-state)
- Snacks/beverages use **18% GST**
- Invoice shows full tax breakup: Base → Discount → Net → CGST → SGST → Total
- For inter-state supply, set `igst = netAmount × gstRate / 100`, cgst/sgst = 0

---

## License

Apache 2.0 — free to use, modify, deploy.

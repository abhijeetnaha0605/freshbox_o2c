sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

  return Controller.extend("freshbox.o2c.app.controller.Dashboard", {

    onInit: function () {
      const oModel = new JSONModel({
        inquiryCount: 0,
        quotationCount: 0,
        salesOrderCount: 0,
        deliveryCount: 0,
        invoiceCount: 0
      });
      this.getView().setModel(oModel);
      this._loadCounts();
    },

    _loadCounts: function () {
      const oODataModel = this.getOwnerComponent().getModel();
      const oLocalModel = this.getView().getModel();

      const entities = [
        { entity: "Inquiries",   key: "inquiryCount" },
        { entity: "Quotations",  key: "quotationCount" },
        { entity: "SalesOrders", key: "salesOrderCount" },
        { entity: "Deliveries",  key: "deliveryCount" },
        { entity: "Invoices",    key: "invoiceCount" }
      ];

      entities.forEach(function (e) {
        oODataModel.bindList("/" + e.entity).requestContexts(0, 9999).then(function (aContexts) {
          oLocalModel.setProperty("/" + e.key, aContexts.length);
        }).catch(function () {});
      });
    },

    onNavToInquiries:    function () { this.getOwnerComponent().getRouter().navTo("InquiryList"); },
    onNavToQuotations:   function () { this.getOwnerComponent().getRouter().navTo("QuotationList"); },
    onNavToSalesOrders:  function () { this.getOwnerComponent().getRouter().navTo("SalesOrderList"); },
    onNavToDeliveries:   function () { this.getOwnerComponent().getRouter().navTo("DeliveryList"); },
    onNavToInvoices:     function () { this.getOwnerComponent().getRouter().navTo("InvoiceList"); },

    onNewInquiry: function () {
      this.getOwnerComponent().getRouter().navTo("InquiryList");
    }
  });
});

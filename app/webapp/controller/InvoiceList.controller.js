sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("freshbox.o2c.app.controller.InvoiceList", {

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("Dashboard");
    },

    onMarkPaid: function (oEvent) {
      const oCtx  = oEvent.getSource().getParent().getBindingContext();
      const sId   = oCtx.getProperty("ID");
      const oModel = this.getOwnerComponent().getModel();

      MessageBox.confirm("Mark Invoice " + sId + " as Paid?", {
        onClose: (sAction) => {
          if (sAction !== MessageBox.Action.OK) return;
          oModel.bindContext("/Invoices(" + sId + ")/O2CService.markPaid(...)")
            .execute()
            .then(() => {
              MessageToast.show("Invoice " + sId + " marked as Paid.");
              this.byId("invoiceTable").getBinding("items").refresh();
            })
            .catch((err) => MessageBox.error("Failed: " + (err.message || err)));
        }
      });
    },

    onCancelInvoice: function (oEvent) {
      const oCtx  = oEvent.getSource().getParent().getBindingContext();
      const sId   = oCtx.getProperty("ID");
      const oModel = this.getOwnerComponent().getModel();

      MessageBox.confirm("Cancel Invoice " + sId + "?", {
        onClose: (sAction) => {
          if (sAction !== MessageBox.Action.OK) return;
          oModel.bindContext("/Invoices(" + sId + ")/O2CService.cancelInvoice(...)")
            .execute()
            .then(() => {
              MessageToast.show("Invoice " + sId + " cancelled.");
              this.byId("invoiceTable").getBinding("items").refresh();
            })
            .catch((err) => MessageBox.error("Failed: " + (err.message || err)));
        }
      });
    },

    onInvoicePress: function (oEvent) {
      const sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getOwnerComponent().getRouter().navTo("InvoiceDetail", { id: sId });
    }
  });
});

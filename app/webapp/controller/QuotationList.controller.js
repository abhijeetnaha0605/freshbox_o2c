sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("freshbox.o2c.app.controller.QuotationList", {

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("Dashboard");
    },

    onAcceptQuotation: function (oEvent) {
      const oCtx = oEvent.getSource().getParent().getBindingContext();
      const sId  = oCtx.getProperty("ID");
      const oModel = this.getOwnerComponent().getModel();

      MessageBox.confirm("Accept Quotation " + sId + " and create a Sales Order?", {
        onClose: (sAction) => {
          if (sAction !== MessageBox.Action.OK) return;
          oModel.bindContext("/Quotations(" + sId + ")/O2CService.acceptQuotation(...)")
            .execute()
            .then(() => {
              MessageToast.show("Sales Order created from Quotation " + sId);
              this.byId("quotationTable").getBinding("items").refresh();
            })
            .catch((err) => MessageBox.error("Failed: " + (err.message || err)));
        }
      });
    },

    onRejectQuotation: function (oEvent) {
      const oCtx = oEvent.getSource().getParent().getBindingContext();
      const sId  = oCtx.getProperty("ID");
      const oModel = this.getOwnerComponent().getModel();

      MessageBox.confirm("Reject Quotation " + sId + "?", {
        onClose: (sAction) => {
          if (sAction !== MessageBox.Action.OK) return;
          oModel.bindContext("/Quotations(" + sId + ")/O2CService.rejectQuotation(...)")
            .execute()
            .then(() => {
              MessageToast.show("Quotation " + sId + " rejected.");
              this.byId("quotationTable").getBinding("items").refresh();
            })
            .catch((err) => MessageBox.error("Failed: " + (err.message || err)));
        }
      });
    },

    onQuotationPress: function (oEvent) {
      const sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getOwnerComponent().getRouter().navTo("QuotationDetail", { id: sId });
    }
  });
});

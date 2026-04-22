sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("freshbox.o2c.app.controller.DeliveryList", {

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("Dashboard");
    },

    onPostGI: function (oEvent) {
      const oCtx = oEvent.getSource().getParent().getBindingContext();
      const sId  = oCtx.getProperty("ID");
      const oModel = this.getOwnerComponent().getModel();

      MessageBox.confirm("Post Goods Issue for Delivery " + sId + "? This will reduce stock.", {
        onClose: (sAction) => {
          if (sAction !== MessageBox.Action.OK) return;
          oModel.bindContext("/Deliveries(" + sId + ")/O2CService.postGoodsIssue(...)")
            .execute()
            .then(() => {
              MessageToast.show("Goods Issue posted for " + sId);
              this.byId("deliveryTable").getBinding("items").refresh();
            })
            .catch((err) => MessageBox.error("Failed: " + (err.message || err)));
        }
      });
    },

    onCreateInvoice: function () {
      const aSelected = this.byId("deliveryTable").getSelectedItems();
      if (aSelected.length === 0) {
        MessageBox.warning("Please select at least one GoodsIssued delivery.");
        return;
      }
      const aStatuses = aSelected.map(i => i.getBindingContext().getProperty("status"));
      if (aStatuses.some(s => s !== "GoodsIssued")) {
        MessageBox.error("Only GoodsIssued deliveries can be invoiced. Please post Goods Issue first.");
        return;
      }
      this._selectedDelivIds = aSelected.map(i => i.getBindingContext().getProperty("ID"));
      this.byId("invoiceDialog").open();
    },

    onCancelInvoiceDialog: function () {
      this.byId("invoiceDialog").close();
    },

    onConfirmInvoice: function () {
      const oModel   = this.getOwnerComponent().getModel();
      const sInvDate = this.byId("invDate").getValue()    || new Date().toISOString().slice(0, 10);
      const sDueDate = this.byId("invDueDate").getValue() ||
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      const oBinding = oModel.bindContext("/createInvoiceFromDeliveries(...)");
      oBinding.setParameter("deliveryIds", this._selectedDelivIds);
      oBinding.setParameter("invoiceDate", sInvDate);
      oBinding.setParameter("dueDate", sDueDate);

      oBinding.execute().then(() => {
        MessageToast.show("Invoice created successfully from " + this._selectedDelivIds.length + " delivery(s).");
        this.byId("invoiceDialog").close();
        this.byId("deliveryTable").getBinding("items").refresh();
        this.getOwnerComponent().getRouter().navTo("InvoiceList");
      }).catch((err) => {
        MessageBox.error("Invoice creation failed: " + (err.message || JSON.stringify(err)));
      });
    },

    onDeliveryPress: function (oEvent) {
      const sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getOwnerComponent().getRouter().navTo("DeliveryDetail", { id: sId });
    }
  });
});

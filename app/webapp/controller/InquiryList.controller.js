sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("freshbox.o2c.app.controller.InquiryList", {

    onInit: function () {
      this._pendingConvertId = null;
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("Dashboard");
    },

    // ── Create Inquiry ──────────────────────────────────────────────
    onCreateInquiry: function () {
      this.byId("createInquiryDialog").open();
    },

    onCancelDialog: function () {
      this.byId("createInquiryDialog").close();
    },

    onConfirmCreateInquiry: function () {
      const oModel = this.getOwnerComponent().getModel();
      const oBinding = oModel.bindList("/Inquiries");

      const sCustomerId = this.byId("inqCustomerSelect").getSelectedKey();
      const sValidUntil = this.byId("inqValidUntil").getValue();
      const sNotes      = this.byId("inqNotes").getValue();

      if (!sCustomerId) {
        MessageBox.error("Please select a customer.");
        return;
      }

      const sId = "INQ" + String(Date.now()).slice(-6);
      const today = new Date().toISOString().slice(0, 10);

      const oContext = oBinding.create({
        ID: sId,
        customer_ID: sCustomerId,
        inquiryDate: today,
        validUntil: sValidUntil || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        notes: sNotes,
        status: "Open"
      });

      oContext.created().then(() => {
        MessageToast.show("Inquiry " + sId + " created successfully.");
        this.byId("createInquiryDialog").close();
        this.byId("inquiryTable").getBinding("items").refresh();
      }).catch((err) => {
        MessageBox.error("Failed to create inquiry: " + (err.message || err));
      });
    },

    // ── Convert to Quotation ────────────────────────────────────────
    onConvertToQuotation: function (oEvent) {
      const oItem = oEvent.getSource().getParent();
      const oCtx  = oItem.getBindingContext();
      this._pendingConvertId = oCtx.getProperty("ID");
      this.byId("convertDialog").open();
    },

    onCancelConvertDialog: function () {
      this.byId("convertDialog").close();
    },

    onConfirmConvert: function () {
      const oModel = this.getOwnerComponent().getModel();
      const discPct = this.byId("discountPctInput").getValue();
      const sId     = this._pendingConvertId;

      oModel.bindContext("/Inquiries(" + sId + ")/O2CService.convertToQuotation(...)")
        .setParameter("discountPct", parseFloat(discPct))
        .execute()
        .then(() => {
          MessageToast.show("Inquiry " + sId + " converted to Quotation with " + discPct + "% discount.");
          this.byId("convertDialog").close();
          this.byId("inquiryTable").getBinding("items").refresh();
        })
        .catch((err) => {
          MessageBox.error("Conversion failed: " + (err.message || err));
        });
    },

    onInquiryPress: function (oEvent) {
      const oCtx = oEvent.getSource().getBindingContext();
      const sId  = oCtx.getProperty("ID");
      this.getOwnerComponent().getRouter().navTo("InquiryDetail", { id: sId });
    }
  });
});

sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {
  "use strict";
  return Controller.extend("freshbox.o2c.app.controller.QuotationDetail", {
    onInit: function () {
      this.getOwnerComponent().getRouter().getRoute("QuotationDetail")
        .attachPatternMatched(this._onRoute, this);
    },
    _onRoute: function (oEvent) {
      const sId = oEvent.getParameter("arguments").id;
      this.getView().bindElement({
        path: "/Quotations(" + sId + ")",
        parameters: { expand: "customer,items/product" }
      });
    },
    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("QuotationList"); }
  });
});

sap.ui.define([
  "sap/ui/core/mvc/Controller"
], function (Controller) {
  "use strict";

  return Controller.extend("freshbox.o2c.app.controller.InvoiceDetail", {

    onInit: function () {
      this.getOwnerComponent().getRouter()
        .getRoute("InvoiceDetail")
        .attachPatternMatched(this._onRouteMatch, this);
    },

    _onRouteMatch: function (oEvent) {
      const sId = oEvent.getParameter("arguments").id;
      this.getView().bindElement({
        path: "/Invoices(" + sId + ")",
        parameters: {
          expand: "customer,items/product,deliveries/delivery"
        }
      });
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("InvoiceList");
    }
  });
});

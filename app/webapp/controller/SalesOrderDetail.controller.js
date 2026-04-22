sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {
  "use strict";
  return Controller.extend("freshbox.o2c.app.controller.SalesOrderDetail", {
    onInit: function () {
      this.getOwnerComponent().getRouter().getRoute("SalesOrderDetail")
        .attachPatternMatched(this._onRoute, this);
    },
    _onRoute: function (oEvent) {
      const sId = oEvent.getParameter("arguments").id;
      this.getView().bindElement({
        path: "/SalesOrders(" + sId + ")",
        parameters: { expand: "customer,items/product,items/scheduleLines" }
      });
    },
    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("SalesOrderList"); }
  });
});

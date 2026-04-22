sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {
  "use strict";
  return Controller.extend("freshbox.o2c.app.controller.DeliveryDetail", {
    onInit: function () {
      this.getOwnerComponent().getRouter().getRoute("DeliveryDetail")
        .attachPatternMatched(this._onRoute, this);
    },
    _onRoute: function (oEvent) {
      const sId = oEvent.getParameter("arguments").id;
      this.getView().bindElement({
        path: "/Deliveries(" + sId + ")",
        parameters: { expand: "customer,salesOrder,items/product" }
      });
    },
    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("DeliveryList"); }
  });
});

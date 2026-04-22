sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/ui/model/json/JSONModel"
], function (Controller, MessageToast, MessageBox, JSONModel) {
  "use strict";

  return Controller.extend("freshbox.o2c.app.controller.SalesOrderList", {

    onInit: function () {
      this._currentSoId = null;
      this._currentSoItems = [];
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("Dashboard");
    },

    onCreateDelivery: function (oEvent) {
      const oCtx = oEvent.getSource().getParent().getBindingContext();
      const oSO  = oCtx.getObject();
      this._currentSoId    = oSO.ID;
      this._currentSoItems = oSO.items || [];

      // Load items into a local model for the dialog list
      const oLocalModel = new JSONModel({ items: this._currentSoItems });
      const oDialog = this.byId("createDeliveryDialog");
      oDialog.setModel(oLocalModel, "local");

      const oList = this.byId("dlvItemList");
      oList.bindItems({
        model: "local",
        path: "/items",
        template: new sap.m.CustomListItem({
          content: [
            new sap.m.HBox({
              alignItems: "Center",
              items: [
                new sap.m.VBox({
                  width: "60%",
                  items: [
                    new sap.m.Text({ text: "{local>product/name}" }),
                    new sap.m.Text({ text: "{= 'Open Qty: ' + ${local>openQty}}" })
                  ]
                }),
                new sap.m.StepInput({
                  id: "{local>ID}",
                  min: 0,
                  max: "{local>openQty}",
                  value: "{local>openQty}",
                  width: "120px"
                })
              ]
            })
          ]
        })
      });

      oDialog.open();
    },

    onCancelDeliveryDialog: function () {
      this.byId("createDeliveryDialog").close();
    },

    onConfirmDelivery: function () {
      const oModel   = this.getOwnerComponent().getModel();
      const sBatch   = this.byId("dlvBatchLabel").getValue();
      const sDate    = this.byId("dlvPlannedDate").getValue();

      // Collect items from StepInputs
      const oList  = this.byId("dlvItemList");
      const aItems = [];

      this._currentSoItems.forEach((soItem) => {
        // Find the step input in the list
        const oControls = oList.getItems();
        oControls.forEach((oListItem) => {
          const oHBox = oListItem.getContent()[0];
          if (oHBox) {
            const oStepInput = oHBox.getItems()[1];
            if (oStepInput && oStepInput.getValue() > 0) {
              aItems.push({
                soItemId: soItem.ID,
                qty: parseInt(oStepInput.getValue())
              });
            }
          }
        });
      });

      if (aItems.length === 0) {
        // Fallback: deliver all open qty
        this._currentSoItems.forEach((it) => {
          if (it.openQty > 0) {
            aItems.push({ soItemId: it.ID, qty: it.openQty });
          }
        });
      }

      if (aItems.length === 0) {
        MessageBox.error("No open items to deliver.");
        return;
      }

      const oBinding = oModel.bindContext(
        "/SalesOrders(" + this._currentSoId + ")/O2CService.createDelivery(...)"
      );
      oBinding.setParameter("batchLabel", sBatch || "Delivery");
      oBinding.setParameter("plannedDate", sDate || new Date().toISOString().slice(0, 10));
      oBinding.setParameter("items", aItems);

      oBinding.execute().then(() => {
        MessageToast.show("Delivery created for Sales Order " + this._currentSoId);
        this.byId("createDeliveryDialog").close();
        this.byId("soTable").getBinding("items").refresh();
      }).catch((err) => {
        MessageBox.error("Failed: " + (err.message || JSON.stringify(err)));
      });
    },

    onSOPress: function (oEvent) {
      const sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getOwnerComponent().getRouter().navTo("SalesOrderDetail", { id: sId });
    }
  });
});

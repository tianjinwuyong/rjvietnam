import {
  InventoryAction,
  InventoryTransactionDraft,
  validateInventoryTransaction,
} from "./inventory";
import type { MaterialLot, StorageLocation } from "../../../packages/shared-types/src/factory";

// Inline empty mock data — replace with DB integration when the inventory service is wired up.
const materialLots: Pick<MaterialLot, "id" | "name_en">[] = [];
const storageLocations: Pick<StorageLocation, "id" | "code" | "status">[] = []; 

/**
 * Execute and validate an inventory transaction against current business rules.
 * NOTE: This is a mock implementation lacking actual DB interaction or state change logic.
 * In a real system, this would interact with the backend persistence layer (WMS).
 * @param tx - The draft of the inventory transaction.
 * @returns A Promise resolving to a detailed execution result object.
 */
export async function executeInventoryTransaction(tx: InventoryTransactionDraft) {
  // 1. Basic Type Validation
  const initialValidationErrors = validateInventoryTransaction(tx);
  if (initialValidationErrors.length > 0) {
    return {
      success: false,
      message: "Failed validation:",
      errors: initialValidationErrors,
      details: null,
    };
  }

  // --- Complex Business Logic Validation ---

  // 2. Check Material Lot Existence and Status
  const lot = materialLots.find((l) => l.id === tx.materialLotId);
  if (!lot) {
    return { success: false, message: `Material Lot ${tx.materialLotId} not found.` };
  }

  // 3. Action-specific checks and logic execution simulation
  try {
    switch (tx.action) {
      case "RECEIVE": // Receiving material into the system
        let lotToUpdate = true; // Assume we are receiving a new batch or adding to an existing one (needs clarification in real life)

        // Check if target location exists for RECEIVE action's temporary placement
        if (!tx.toLocationCode || !storageLocations.find(l => l.id === tx.toLocationCode)) {
          return { success: false, message: "RECEIVE requires a valid destination location." };
        }

        // If multiple inputs/sources were used (not modelled here), we'd aggregate them.
        return { 
            success: true, 
            message: `Successfully processed RECEIVE transaction for ${tx.quantity} units of ${lot.name_en} into ${tx.toLocationCode}.`,
            details: { lotId: tx.materialLotId, quantityReceived: tx.quantity, location: tx.toLocationCode }
        };

      case "PUT_AWAY": // Moving from a temporary/staging area to long-term storage
        const sourceLoc = storageLocations.find(l => l.id === tx.fromLocationCode);
        if (!sourceLoc) {
          return { success: false, message: `Source location ${tx.fromLocationCode} for PUT_AWAY not found.` };
        }

        // Check if the destination location 'to' is operational (e.g., not full or locked)
        const destLoc = storageLocations.find(l => l.id === tx.toLocationCode);
         if (!destLoc || destLoc.status !== "active") {
          return { success: false, message: `Destination location ${tx.toLocationCode} is not active.` };
        }

        // Logic: Ensure source inventory exists before moving it
        // (Requires a more complex invetory check function that tracks reservations)
        console.log(`Simulation: Moving ${tx.quantity} units from ${sourceLoc.code} to ${destLoc.code}`);

        return { 
            success: true, 
            message: `Successfully processed PUT_AWAY transaction for ${tx.quantity} units of ${lot.name_en} from ${sourceLoc.code} to ${destLoc.code}.`,
            details: { lotId: tx.materialLotId, quantityMoved: tx.quantity }
        };

      case "PICK": // Picking material for a work order
        if (!tx.workOrderCode) {
          return { success: false, message: "PICK action requires a work order code." };
        }
        // In a real WMS, this step would decrement available stock reserved to the WO and validate pick quantity based on requirement.

        console.log(`Simulation: Picking ${tx.quantity} units for Work Order ${tx.workOrderCode}.`);

        return { 
            success: true, 
            message: `Successfully processed PICK transaction for ${tx.quantity} units for Work Order ${tx.workOrderCode}.`,
            details: { lotId: tx.materialLotId, quantityPicked: tx.quantity, woCode: tx.workOrderCode }
        };

      // Add cases for other actions (ISSUE_TO_LINE, RETURN_FROM_LINE, SCRAP, ADJUST) as needed...
      default:
        return { success: true, message: `Successfully processed ${tx.action} transaction using mock logic.` };
    }
  } catch (error) {
    console.error("Error during transaction execution:", error);
    return { success: false, message: "Internal server simulation error occurred." };
  }
}
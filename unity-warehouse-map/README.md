# Unity WMS 3D Warehouse Map

This is the shared real-time warehouse map for PDA field marking and WMS position management.

- Reads `GET /wms/storage-locations?limit=500`.
- Places each WMS location at `(xCoord, yCoord)` in the Unity ground plane.
- Colors available/locked locations and refreshes every 5 seconds.
- Touch/click an existing location to inspect code, QR, coordinates and status.
- Touch/click empty ground to create a new location through `POST /wms/storage-locations`.

Open this folder in Unity 2022.3 LTS, attach `WarehouseMapController` to the scene root, then build for Android or Windows. Set `apiBaseUrl` to the WMS server address reachable by the PDA (not `127.0.0.1` when running on a physical PDA).

The current native PDA map remains available while this Unity client is being installed; both use the same WMS coordinate fields and QR identifiers.

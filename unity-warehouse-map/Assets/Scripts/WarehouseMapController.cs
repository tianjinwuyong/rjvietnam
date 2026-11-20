using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

public class WarehouseMapController : MonoBehaviour
{
    [Serializable] public class Location { public int id; public string code; public string area; public string name_zh; public string status; public float xCoord; public float yCoord; public int capacityQty; public string qrCode; }
    [Serializable] public class LocationEnvelope { public List<Location> items; }
    [Serializable] public class LocationRequest { public string code; public string qrCode; public string area; public string nameZh; public int warehouseId = 1; public int zoneId = 1; public string locationType = "STANDARD"; public float xCoord; public float yCoord; public string coordinateSystem = "WAREHOUSE_MAP_3D"; public bool allowReceiving = true; public bool allowTransfer = true; public bool allowPutaway = true; public bool msdAllowed = true; public int maxPallets = 1; }

    [Header("WMS API")]
    public string apiBaseUrl = "http://127.0.0.1:8080";
    public float refreshSeconds = 5f;
    public float metersPerUnit = 1f;
    public int defaultWarehouseId = 1;
    public int defaultZoneId = 1;

    private readonly Dictionary<int, GameObject> markers = new();
    private Camera mapCamera;
    private GameObject ground;
    private Location selected;

    void Start()
    {
        Application.targetFrameRate = 60;
        BuildScene();
        StartCoroutine(RefreshLoop());
    }

    void BuildScene()
    {
        mapCamera = Camera.main;
        if (mapCamera == null) { var cameraObject = new GameObject("Warehouse Map Camera"); mapCamera = cameraObject.AddComponent<Camera>(); }
        mapCamera.transform.position = new Vector3(24, 28, -28);
        mapCamera.transform.rotation = Quaternion.Euler(48, 38, 0);
        ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "WMS warehouse ground - touch to mark";
        ground.transform.localScale = new Vector3(6, 1, 4);
        ground.GetComponent<Renderer>().material.color = new Color(0.82f, 0.88f, 0.94f);
        var lightObject = new GameObject("Warehouse Map Light");
        var light = lightObject.AddComponent<Light>(); light.type = LightType.Directional; light.intensity = 1.1f; lightObject.transform.rotation = Quaternion.Euler(50, -30, 0);
    }

    IEnumerator RefreshLoop()
    {
        while (true) { yield return StartCoroutine(LoadLocations()); yield return new WaitForSeconds(refreshSeconds); }
    }

    IEnumerator LoadLocations()
    {
        using var request = UnityWebRequest.Get($"{apiBaseUrl}/wms/storage-locations?limit=500");
        yield return request.SendWebRequest();
        if (request.result != UnityWebRequest.Result.Success) { Debug.LogWarning($"WMS map sync failed: {request.error}"); yield break; }
        LocationEnvelope envelope = null;
        try { envelope = JsonUtility.FromJson<LocationEnvelope>(request.downloadHandler.text); } catch (Exception ex) { Debug.LogWarning(ex.Message); }
        if (envelope?.items == null) yield break;
        foreach (var location in envelope.items) UpsertMarker(location);
    }

    void UpsertMarker(Location location)
    {
        if (!markers.TryGetValue(location.id, out var marker))
        {
            marker = GameObject.CreatePrimitive(PrimitiveType.Cube); marker.name = $"WMS-LOC-{location.code}"; markers[location.id] = marker;
            marker.AddComponent<LocationMarker>().Initialize(location, this);
        }
        marker.transform.position = new Vector3(location.xCoord / metersPerUnit, 0.5f, location.yCoord / metersPerUnit);
        marker.transform.localScale = new Vector3(1.8f, 1f, 1.2f);
        marker.GetComponent<Renderer>().material.color = location.status == "locked" ? new Color(0.9f, .2f, .2f) : new Color(.2f, .65f, .95f);
        marker.GetComponent<LocationMarker>().Initialize(location, this);
    }

    void Update()
    {
        if (!Input.GetMouseButtonDown(0) && Input.touchCount == 0) return;
        var screenPoint = Input.touchCount > 0 ? (Vector3)Input.GetTouch(0).position : Input.mousePosition;
        var ray = mapCamera.ScreenPointToRay(screenPoint);
        if (Physics.Raycast(ray, out var hit) && hit.collider.gameObject == ground) StartCoroutine(CreateMarker(hit.point));
    }

    IEnumerator CreateMarker(Vector3 point)
    {
        var code = $"MAP-{DateTime.Now:MMddHHmmss}";
        var body = JsonUtility.ToJson(new LocationRequest { code = code, qrCode = $"WMS-LOC:{code}", area = "现场测绘区", nameZh = $"现场库位 {code}", warehouseId = defaultWarehouseId, zoneId = defaultZoneId, xCoord = point.x * metersPerUnit, yCoord = point.z * metersPerUnit });
        using var request = new UnityWebRequest($"{apiBaseUrl}/wms/storage-locations", "POST");
        request.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(body)); request.downloadHandler = new DownloadHandlerBuffer(); request.SetRequestHeader("Content-Type", "application/json");
        yield return request.SendWebRequest();
        if (request.result != UnityWebRequest.Result.Success) Debug.LogWarning($"WMS location create failed: {request.error}"); else yield return StartCoroutine(LoadLocations());
    }

    public void Select(Location location) { selected = location; Debug.Log($"Selected {location.code}, QR={location.qrCode}, X={location.xCoord}, Y={location.yCoord}, status={location.status}"); }
}

public class LocationMarker : MonoBehaviour
{
    private WarehouseMapController controller; private WarehouseMapController.Location location;
    public void Initialize(WarehouseMapController.Location value, WarehouseMapController owner) { location = value; controller = owner; }
    void OnMouseDown() { controller?.Select(location); }
}

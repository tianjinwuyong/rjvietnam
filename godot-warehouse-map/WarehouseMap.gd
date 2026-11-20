extends Node3D

@export var api_base_url := "http://192.168.1.100:8080"
@export var refresh_seconds := 5.0
@export var warehouse_width_m := 20.0
@export var warehouse_depth_m := 12.0

var camera: Camera3D
var ground: MeshInstance3D
var markers: Dictionary = {}
var selected_marker: Node3D
var dragging := false
var drag_offset := Vector3.ZERO
var status_label: Label
var detail_label: Label

func _ready() -> void:
	_build_scene()
	_refresh_locations()
	var timer := Timer.new()
	timer.wait_time = refresh_seconds
	timer.timeout.connect(_refresh_locations)
	add_child(timer)
	timer.start()

func _build_scene() -> void:
	camera = Camera3D.new()
	camera.position = Vector3(18, 22, 22)
	camera.rotation_degrees = Vector3(-42, 40, 0)
	add_child(camera)
	camera.current = true

	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-55, -30, 0)
	light.light_energy = 1.2
	add_child(light)

	ground = MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(warehouse_width_m, warehouse_depth_m)
	ground.mesh = plane
	ground.name = "WMS warehouse floor"
	var floor_material := StandardMaterial3D.new()
	floor_material.albedo_color = Color("#dbeafe")
	ground.material_override = floor_material
	add_child(ground)

	var ui := CanvasLayer.new()
	add_child(ui)
	var title := Label.new()
	title.text = "统一PDA · 3D仓库布局"
	title.position = Vector2(24, 18)
	title.add_theme_font_size_override("font_size", 26)
	ui.add_child(title)
	status_label = Label.new()
	status_label.text = "正在同步WMS..."
	status_label.position = Vector2(26, 58)
	ui.add_child(status_label)
	detail_label = Label.new()
	detail_label.text = "点击或触摸区域查看名称、QR、坐标和锁定状态"
	detail_label.position = Vector2(26, 92)
	ui.add_child(detail_label)

func _refresh_locations() -> void:
	var request := HTTPRequest.new()
	add_child(request)
	request.request_completed.connect(_on_locations_received.bind(request))
	request.request(api_base_url + "/wms/storage-locations?limit=500")

func _on_locations_received(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray, request: HTTPRequest) -> void:
	request.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
		status_label.text = "WMS同步失败 · " + str(response_code)
		return
	var payload = JSON.parse_string(body.get_string_from_utf8())
	if typeof(payload) != TYPE_DICTIONARY:
		status_label.text = "WMS返回格式错误"
		return
	for location in payload.get("items", []):
		_upsert_marker(location)
	status_label.text = "已同步WMS · %d 个库位" % markers.size()

func _upsert_marker(location: Dictionary) -> void:
	var id := str(location.get("id", location.get("code", "unknown")))
	var marker: Node3D = markers.get(id)
	if marker == null:
		marker = _create_marker(location)
		markers[id] = marker
	var x := float(location.get("xCoord", 0.0)) - warehouse_width_m / 2.0
	var z := float(location.get("yCoord", 0.0)) - warehouse_depth_m / 2.0
	marker.position = Vector3(x, 0.55, z)
	marker.set_meta("location", location)
	var locked := str(location.get("status", "active")) == "locked"
	marker.set_meta("locked", locked)
	var material := marker.get_child(0).material_override as StandardMaterial3D
	material.albedo_color = Color("#ef4444") if locked else Color("#22c55e")

func _create_marker(location: Dictionary) -> Node3D:
	var marker := Node3D.new()
	marker.name = "WMS-LOC-" + str(location.get("code", "location"))
	var cube := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(1.1, 1.0, 1.1)
	cube.mesh = box
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("#22c55e")
	cube.material_override = material
	marker.add_child(cube)
	add_child(marker)
	return marker

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_begin_touch(event.position)
		else:
			dragging = false
	elif event is InputEventScreenDrag and dragging and selected_marker and not bool(selected_marker.get_meta("locked", false)):
		_move_marker(event.position)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_begin_touch(event.position)
		else:
			dragging = false
	elif event is InputEventMouseMotion and dragging and selected_marker and not bool(selected_marker.get_meta("locked", false)):
		_move_marker(event.position)

func _begin_touch(screen_position: Vector2) -> void:
	var query := PhysicsRayQueryParameters3D.create(camera.project_ray_origin(screen_position), camera.project_ray_origin(screen_position) + camera.project_ray_normal(screen_position) * 1000.0)
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty(): return
	var object = hit.get("collider")
	if object and object.get_parent() in markers.values():
		selected_marker = object.get_parent()
		var location: Dictionary = selected_marker.get_meta("location", {})
		detail_label.text = "%s · QR:%s · X:%s Y:%s · %s" % [location.get("name_zh", location.get("code", "")), location.get("qrCode", ""), location.get("xCoord", 0), location.get("yCoord", 0), "已锁定" if bool(selected_marker.get_meta("locked", false)) else "可修改"]
		drag_offset = selected_marker.position - hit.position
		dragging = true

func _move_marker(screen_position: Vector2) -> void:
	var query := PhysicsRayQueryParameters3D.create(camera.project_ray_origin(screen_position), camera.project_ray_origin(screen_position) + camera.project_ray_normal(screen_position) * 1000.0)
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty(): return
	selected_marker.position = hit.position + drag_offset
	detail_label.text = "正在修改位置 · X %.2f m · Y %.2f m · 松开后提交WMS" % [selected_marker.position.x + warehouse_width_m / 2.0, selected_marker.position.z + warehouse_depth_m / 2.0]

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CASTAWAY, createAvatar, createLocalArm } from "./avatar";
import {
  AIR_COLOR,
  DEFAULT_PAINT,
  applyGoldSparkle,
  applyItemTransform,
  buildItemFromVoxels,
  createItemMaterial,
  defaultTransform,
  hexToInt,
  isAirColor,
  isGoldHex,
  itemCubeGeometry,
  normalizeHex,
  normalizePaint,
  readStoredDocument,
  resetItemDebug,
  tickGoldObject,
  writeStoredDocument,
  type ItemDocument,
  type ItemTransform,
  type ItemVoxel,
} from "./item-voxels";

const HALF = 8;
const TAP = 12;

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export class ItemEditor {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly gripNdc = new THREE.Vector3();
  private readonly dummy = new THREE.Object3D();
  private readonly cells = new Map<string, ItemVoxel>();
  private readonly batches = new Map<string, THREE.InstancedMesh>();
  private readonly batchKeys = new Map<string, string[]>();
  private readonly mats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly plane: THREE.Mesh;
  private readonly ghost: THREE.Mesh;
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly grid: THREE.GridHelper;
  private readonly grip: THREE.Object3D;
  private readonly axes: THREE.Object3D;
  private readonly floor: THREE.Mesh;
  private readonly dummyAvatar: THREE.Group;
  private readonly localArm: THREE.Group;
  private held: THREE.Group | null = null;
  private color = DEFAULT_PAINT;
  private erase = false;
  private preview = false;
  private transform: ItemTransform = defaultTransform();
  private swing = 0;
  private lastT = performance.now();
  private down = { x: 0, y: 0, button: 0 };
  private dragging = false;
  private disposed = false;
  private savedCam = { x: 10, y: 9, z: 12, tx: 0, ty: 0, tz: 0 };
  private persistTimer = 0;
  onChange: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x1a1612);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    this.camera.position.set(10, 9, 12);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.add(new THREE.AmbientLight(0xfff1dc, 0.85));
    const sun = new THREE.DirectionalLight(0xffd09a, 0.7);
    sun.position.set(6, 12, 4);
    this.scene.add(sun);

    this.grid = new THREE.GridHelper(16, 16, 0xb85c38, 0x3a332c);
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(0.95);
    this.scene.add(this.axes);

    const gripRoot = new THREE.Group();
    const gripGeo = new THREE.BoxGeometry(0.88, 0.88, 0.88);
    const gripMesh = new THREE.Mesh(
      gripGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff3b32,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    gripMesh.raycast = () => {};
    const gripEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(gripGeo),
      new THREE.LineBasicMaterial({ color: 0xff6a62, transparent: true, opacity: 0.9 }),
    );
    gripEdge.raycast = () => {};
    gripRoot.add(gripMesh, gripEdge);
    gripRoot.renderOrder = 3;
    this.grip = gripRoot;
    this.scene.add(this.grip);

    const planeGeo = new THREE.PlaneGeometry(16, 16);
    planeGeo.rotateX(-Math.PI / 2);
    this.plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(this.plane);

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28),
      new THREE.MeshBasicMaterial({ color: 0x241f1a }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.visible = false;
    this.floor.raycast = () => {};
    this.scene.add(this.floor);

    this.dummyAvatar = createAvatar(CASTAWAY);
    this.dummyAvatar.position.set(0.55, 0, -2.4);
    this.dummyAvatar.rotation.y = Math.PI * 0.92;
    this.dummyAvatar.visible = false;
    this.scene.add(this.dummyAvatar);

    this.localArm = createLocalArm(CASTAWAY);
    this.localArm.visible = false;

    this.ghostMat = new THREE.MeshBasicMaterial({
      color: hexToInt(this.color),
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.ghost = new THREE.Mesh(this.box, this.ghostMat);
    this.ghost.visible = false;
    this.ghost.raycast = () => {};
    this.scene.add(this.ghost);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.controls.mouseButtons.RIGHT = -1 as THREE.MOUSE;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("contextmenu", this.onMenu);

    const stored = readStoredDocument();
    if (stored) {
      this.transform = defaultTransform();
      applyItemTransform(this.transform);
      this.addMany(stored.voxels);
      this.rebuildAll();
    }

    this.resize();
    this.renderer.setAnimationLoop(this.tick);
    window.addEventListener("resize", this.resize);
  }

  setColor(color: string) {
    if (isAirColor(color)) {
      this.color = AIR_COLOR;
      this.ghostMat.color.setHex(0x6a90b8);
      this.ghostMat.opacity = 0.22;
      return;
    }
    const hex = normalizeHex(color) ?? DEFAULT_PAINT;
    this.color = hex;
    this.ghostMat.color.setHex(hexToInt(hex));
    this.ghostMat.opacity = 0.35;
  }

  getColor(): string {
    return this.color;
  }

  setErase(on: boolean) {
    this.erase = on;
  }

  isErase(): boolean {
    return this.erase;
  }

  isPreview(): boolean {
    return this.preview;
  }

  voxelsList(): ItemVoxel[] {
    const list = [...this.cells.values()];
    list.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
    return list;
  }

  getTransform(): ItemTransform {
    return {
      position: [...this.transform.position],
      rotation: [...this.transform.rotation],
      scale: this.transform.scale,
    };
  }

  setTransform(next: ItemTransform) {
    this.transform = {
      position: [...next.position],
      rotation: [...next.rotation],
      scale: next.scale,
    };
    applyItemTransform(this.transform);
    this.applyHeldPose();
    this.persistSoon();
  }

  private persistSoon() {
    window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => this.persist(), 180);
  }

  document(): ItemDocument {
    return { voxels: this.voxelsList(), transform: this.getTransform() };
  }

  toJSON(): string {
    return JSON.stringify(this.document());
  }

  load(voxels: ItemVoxel[], transform?: ItemTransform) {
    this.wipe();
    this.addMany(voxels);
    this.rebuildAll();
    if (transform) {
      this.transform = {
        position: [...transform.position],
        rotation: [...transform.rotation],
        scale: transform.scale,
      };
      applyItemTransform(this.transform);
    }
    this.refreshHeld();
    this.persist();
  }

  loadDocument(doc: ItemDocument) {
    this.load(doc.voxels, doc.transform);
  }

  clear() {
    this.wipe();
    this.rebuildAll();
    this.refreshHeld();
    this.persist();
  }

  persist() {
    writeStoredDocument(this.document());
    this.onChange?.();
  }

  setPreview(on: boolean) {
    if (this.preview === on) return;
    this.preview = on;
    this.ghost.visible = false;
    this.grid.visible = !on;
    this.axes.visible = !on;
    this.grip.visible = !on;
    this.plane.visible = !on;
    this.floor.visible = on;
    this.dummyAvatar.visible = on;
    this.localArm.visible = on;
    this.setBatchesVisible(!on);
    this.controls.enabled = !on;
    if (on) {
      this.savedCam = {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
        tx: this.controls.target.x,
        ty: this.controls.target.y,
        tz: this.controls.target.z,
      };
      this.camera.fov = 60;
      this.camera.position.set(0, 1.62, 0);
      this.camera.rotation.set(0, 0, 0);
      this.camera.updateProjectionMatrix();
      this.camera.add(this.localArm);
      this.refreshHeld();
    } else {
      this.dropHeld();
      this.camera.remove(this.localArm);
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(this.savedCam.x, this.savedCam.y, this.savedCam.z);
      this.controls.target.set(this.savedCam.tx, this.savedCam.ty, this.savedCam.tz);
      this.controls.update();
    }
  }

  playSwing() {
    this.swing = 1;
  }

  projectGrip(): { x: number; y: number; visible: boolean } {
    if (this.preview) return { x: 0, y: 0, visible: false };
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.gripNdc.set(0, 0, 0).project(this.camera);
    const behind = this.gripNdc.z < -1 || this.gripNdc.z > 1;
    return {
      x: (this.gripNdc.x * 0.5 + 0.5) * w,
      y: (-this.gripNdc.y * 0.5 + 0.5) * h,
      visible: !behind,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.resize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointerleave", this.onLeave);
    canvas.removeEventListener("contextmenu", this.onMenu);
    window.clearTimeout(this.persistTimer);
    this.dropHeld();
    this.camera.remove(this.localArm);
    this.controls.dispose();
    this.box.dispose();
    this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    this.ghostMat.dispose();
    for (const batch of this.batches.values()) {
      this.scene.remove(batch);
      batch.geometry.dispose();
    }
    for (const mat of this.mats.values()) mat.dispose();
    this.renderer.dispose();
    resetItemDebug();
  }

  private wipe() {
    this.cells.clear();
  }

  private addMany(voxels: ItemVoxel[]) {
    for (const v of voxels) {
      if (!this.inBounds(v.x, v.y, v.z)) continue;
      const color = normalizePaint(v.color);
      this.cells.set(keyOf(v.x, v.y, v.z), { x: v.x, y: v.y, z: v.z, color });
    }
  }

  private material(color: string): THREE.MeshLambertMaterial {
    const hex = normalizeHex(color) ?? DEFAULT_PAINT;
    let mat = this.mats.get(hex);
    if (!mat) {
      mat = createItemMaterial(hex);
      this.mats.set(hex, mat);
    }
    return mat;
  }

  private setBatchesVisible(on: boolean) {
    for (const batch of this.batches.values()) batch.visible = on;
  }

  private rebuildColor(color: string) {
    const prev = this.batches.get(color);
    if (prev) {
      this.scene.remove(prev);
      prev.geometry.dispose();
      this.batches.delete(color);
      this.batchKeys.delete(color);
    }
    const list: ItemVoxel[] = [];
    for (const v of this.cells.values()) {
      if (v.color === color) list.push(v);
    }
    if (!list.length) return;

    // Air spacers: faint wireframe in the editor only — never in the held mesh.
    if (isAirColor(color)) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x6a90b8,
        wireframe: true,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.frustumCulled = false;
      inst.userData.color = AIR_COLOR;
      inst.userData.air = true;
      inst.visible = !this.preview;
      const keys: string[] = [];
      list.forEach((v, i) => {
        this.dummy.position.set(v.x, v.y, v.z);
        this.dummy.updateMatrix();
        inst.setMatrixAt(i, this.dummy.matrix);
        keys.push(keyOf(v.x, v.y, v.z));
      });
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
      this.batches.set(color, inst);
      this.batchKeys.set(color, keys);
      return;
    }

    const geo = itemCubeGeometry(1, color);
    const inst = new THREE.InstancedMesh(geo, this.material(color), list.length);
    inst.frustumCulled = false;
    inst.userData.color = color;
    inst.visible = !this.preview;
    const keys: string[] = [];
    list.forEach((v, i) => {
      this.dummy.position.set(v.x, v.y, v.z);
      this.dummy.updateMatrix();
      inst.setMatrixAt(i, this.dummy.matrix);
      keys.push(keyOf(v.x, v.y, v.z));
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.userData.gold = isGoldHex(color);
    this.scene.add(inst);
    this.batches.set(color, inst);
    this.batchKeys.set(color, keys);
  }

  private rebuildAll() {
    const colors = new Set<string>([...this.batches.keys(), ...[...this.cells.values()].map((v) => v.color)]);
    for (const color of colors) this.rebuildColor(color);
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return x >= -HALF && x < HALF && z >= -HALF && z < HALF && y >= 0 && y < 16;
  }

  private place(x: number, y: number, z: number) {
    if (!this.inBounds(x, y, z)) return;
    const key = keyOf(x, y, z);
    if (this.cells.has(key)) return;
    const color = this.color;
    this.cells.set(key, { x, y, z, color });
    this.rebuildColor(color);
    this.persist();
  }

  private remove(x: number, y: number, z: number) {
    const key = keyOf(x, y, z);
    const cell = this.cells.get(key);
    if (!cell) return;
    this.cells.delete(key);
    this.rebuildColor(cell.color);
    this.persist();
  }

  private pick(clientX: number, clientY: number): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const solids = [...this.batches.values()];
    const hits = this.raycaster.intersectObjects(solids, false);
    if (hits[0]) return hits[0];
    const floor = this.raycaster.intersectObject(this.plane, false);
    return floor[0] ?? null;
  }

  private cellFromHit(hit: THREE.Intersection, adjacent: boolean): { x: number; y: number; z: number } | null {
    const color = (hit.object.userData as { color?: string }).color;
    const id = hit.instanceId;
    if (color && id != null) {
      const key = this.batchKeys.get(color)?.[id];
      if (!key) return null;
      const [xs, ys, zs] = key.split(",");
      let x = Number(xs);
      let y = Number(ys);
      let z = Number(zs);
      if (adjacent && hit.face) {
        const n = hit.face.normal;
        x += Math.sign(n.x);
        y += Math.sign(n.y);
        z += Math.sign(n.z);
      }
      return { x, y, z };
    }
    const p = hit.point;
    return { x: Math.round(p.x), y: 0, z: Math.round(p.z) };
  }

  private isVoxelHit(hit: THREE.Intersection): boolean {
    return typeof (hit.object.userData as { color?: string }).color === "string" && hit.instanceId != null;
  }

  private apply(hit: THREE.Intersection, erase: boolean) {
    if (erase) {
      const cell = this.cellFromHit(hit, false);
      if (cell && this.isVoxelHit(hit)) this.remove(cell.x, cell.y, cell.z);
      return;
    }
    const cell = this.cellFromHit(hit, this.isVoxelHit(hit));
    if (cell) this.place(cell.x, cell.y, cell.z);
  }

  private refreshHeld() {
    this.dropHeld();
    if (!this.preview) return;
    const g = buildItemFromVoxels(this.voxelsList());
    this.held = g;
    this.camera.add(g);
    this.applyHeldPose();
  }

  private dropHeld() {
    if (!this.held) return;
    this.camera.remove(this.held);
    this.held.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (!Array.isArray(mat)) mat.dispose();
      }
    });
    this.held = null;
  }

  private applyHeldPose() {
    if (!this.held) return;
    const t = this.transform;
    const s = Math.sin(this.swing * Math.PI * 0.5);
    this.held.scale.setScalar(t.scale);
    this.held.rotation.set(t.rotation[0] - s * 0.82, t.rotation[1] + s * 0.08, t.rotation[2] - s * 0.36);
    this.held.position.set(t.position[0] - s * 0.06, t.position[1] - s * 0.12, t.position[2] - s * 0.03);
  }

  private readonly onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, button: e.button };
    this.dragging = false;
    if (this.preview || e.button !== 2) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit) this.apply(hit, true);
  };

  private readonly onMove = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > TAP) this.dragging = true;
    if (this.preview) {
      this.ghost.visible = false;
      return;
    }
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit || this.erase) {
      this.ghost.visible = false;
      return;
    }
    const cell = this.cellFromHit(hit, this.isVoxelHit(hit));
    if (!cell || !this.inBounds(cell.x, cell.y, cell.z) || this.cells.has(keyOf(cell.x, cell.y, cell.z))) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghost.position.set(cell.x, cell.y, cell.z);
    this.ghostMat.color.setHex(hexToInt(this.color));
  };

  private readonly onUp = (e: PointerEvent) => {
    if (this.preview || this.dragging) return;
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > TAP) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit) return;
    const right = e.button === 2 || this.down.button === 2;
    const erase = right || (!right && this.erase);
    this.apply(hit, erase);
  };

  private readonly onLeave = () => {
    this.ghost.visible = false;
  };

  private readonly onMenu = (e: Event) => {
    e.preventDefault();
  };

  private readonly resize = () => {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private readonly tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * 8);
      this.applyHeldPose();
    }
    const t = now / 1000;
    for (const [color, inst] of this.batches) {
      if (!isGoldHex(color)) continue;
      const mat = inst.material;
      if (mat instanceof THREE.MeshBasicMaterial) applyGoldSparkle(mat, t);
    }
    if (this.held) tickGoldObject(this.held, t);
    if (isGoldHex(this.color)) applyGoldSparkle(this.ghostMat, t);
    else this.ghostMat.color.setHex(hexToInt(this.color));
    if (!this.preview) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
